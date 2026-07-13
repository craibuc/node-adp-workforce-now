import { AdpError, raiseForAdp } from './errors.js';
import { MemoryTokenStore } from './token-store/memory.js';
import type { CachedToken, TokenStore } from './token-store/types.js';
import { createBunTransport } from './transport/bun.js';
import { createNodeTransport } from './transport/node.js';
import type { AdpTransport, TransportTls } from './transport/types.js';
import { Worker } from './worker.js';

const DEFAULT_API_BASE_URL = 'https://api.adp.com';
const DEFAULT_TOKEN_URL = 'https://accounts.adp.com/auth/oauth/v2/token';
const REFRESH_MARGIN_SECONDS = 300;

export interface ClientOptions {
  /** Enables lazy auto-authentication. */
  credentials?: { client_id: string; client_secret: string };
  tokenStore?: TokenStore;
  transport?: AdpTransport;
  apiBaseUrl?: string;
  tokenUrl?: string;
  /** Default true. Pass false to receive unmasked government IDs. */
  masked?: boolean;
}

/** Accepts raw PEM or base64-encoded PEM (the `.env` convention). */
export function normalizePem(input: string): string {
  if (input.includes('-----BEGIN')) return input;
  return Buffer.from(input, 'base64').toString('utf8');
}

function detectTransport(tls: TransportTls): AdpTransport {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
    ? createBunTransport(tls)
    : createNodeTransport(tls);
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class Client {
  readonly worker: Worker;
  private readonly transport: AdpTransport;
  private readonly tokenStore: TokenStore;
  private readonly credentials?: { client_id: string; client_secret: string };
  private readonly apiBaseUrl: string;
  private readonly tokenUrl: string;
  private readonly masked: boolean;

  constructor(certificate: string, privateKey: string, options: ClientOptions = {}) {
    const tls: TransportTls = { cert: normalizePem(certificate), key: normalizePem(privateKey) };
    this.transport = options.transport ?? detectTransport(tls);
    this.tokenStore = options.tokenStore ?? new MemoryTokenStore();
    this.credentials = options.credentials;
    this.apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    this.tokenUrl = options.tokenUrl ?? DEFAULT_TOKEN_URL;
    this.masked = options.masked ?? true;
    this.worker = new Worker(this);
  }

  async authenticate(): Promise<CachedToken> {
    if (!this.credentials) {
      throw new Error('No credentials configured and no valid token in the store; pass options.credentials.');
    }
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.credentials.client_id,
      client_secret: this.credentials.client_secret,
    }).toString();
    const response = await this.transport.request(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await parseBody(response);
    if (!response.ok) raiseForAdp(response.status, json, 'POST /auth/oauth/v2/token');
    const { access_token, expires_in } = json as { access_token?: unknown; expires_in?: unknown };
    if (typeof access_token !== 'string' || typeof expires_in !== 'number') {
      // Fail here with a clear error instead of caching "Bearer undefined" /
      // NaN expiry and surfacing later as inexplicable 401s.
      throw new AdpError({
        statusCode: response.status,
        endpoint: 'POST /auth/oauth/v2/token',
        adpMessage: 'Malformed token response: expected access_token (string) and expires_in (number)',
        raw: json,
      });
    }
    const token: CachedToken = {
      access_token,
      expires_at: Math.floor(Date.now() / 1000) + expires_in,
    };
    await this.tokenStore.set(token);
    return token;
  }

  private async getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      const cached = await this.tokenStore.get();
      if (cached && cached.expires_at - REFRESH_MARGIN_SECONDS > Date.now() / 1000) {
        return cached.access_token;
      }
    }
    return (await this.authenticate()).access_token;
  }

  private send(method: string, url: string, token: string, data?: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: this.masked ? 'application/json' : 'application/json;masked=false',
      Authorization: `Bearer ${token}`,
    };
    let body: string | undefined;
    if (data !== undefined) {
      body = JSON.stringify(data);
      headers['Content-Type'] = 'application/json';
    }
    return this.transport.request(url, { method, headers, body });
  }

  async request(method: string, path: string, data?: unknown): Promise<unknown> {
    const url = `${this.apiBaseUrl}${path}`;
    const endpoint = `${method} ${path}`;

    let token = await this.getToken();
    let response = await this.send(method, url, token, data);

    // Exactly one force-refresh retry on 401.
    if (response.status === 401) {
      token = await this.getToken(true);
      await response.body?.cancel().catch(() => {}); // discard the unread 401 body so the connection isn't pinned
      response = await this.send(method, url, token, data);
    }

    // Empty result (end of pages, empty event queue) — callers detect undefined.
    if (response.status === 204) return undefined;

    const json = await parseBody(response);
    if (!response.ok) raiseForAdp(response.status, json, endpoint);
    return json;
  }

  get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  post(path: string, data: unknown): Promise<unknown> {
    return this.request('POST', path, data);
  }
}
