// Carico dei veicoli di un evento.
// GET /api/eventi/:id/veicoli   veicoli scelti + peso caricato per veicolo (anche "non assegnato") — gestione e squadra dell'evento
// PUT /api/eventi/:id/veicoli   { veicoli: [id, …] } sostituisce i veicoli scelti (gestione)
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';

export const config = { path: '/api/eventi/:id/veicoli' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default createHandler(
  {
    GET: {
      auth: 'user',
      async fn({ params, sb, token, user }) {
        if (user.ruolo === 'partner') throw new HttpError(403, 'forbidden');
        const carico = await sb.rest('rpc/carico_veicoli', { method: 'POST', token, body: { p_evento: params.id } });
        return json(200, { carico: carico || [] });
      },
    },
    PUT: {
      auth: 'gestione',
      async fn({ req, params, sb, token }) {
        const body = await readJson(req);
        const ids = body.veicoli;
        if (!Array.isArray(ids) || ids.length > 20 || ids.some((x) => typeof x !== 'string' || !UUID.test(x))) {
          throw new HttpError(400, 'invalid_input', { field: 'veicoli' });
        }
        await sb.rest(`eventi_veicoli?evento_id=eq.${params.id}`, { method: 'DELETE', token });
        if (ids.length) {
          await sb.rest('eventi_veicoli', { method: 'POST', token, body: [...new Set(ids)].map((v) => ({ evento_id: params.id, veicolo_id: v })), prefer: 'return=minimal' });
        }
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/eventi\/([^/]+)\/veicoli\/?$/, paramNames: ['id'] },
);
