/** Pure helpers for the worker photo methods (no I/O). */

export interface MultipartPart {
  name: string;
  value: string | Uint8Array;
  filename?: string;
  contentType?: string;
}

const CRLF = '\r\n';
const encoder = new TextEncoder();

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Zero-dep multipart/form-data assembly. Part names/headers mirror the
 * recorded production upload: a "json" part (no filename) and a "datafile"
 * part with filename + Content-Type.
 */
export function buildMultipart(parts: MultipartPart[]): { contentType: string; body: Uint8Array } {
  const boundary = `----adp-workforce-now-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const chunks: Uint8Array[] = [];

  for (const part of parts) {
    // Header-injection guard: strip characters that could forge headers from caller-supplied values.
    const name = part.name.replace(/[\r\n"]/g, '');
    const filename = part.filename?.replace(/[\r\n"]/g, '');
    const contentType = part.contentType?.replace(/[\r\n]/g, '');

    let head = `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"`;
    if (filename !== undefined) head += `; filename="${filename}"`;
    head += CRLF;
    if (contentType !== undefined) head += `Content-Type: ${contentType}${CRLF}`;
    head += CRLF;
    chunks.push(encoder.encode(head));
    chunks.push(typeof part.value === 'string' ? encoder.encode(part.value) : part.value);
    chunks.push(encoder.encode(CRLF));
  }
  chunks.push(encoder.encode(`--${boundary}--${CRLF}`));

  return { contentType: `multipart/form-data; boundary=${boundary}`, body: concat(chunks) };
}

/** Magic-byte detection; explicit contentType params always override this. */
export function sniffImageContentType(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  return 'image/jpeg';
}

/** Accepts raw bytes or a base64 string (the flow-step convention). */
export function imageToBytes(image: Uint8Array | string): Uint8Array {
  return typeof image === 'string' ? new Uint8Array(Buffer.from(image, 'base64')) : image;
}
