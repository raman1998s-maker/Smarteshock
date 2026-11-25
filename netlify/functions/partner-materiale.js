// POST /api/partner-offerte/:id/materiale — l'ufficio decide sulla richiesta di materiale di un partner.
// { azione: "conferma", nota? } → nasce l'evento Meekon con la lista del materiale
// { azione: "rifiuta", nota }   → la richiesta torna al partner con la nota
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { t, validate } from './_lib/validate.js';

export const config = { path: '/api/partner-offerte/:id/materiale' };

export default createHandler(
  {
    POST: {
      auth: 'gestione',
      async fn({ req, params, sb, token }) {
        const d = validate(await readJson(req), { azione: t.enumOf(['conferma', 'rifiuta'], { required: true }), nota: t.string({ max: 2000, multiline: true }) });
        if (d.azione === 'conferma') {
          const evento = await sb.rest('rpc/conferma_materiale_partner', { method: 'POST', token, body: { p_offerta: params.id, p_nota: d.nota ?? null } });
          return json(200, { ok: true, evento_id: evento });
        }
        if (!d.nota) throw new HttpError(400, 'invalid_input', { field: 'nota' });
        const rows = await sb.rest(`partner_offerte?id=eq.${params.id}&materiale_stato=in.(in_attesa,da_confermare)&select=id`, {
          method: 'PATCH', token, body: { materiale_stato: 'rifiutato', nota_meekon: d.nota }, prefer: 'return=representation',
        });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(409, 'conflict');
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/partner-offerte\/([^/]+)\/materiale\/?$/, paramNames: ['id'] },
);
