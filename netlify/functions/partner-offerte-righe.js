// PUT /api/partner-offerte/:id/righe — righe dell'offerta del partner (solo in bozza).
// Righe "servizio" (prestazioni del DJ) o "materiale" (articolo del catalogo Meekon, articolo_id obbligatorio).
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { partnerRigaSchema } from './_lib/schemas.js';
import { validate } from './_lib/validate.js';

export const config = { path: '/api/partner-offerte/:id/righe' };

export default createHandler(
  {
    PUT: {
      auth: 'partner',
      async fn({ req, params, sb, token }) {
        const body = await readJson(req, { maxBytes: 128 * 1024 });
        if (Object.keys(body).some((k) => k !== 'righe')) throw new HttpError(400, 'invalid_input');
        if (!Array.isArray(body.righe) || body.righe.length > 200) throw new HttpError(400, 'invalid_input', { field: 'righe' });
        const righe = body.righe.map((r) => validate(r, partnerRigaSchema));
        if (righe.some((r) => r.tipo === 'materiale' && !r.articolo_id)) throw new HttpError(400, 'invalid_input', { field: 'articolo_id' });
        if (righe.some((r) => r.tipo === 'pacchetto' && !(r.componenti && r.componenti.length))) throw new HttpError(400, 'invalid_input', { field: 'componenti' });
        await sb.rest('rpc/imposta_righe_partner', { method: 'POST', token, body: { p_offerta: params.id, p_righe: righe } });
        return json(200, { ok: true, righe: righe.length });
      },
    },
  },
  { pattern: /^\/api\/partner-offerte\/([^/]+)\/righe\/?$/, paramNames: ['id'] },
);
