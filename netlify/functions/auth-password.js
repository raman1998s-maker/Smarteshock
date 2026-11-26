// POST /api/auth/password — scelta della password dal link di invito (o di recupero) mandato dall'amministratore.
// Corpo: { access_token, password }. Il token arriva nel frammento (#access_token=…) del link Supabase:
// la pagina lo legge, lo manda qui una sola volta e lo cancella dall'indirizzo. Nessun cookie viene creato:
// dopo, la persona entra dalla pagina di accesso con e-mail e nuova password.
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';

export const config = { path: '/api/auth/password' };

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export default createHandler(
  {
    POST: {
      auth: 'public',
      async fn({ req, sb }) {
        const body = await readJson(req, { maxBytes: 8 * 1024 });
        const token = body.access_token;
        const password = body.password; // niente trim
        if (typeof token !== 'string' || token.length > 4096 || !JWT_RE.test(token)) throw new HttpError(400, 'invalid_input', { field: 'access_token' });
        if (typeof password !== 'string' || password.length < 10 || password.length > 128) throw new HttpError(400, 'invalid_input', { field: 'password' });
        const ok = await sb.updatePassword(token, password);
        if (!ok) throw new HttpError(401, 'invalid_link'); // link scaduto o già usato
        await sb.signOut(token); // il link non serve più
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/auth\/password\/?$/ },
);
