export interface TransportTls {
  cert: string;
  key: string;
  /** Custom CA bundle; used by tests that talk to a local self-signed server. */
  ca?: string;
}

export interface TransportInit {
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
}

/** The only runtime-specific seam: perform one mTLS HTTP request. */
export interface AdpTransport {
  request(url: string, init: TransportInit): Promise<Response>;
}
