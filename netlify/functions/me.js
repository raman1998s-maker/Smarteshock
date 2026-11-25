// GET /api/me — profilo dell'utente connesso (con la lingua dell'interfaccia).
// PATCH /api/me — { lingua: "it" | "de" | "en" } cambia la propria lingua.
import { createHandler } from './_lib/handler.js';
import { json, readJson } from './_lib/http.js';
import { t, validate } from './_lib/validate.js';

export const config = { path: '/api/me' };

export default createHandler(
  {
    GET: {
      auth: 'user',
      fn: ({ user }) => json(200, { id: user.id, nome: user.nome, ruolo: user.ruolo, lingua: user.lingua ?? null }),
    },
    PATCH: {
      auth: 'user',
      async fn({ req, sb, token }) {
        const d = validate(await readJson(req), { lingua: t.enumOf(['it', 'de', 'en'], { required: true }) });
        await sb.rest('rpc/imposta_mia_lingua', { method: 'POST', token, body: { p_lingua: d.lingua } });
        return json(200, { ok: true, lingua: d.lingua });
      },
    },
  },
  { pattern: /^\/api\/me\/?$/ },
);
