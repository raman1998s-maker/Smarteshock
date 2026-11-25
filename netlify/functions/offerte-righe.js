// PUT /api/offerte/:id/righe — sostituisce tutte le righe di un'offerta in bozza (gestione).
// Corpo: { "righe": [ { articolo_id?, descrizione, quantita, giorni, prezzo_unitario, sconto_percento } ] }
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { rigaOffertaSchema } from './_lib/schemas.js';
import { validate } from './_lib/validate.js';

export const config = { path: '/api/offerte/:id/righe' };

export default createHandler(
  {
    PUT: {
      auth: 'gestione',
      async fn({ req, params, sb, token }) {
        const body = await readJson(req, { maxBytes: 128 * 1024 });
        if (Object.keys(body).some((k) => k !== 'righe')) throw new HttpError(400, 'invalid_input');
        const list = body.righe;
        if (!Array.isArray(list) || list.length > 200) throw new HttpError(400, 'invalid_input', { field: 'righe' });
        const righe = list.map((r) => validate(r, rigaOffertaSchema));
        await sb.rest('rpc/imposta_righe_offerta', { method: 'POST', token, body: { p_offerta: params.id, p_righe: righe } });
        return json(200, { ok: true, righe: righe.length });
      },
    },
  },
  { pattern: /^\/api\/offerte\/([^/]+)\/righe\/?$/, paramNames: ['id'] },
);
