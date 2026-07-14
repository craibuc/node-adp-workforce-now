import { describe, expect, it } from 'bun:test';
import { buildMultipart, imageToBytes, sniffImageContentType } from '../src/photos.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

describe('sniffImageContentType', () => {
  it('detects JPEG and PNG magic bytes, defaulting to jpeg', () => {
    expect(sniffImageContentType(JPEG)).toBe('image/jpeg');
    expect(sniffImageContentType(PNG)).toBe('image/png');
    expect(sniffImageContentType(new Uint8Array([1, 2, 3, 4]))).toBe('image/jpeg');
  });
});

describe('imageToBytes', () => {
  it('passes Uint8Array through and decodes base64 strings', () => {
    expect(imageToBytes(JPEG)).toBe(JPEG);
    const b64 = Buffer.from(JPEG).toString('base64');
    expect(imageToBytes(b64)).toEqual(JPEG);
  });
});

describe('buildMultipart', () => {
  it('assembles CRLF-framed parts with the recorded names and headers', () => {
    const { contentType, body } = buildMultipart([
      { name: 'json', value: '{"a":1}' },
      { name: 'datafile', value: JPEG, filename: 'photo.jpg', contentType: 'image/jpeg' },
    ]);

    const boundary = contentType.replace('multipart/form-data; boundary=', '');
    expect(boundary.length).toBeGreaterThan(8);

    const text = new TextDecoder('latin1').decode(body);
    expect(text).toContain(`--${boundary}\r\nContent-Disposition: form-data; name="json"\r\n\r\n{"a":1}\r\n`);
    expect(text).toContain(
      `--${boundary}\r\nContent-Disposition: form-data; name="datafile"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    );
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);

    // binary payload survives byte-for-byte (find the JPEG bytes in the body)
    const bodyStr = Array.from(body).join(',');
    expect(bodyStr).toContain(Array.from(JPEG).join(','));
  });

  it('sanitizes multipart header interpolation by stripping CRLF and quotes from caller-supplied values', () => {
    const { contentType, body } = buildMultipart([
      {
        name: 'datafile',
        value: JPEG,
        filename: 'a"\r\nX-Evil: 1\r\n.jpg',
        contentType: 'image/jpeg\r\nX-Evil: 1',
      },
    ]);

    const boundary = contentType.replace('multipart/form-data; boundary=', '');
    const text = new TextDecoder('latin1').decode(body);

    // The filename should have quotes and CRLF stripped: 'a"\r\nX-Evil: 1\r\n.jpg' → 'aX-Evil: 1.jpg'
    expect(text).toContain('filename="aX-Evil: 1.jpg"');

    // The contentType should have CRLF stripped: 'image/jpeg\r\nX-Evil: 1' → 'image/jpegX-Evil: 1'
    expect(text).toContain('Content-Type: image/jpegX-Evil: 1');

    // Most importantly: no CRLF sequence exists that could be interpreted as a separate header line
    expect(text.includes('\r\nX-Evil')).toBe(false);
  });
});
