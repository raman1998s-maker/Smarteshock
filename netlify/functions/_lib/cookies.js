// Parsing e serializzazione dei cookie (nessuna dipendenza).

export const ACCESS_COOKIE = 'mk_at';
export const REFRESH_COOKIE = 'mk_rt';
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 7; // 7 giorni

const NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string' || header.length > 8192) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    let value = part.slice(i + 1).trim();
    if (!NAME_RE.test(name) || name in out) continue;
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, path = '/api' } = {}) {
  if (!NAME_RE.test(name)) throw new Error('invalid cookie name');
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'Secure', 'SameSite=Strict'];
  if (typeof maxAge === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (maxAge === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  return parts.join('; ');
}

export function sessionCookies({ access_token, refresh_token, expires_in }) {
  const atMaxAge = Number.isFinite(expires_in) && expires_in > 0 ? Math.min(expires_in, 60 * 60 * 24) : 3600;
  return [
    serializeCookie(ACCESS_COOKIE, access_token, { maxAge: atMaxAge }),
    serializeCookie(REFRESH_COOKIE, refresh_token, { maxAge: REFRESH_MAX_AGE }),
  ];
}

export function clearSessionCookies() {
  return [serializeCookie(ACCESS_COOKIE, '', { maxAge: 0 }), serializeCookie(REFRESH_COOKIE, '', { maxAge: 0 })];
}
