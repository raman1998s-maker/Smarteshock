// Risposte JSON, errori generici e lettura sicura del corpo della richiesta.

export class HttpError extends Error {
  /**
   * @param {number} status  codice HTTP
   * @param {string} code    codice d'errore pubblico (es. "invalid_input")
   * @param {object} [extra] campi aggiuntivi NON sensibili (es. { field: "email" })
   * @param {string[]} [setCookies]
   */
  constructor(status, code, extra = undefined, setCookies = undefined) {
    super(code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.setCookies = setCookies;
  }
}

export const API_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
});

export function json(status, body, { setCookies = [], headers = {} } = {}) {
  const h = new Headers(API_HEADERS);
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  for (const c of setCookies) h.append('Set-Cookie', c);
  return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status, headers: h });
}

export function errorResponse(err) {
  if (err instanceof HttpError) {
    return json(err.status, { error: err.code, ...(err.extra || {}) }, { setCookies: err.setCookies || [] });
  }
  return json(500, { error: 'server_error' });
}

/** Legge il corpo come testo con un limite di dimensione. */
export async function readText(req, maxBytes) {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, 'payload_too_large');
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      try { await reader.cancel(); } catch { /* ignora */ }
      throw new HttpError(413, 'payload_too_large');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(concat(chunks, size));
}

function concat(chunks, size) {
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export function mediaType(req) {
  return (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
}

/** Legge un corpo JSON (oggetto) con limite di dimensione. */
export async function readJson(req, { maxBytes = 16 * 1024, optional = false } = {}) {
  const text = await readText(req, maxBytes);
  if (!text.trim()) {
    if (optional) return {};
    throw new HttpError(400, 'invalid_input');
  }
  if (mediaType(req) !== 'application/json') throw new HttpError(415, 'unsupported_media_type');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'invalid_input');
  return data;
}
