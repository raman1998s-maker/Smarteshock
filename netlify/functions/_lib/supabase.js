// Client minimale per Supabase (PostgREST + Auth) basato su fetch.
// - Richieste utente: apikey (anon, da env) + Authorization: Bearer <JWT utente> → la RLS si applica.
// - Richieste pubbliche (modulo del sito): solo apikey → ruolo "anon".
// Nessun messaggio d'errore di Supabase viene inoltrato al client.

import { HttpError } from './http.js';

const TIMEOUT_MS = 8000;

async function doFetch(url, init) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, 'upstream_unavailable');
  }
}

async function readBody(res) {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const INPUT_CODES = new Set(['22P02', '22023', '22001', '22003', '22007', '22008', '23502', '23503', '23514', 'PGRST102', 'PGRST100']);

/** Converte un errore PostgREST in un HttpError generico. */
export function mapRestError(status, body) {
  const code = body && typeof body === 'object' ? String(body.code || '') : '';
  if (status === 401 || code === 'PGRST301' || code === 'PGRST302' || code === 'PGRST303') return new HttpError(401, 'unauthorized');
  if (code === '42501' || status === 403) return new HttpError(403, 'forbidden');
  if (code === '23505') return new HttpError(409, 'conflict');
  if (code === 'P0002' || code === 'PGRST116' || status === 404) return new HttpError(404, 'not_found');
  if (INPUT_CODES.has(code) || status === 400) return new HttpError(400, 'invalid_input');
  return new HttpError(502, 'upstream_error');
}

/** Converte un errore di Supabase Storage in un HttpError generico. */
export function mapStorageError(status, body) {
  // Storage a volte risponde 400 con { statusCode: "403" | "404" | ... } nel corpo.
  const inner = body && typeof body === 'object' ? Number(body.statusCode) : NaN;
  const code = Number.isFinite(inner) && inner >= 400 ? inner : status;
  if (code === 401) return new HttpError(401, 'unauthorized');
  if (code === 403) return new HttpError(403, 'forbidden');
  if (code === 404) return new HttpError(404, 'not_found');
  if (code === 409) return new HttpError(409, 'conflict');
  if (code === 413) return new HttpError(413, 'payload_too_large');
  if (code === 400 || code === 415 || code === 422) return new HttpError(400, 'invalid_input');
  return new HttpError(502, 'upstream_error');
}

export function createSupabase(env) {
  const base = env.supabaseUrl;

  function headers(token, extra = {}) {
    const h = { apikey: env.anonKey, Accept: 'application/json', ...extra };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  /**
   * Chiamata PostgREST. Lancia HttpError se la risposta non è 2xx.
   * @param {string} path es. "eventi?select=*"
   * @param {{method?:string, token?:string|null, body?:any, prefer?:string}} opts
   */
  async function rest(path, { method = 'GET', token = null, body, prefer } = {}) {
    const extra = {};
    if (body !== undefined) extra['Content-Type'] = 'application/json';
    if (prefer) extra.Prefer = prefer;
    const res = await doFetch(`${base}/rest/v1/${path}`, {
      method,
      headers: headers(token, extra),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await readBody(res);
    if (!res.ok) throw mapRestError(res.status, data);
    return data;
  }

  async function authToken(grantType, payload) {
    const res = await doFetch(`${base}/auth/v1/token?grant_type=${grantType}`, {
      method: 'POST',
      headers: headers(null, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await readBody(res);
    if (!res.ok || !data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
      if (res.status >= 500) throw new HttpError(502, 'upstream_error');
      if (res.status === 429) throw new HttpError(429, 'too_many_requests');
      return null;
    }
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: Number(data.expires_in) || 3600,
      user_id: data.user && typeof data.user.id === 'string' ? data.user.id : null,
    };
  }

  /**
   * Chiamata a Supabase Storage con il JWT dell'utente (le policy di storage.objects si applicano).
   * Gli errori diventano HttpError generici (nessun messaggio di Supabase al client).
   * @param {string} path es. "object/sign/media/galleria/x.jpg"
   */
  async function storage(path, { method = 'POST', token = null, body } = {}) {
    const extra = {};
    if (body !== undefined) extra['Content-Type'] = 'application/json';
    const res = await doFetch(`${base}/storage/v1/${path}`, {
      method,
      headers: headers(token, extra),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await readBody(res);
    if (!res.ok) throw mapStorageError(res.status, data);
    return data;
  }

  return {
    rest,
    storage,
    /** Login con e-mail e password; null se le credenziali non sono valide. */
    signInWithPassword: (email, password) => authToken('password', { email, password }),
    /** Rinnova la sessione; null se il refresh token non è valido. */
    refreshSession: (refreshToken) => authToken('refresh_token', { refresh_token: refreshToken }),
    /** Revoca la sessione corrente (errori ignorati). */
    async signOut(accessToken) {
      try {
        await doFetch(`${base}/auth/v1/logout?scope=local`, { method: 'POST', headers: headers(accessToken) });
      } catch {
        /* il logout locale avviene comunque */
      }
    },
  };
}
