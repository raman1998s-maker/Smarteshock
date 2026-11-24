// POST /api/auth/login — login con e-mail e password, imposta i cookie HttpOnly.
import { clearSessionCookies, sessionCookies } from './_lib/cookies.js';
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { t } from './_lib/validate.js';

export const config = { path: '/api/auth/login' };

const checkEmail = t.email({ required: true });

export default createHandler(
  {
    POST: {
      auth: 'public',
      async fn({ req, sb }) {
        const body = await readJson(req, { maxBytes: 4 * 1024 });
        const email = checkEmail(body.email, 'email');
        const password = body.password; // la password non si modifica (niente trim)
        if (typeof password !== 'string' || password.length < 1 || password.length > 256) {
          throw new HttpError(400, 'invalid_input', { field: 'password' });
        }

        const session = await sb.signInWithPassword(email.toLowerCase(), password);
        if (!session) throw new HttpError(401, 'invalid_credentials');

        // Solo dipendenti attivi (riga in public.staff).
        let profile = null;
        try {
          const rows = await sb.rest(`staff?id=eq.${encodeURIComponent(session.user_id || '')}&select=id,nome,ruolo,attivo`, {
            token: session.access_token,
          });
          profile = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
        } catch (err) {
          if (!(err instanceof HttpError) || err.status >= 500) throw err;
          profile = null;
        }
        if (!profile || profile.attivo !== true) {
          await sb.signOut(session.access_token);
          throw new HttpError(403, 'forbidden', undefined, clearSessionCookies());
        }

        return json(
          200,
          { id: profile.id, nome: profile.nome, ruolo: profile.ruolo },
          { setCookies: sessionCookies(session) },
        );
      },
    },
  },
  { pattern: /^\/api\/auth\/login\/?$/ },
);
