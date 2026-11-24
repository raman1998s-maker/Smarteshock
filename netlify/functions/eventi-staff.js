// PUT /api/eventi/:id/staff — sostituisce i dipendenti assegnati (admin).
// Corpo: { "assegnazioni": [ { "staff_id": "<uuid>", "ruolo_evento": "audio" } ] }
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { t, validate } from './_lib/validate.js';

export const config = { path: '/api/eventi/:id/staff' };

const itemSchema = {
  staff_id: t.uuid({ required: true }),
  ruolo_evento: t.string({ max: 80 }),
};

export default createHandler(
  {
    PUT: {
      auth: 'admin',
      async fn({ req, params, sb, token }) {
        const body = await readJson(req);
        if (Object.keys(body).some((k) => k !== 'assegnazioni')) throw new HttpError(400, 'invalid_input');
        const list = body.assegnazioni;
        if (!Array.isArray(list) || list.length > 50) throw new HttpError(400, 'invalid_input', { field: 'assegnazioni' });
        const seen = new Set();
        const assegnazioni = [];
        for (const item of list) {
          const v = validate(item, itemSchema);
          if (seen.has(v.staff_id)) continue;
          seen.add(v.staff_id);
          assegnazioni.push(v);
        }
        await sb.rest('rpc/imposta_staff_evento', {
          method: 'POST',
          token,
          body: { p_evento: params.id, p_assegnazioni: assegnazioni },
        });
        return json(200, { ok: true, assegnazioni });
      },
    },
  },
  { pattern: /^\/api\/eventi\/([^/]+)\/staff\/?$/, paramNames: ['id'] },
);
