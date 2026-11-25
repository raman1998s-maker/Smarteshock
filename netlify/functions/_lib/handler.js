// Costruttore delle Netlify Functions (v2): metodo, CSRF, autenticazione,
// ruolo, gestione errori. Ogni endpoint dichiara solo la sua logica.

import { authenticate, checkCsrf, isGestione } from './auth.js';
import { ConfigError, getEnv } from './env.js';
import { HttpError, errorResponse, json } from './http.js';
import { createSupabase } from './supabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {Record<string, {auth?: 'public'|'user'|'gestione'|'admin'|'partner', xrw?: boolean, csrf?: boolean,
 *   params?: RegExp, fn: Function}>} routes  chiave = metodo HTTP
 * @param {{ pattern: RegExp, paramNames?: string[] }} opts  pattern del percorso
 */
export function createHandler(routes, { pattern, paramNames = [] }) {
  return async function handler(req) {
    let session = null;
    try {
      const url = new URL(req.url);
      const match = pattern.exec(url.pathname);
      if (!match) throw new HttpError(404, 'not_found');
      const params = {};
      paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });

      const route = routes[req.method];
      if (!route) {
        return json(405, { error: 'method_not_allowed' }, { headers: { Allow: Object.keys(routes).join(', ') } });
      }
      // Se il percorso ha un id ma la route non lo prevede (o viceversa) → 404/405
      const hasId = params.id !== undefined;
      if ((route.withId === true && !hasId) || (route.withId === false && hasId)) {
        throw new HttpError(hasId ? 405 : 404, hasId ? 'method_not_allowed' : 'not_found');
      }
      if (hasId && !UUID_RE.test(params.id)) throw new HttpError(404, 'not_found');

      const env = getEnv();
      const sb = createSupabase(env);

      if (req.method !== 'GET' && req.method !== 'HEAD' && route.csrf !== false) {
        checkCsrf(req, env, { requireXrw: route.xrw !== false });
      }

      const authMode = route.auth || 'user';
      if (authMode !== 'public') {
        session = await authenticate(req, sb);
        if (authMode === 'admin' && session.user.ruolo !== 'admin') throw new HttpError(403, 'forbidden');
        if (authMode === 'gestione' && !isGestione(session.user)) throw new HttpError(403, 'forbidden');
        if (authMode === 'partner' && session.user.ruolo !== 'partner') throw new HttpError(403, 'forbidden');
      }

      const res = await route.fn({ req, url, params, env, sb, session, user: session?.user, token: session?.token });
      if (session?.setCookies?.length) for (const c of session.setCookies) res.headers.append('Set-Cookie', c);
      return res;
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error(`[api] configurazione: ${err.message}`);
        return json(500, { error: 'server_misconfigured' });
      }
      if (!(err instanceof HttpError)) {
        // Nessun dettaglio al client; nel log solo tipo e messaggio (mai token o corpo).
        console.error(`[api] errore inatteso: ${err && err.name}: ${err && err.message}`);
      }
      const res = errorResponse(err);
      if (session?.setCookies?.length && !(err instanceof HttpError && err.setCookies)) {
        for (const c of session.setCookies) res.headers.append('Set-Cookie', c);
      }
      return res;
    }
  };
}

export { UUID_RE };
