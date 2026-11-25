// Autenticazione con cookie HttpOnly e protezione CSRF.

import { ACCESS_COOKIE, REFRESH_COOKIE, clearSessionCookies, parseCookies, sessionCookies } from './cookies.js';
import { HttpError } from './http.js';

const REFRESH_MARGIN_S = 30;
export const RUOLI = ['admin', 'ufficio', 'tecnico', 'base', 'partner'];
/** Admin e ufficio: richieste, clienti, eventi, offerte, magazzino. */
export const isGestione = (user) => user?.ruolo === 'admin' || user?.ruolo === 'ufficio';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Legge (senza verificarla) la parte "payload" di un JWT, solo per sapere
 * scadenza (exp) e utente (sub). La firma la verifica Supabase a ogni chiamata:
 * un token falsificato viene rifiutato da PostgREST con 401.
 */
export function decodeJwtPayload(token) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.sub !== 'string' || !UUID_RE.test(payload.sub)) return null;
    if (typeof payload.exp !== 'number') return null;
    return payload;
  } catch {
    return null;
  }
}

function unauthorized() {
  return new HttpError(401, 'unauthorized', undefined, clearSessionCookies());
}

/** Origin obbligatorio e uguale ad ALLOWED_ORIGIN (+ X-Requested-With: meekon se richiesto). */
export function checkCsrf(req, env, { requireXrw = true } = {}) {
  const origin = (req.headers.get('origin') || '').replace(/\/+$/, '');
  if (!origin || !env.allowedOrigins.includes(origin)) throw new HttpError(403, 'forbidden_origin');
  if (requireXrw && (req.headers.get('x-requested-with') || '').toLowerCase() !== 'meekon') {
    throw new HttpError(403, 'forbidden_origin');
  }
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'forbidden_origin');
}

async function loadProfile(sb, token, userId) {
  const rows = await sb.rest(`staff?id=eq.${userId}&select=id,nome,ruolo,attivo`, { token });
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

/**
 * Autentica la richiesta dai cookie; rinnova la sessione se l'access token è
 * scaduto (o sta per scadere) o se Supabase lo rifiuta.
 * @returns {{ user: {id:string,nome:string,ruolo:'admin'|'ufficio'|'tecnico'|'base'|'partner'}, token: string, setCookies: string[] }}
 */
export async function authenticate(req, sb) {
  const cookies = parseCookies(req.headers.get('cookie'));
  let token = cookies[ACCESS_COOKIE] || '';
  const refreshToken = cookies[REFRESH_COOKIE] || '';
  if (!token && !refreshToken) throw unauthorized();

  let setCookies = [];
  let refreshed = false;

  async function refresh() {
    if (!refreshToken || refreshToken.length > 2048 || refreshed) throw unauthorized();
    refreshed = true;
    const session = await sb.refreshSession(refreshToken);
    if (!session) throw unauthorized();
    token = session.access_token;
    setCookies = sessionCookies(session);
  }

  let payload = decodeJwtPayload(token);
  if (!payload || payload.exp - REFRESH_MARGIN_S <= Date.now() / 1000) {
    await refresh();
    payload = decodeJwtPayload(token);
    if (!payload) throw unauthorized();
  }

  let profile;
  try {
    profile = await loadProfile(sb, token, payload.sub);
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 401) throw err;
    await refresh();
    payload = decodeJwtPayload(token);
    if (!payload) throw unauthorized();
    try {
      profile = await loadProfile(sb, token, payload.sub);
    } catch (err2) {
      if (err2 instanceof HttpError && err2.status === 401) throw unauthorized();
      throw err2;
    }
  }

  if (!profile || profile.attivo !== true || !RUOLI.includes(profile.ruolo)) {
    throw new HttpError(403, 'forbidden', undefined, clearSessionCookies());
  }
  return { user: { id: profile.id, nome: profile.nome, ruolo: profile.ruolo }, token, setCookies };
}
