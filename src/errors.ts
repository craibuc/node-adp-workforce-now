export interface AdpErrorArgs {
  statusCode: number;
  endpoint: string;
  adpMessage?: string;
  adpCode?: string;
  raw?: unknown;
}

export class AdpError extends Error {
  readonly statusCode: number;
  readonly endpoint: string;
  readonly adpMessage?: string;
  readonly adpCode?: string;
  readonly raw?: unknown;

  constructor(args: AdpErrorArgs) {
    super(`${args.statusCode}${args.adpMessage ? ` ${args.adpMessage}` : ''} (${args.endpoint})`);
    this.name = new.target.name;
    this.statusCode = args.statusCode;
    this.endpoint = args.endpoint;
    this.adpMessage = args.adpMessage;
    this.adpCode = args.adpCode;
    this.raw = args.raw;
  }
}

export class BadRequestError extends AdpError {}
export class UnauthorizedError extends AdpError {}
export class ForbiddenError extends AdpError {}
export class NotFoundError extends AdpError {}

interface Extracted {
  adpMessage?: string;
  adpCode?: string;
}

/** ADP returns errors in several shapes; try each known one in order. */
function extract(json: unknown): Extracted {
  if (typeof json !== 'object' || json === null) return {};
  // Optional chaining over `any`: every field access below is defensive.
  const body = json as Record<string, any>;

  // Shape 1 (newer APIs): response.applicationCode.{message,code}
  const app = body.response?.applicationCode;
  if (typeof app?.message === 'string') {
    return {
      adpMessage: app.message,
      adpCode: typeof app.code === 'string' ? app.code : undefined,
    };
  }

  // Shape 2 (legacy): confirmMessage.resourceMessages[0].processMessages[0]
  const processMessage = body.confirmMessage?.resourceMessages?.[0]?.processMessages?.[0];
  if (typeof processMessage === 'object' && processMessage !== null) {
    const adpMessage = processMessage.userMessage?.messageTxt;
    const adpCode = processMessage.processMessageID?.idValue;
    return {
      adpMessage: typeof adpMessage === 'string' ? adpMessage : undefined,
      adpCode: typeof adpCode === 'string' ? adpCode : undefined,
    };
  }

  // Shape 3 (terminate & some events): exceptionMessages[0].message
  const exception = body.exceptionMessages?.[0];
  if (typeof exception?.message === 'string') {
    return { adpMessage: exception.message };
  }

  // Shape 4 (hcm/v2 family, e.g. applicant.onboard): _confirmMessage.messages[0]
  const hcmMessage = body._confirmMessage?.messages?.[0];
  if (typeof hcmMessage?.messageText === 'string') {
    const code = typeof hcmMessage.messageCode === 'string'
      ? hcmMessage.messageCode
      : typeof hcmMessage.code === 'string'
        ? hcmMessage.code
        : undefined;
    return { adpMessage: hcmMessage.messageText, adpCode: code };
  }

  // OAuth token endpoint: { error, error_description }
  if (typeof body.error_description === 'string') {
    return {
      adpMessage: body.error_description,
      adpCode: typeof body.error === 'string' ? body.error : undefined,
    };
  }

  return {};
}

export function raiseForAdp(status: number, json: unknown, endpoint: string): never {
  const { adpMessage, adpCode } = extract(json);
  const args: AdpErrorArgs = { statusCode: status, endpoint, adpMessage, adpCode, raw: json };
  switch (status) {
    case 400: throw new BadRequestError(args);
    case 401: throw new UnauthorizedError(args);
    case 403: throw new ForbiddenError(args);
    case 404: throw new NotFoundError(args);
    default: throw new AdpError(args);
  }
}
