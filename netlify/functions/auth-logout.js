// POST /api/auth/logout — revoca la sessione e cancella i cookie.
import { decodeJwtPayload } from './_lib/auth.js';
import { ACCESS_COOKIE, REFRESH_COOKIE, clearSessionCookies, parseCookies } from './_lib/cookies.js';
import { createHandler } from './_lib/handler.js';
import { json } from './_lib/http.js';

export const config = { path: '/api/auth/logout' };

export default createHandler(
  {
    POST: {
      // Funziona anche con sessione già scaduta: i cookie vengono sempre cancellati.
      auth: 'public',
      async fn({ req, sb }) {
        const cookies = parseCookies(req.headers.get('cookie'));
        let token = cookies[ACCESS_COOKIE] || '';
        const refreshToken = cookies[REFRESH_COOKIE] || '';
        // Access token scaduto ma refresh token presente: si rinnova solo per poter
        // revocare la sessione su Supabase (altrimenti il refresh token resterebbe valido).
        const payload = decodeJwtPayload(token);
        if ((!payload || payload.exp <= Date.now() / 1000) && refreshToken && refreshToken.length <= 2048) {
          try {
            const session = await sb.refreshSession(refreshToken);
            token = session ? session.access_token : '';
          } catch {
            token = '';
          }
        }
        if (token && token.length <= 4096) await sb.signOut(token);
        return json(200, { ok: true }, { setCookies: clearSessionCookies() });
      },
    },
  },
  { pattern: /^\/api\/auth\/logout\/?$/ },
);
