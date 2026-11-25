// GET/PUT /api/eventi/:id/compensi — paga della squadra per un evento (gestione).
// PUT sostituisce tutto: { "compensi": [ { staff_id, ruolo, quantita, tariffa_chf } ] }
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { compensoSchema } from './_lib/schemas.js';
import { validate } from './_lib/validate.js';

export const config = { path: '/api/eventi/:id/compensi' };

export default createHandler(
  {
    GET: {
      auth: 'gestione',
      async fn({ params, sb, token }) {
        const rows = await sb.rest(`compensi?evento_id=eq.${params.id}&select=id,staff_id,ruolo,quantita,tariffa_chf&order=created_at.asc`, { token });
        return json(200, { compensi: rows || [] });
      },
    },
    PUT: {
      auth: 'gestione',
      async fn({ req, params, sb, token }) {
        const body = await readJson(req);
        if (Object.keys(body).some((k) => k !== 'compensi')) throw new HttpError(400, 'invalid_input');
        const list = body.compensi;
        if (!Array.isArray(list) || list.length > 100) throw new HttpError(400, 'invalid_input', { field: 'compensi' });
        const compensi = list.map((c) => validate(c, compensoSchema));
        await sb.rest('rpc/imposta_compensi_evento', { method: 'POST', token, body: { p_evento: params.id, p_compensi: compensi } });
        return json(200, { ok: true, compensi });
      },
    },
  },
  { pattern: /^\/api\/eventi\/([^/]+)\/compensi\/?$/, paramNames: ['id'] },
);
