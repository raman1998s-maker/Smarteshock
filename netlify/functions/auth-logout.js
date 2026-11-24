// POST /api/auth/logout — revoca la sessione e cancella i cookie.
import { ACCESS_COOKIE, clearSessionCookies, parseCookies } from './_lib/cookies.js';
import { createHandler } from './_lib/handler.js';
import { json } from './_lib/http.js';

export const config = { path: '/api/auth/logout' };

export default createHandler(
  {
    POST: {
      // Funziona anche con sessione già scaduta: i cookie vengono sempre cancellati.
      auth: 'public',
      async fn({ req, sb }) {
        const token = parseCookies(req.headers.get('cookie'))[ACCESS_COOKIE];
        if (token && token.length <= 4096) await sb.signOut(token);
        return json(200, { ok: true }, { setCookies: clearSessionCookies() });
      },
    },
  },
  { pattern: /^\/api\/auth\/logout\/?$/ },
);
