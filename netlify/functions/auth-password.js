// POST /api/auth/password — scelta della password dal link di invito (o di recupero) mandato dall'amministratore.
// Corpo: { token_hash, type, password } (link ?th=…&t=…) oppure { access_token, password } (vecchi link #access_token=…).
// Il token hash si verifica solo al salvataggio, così le anteprime dei link nelle chat non lo consumano.
// Per i vecchi link il token arriva nel frammento (#access_token=…):
// la pagina lo legge, lo manda qui una sola volta e lo cancella dall'indirizzo. Nessun cookie viene creato:
// dopo, la persona entra dalla pagina di accesso con e-mail e nuova password.
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';

export const config = { path: '/api/auth/password' };

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const TH_RE = /^[A-Za-z0-9_-]{10,200}$/;

export default createHandler(
  {
    POST: {
      auth: 'public',
      async fn({ req, sb }) {
        const body = await readJson(req, { maxBytes: 8 * 1024 });
        const password = body.password; // niente trim
        if (typeof password !== 'string' || password.length < 10 || password.length > 128) throw new HttpError(400, 'invalid_input', { field: 'password' });
        let token = body.access_token;
        if (body.token_hash !== undefined) {
          // link nuovo: ?th=…&t=invite|recovery — il token si verifica (e si consuma) solo adesso
          if (typeof body.token_hash !== 'string' || !TH_RE.test(body.token_hash)) throw new HttpError(400, 'invalid_input', { field: 'token_hash' });
          if (!['invite', 'recovery'].includes(body.type)) throw new HttpError(400, 'invalid_input', { field: 'type' });
          token = await sb.verifyTokenHash(body.token_hash, body.type);
          if (!token) throw new HttpError(401, 'invalid_link');
        }
        if (typeof token !== 'string' || token.length > 4096 || !JWT_RE.test(token)) throw new HttpError(400, 'invalid_input', { field: 'access_token' });
        const ok = await sb.updatePassword(token, password);
        if (!ok) throw new HttpError(401, 'invalid_link'); // link scaduto o già usato
        await sb.signOut(token); // il link non serve più
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/auth\/password\/?$/ },
);
