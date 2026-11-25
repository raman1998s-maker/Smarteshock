// Partner (DJ) visti dall'ufficio.
// GET   /api/partner        elenco dei partner con profilo e sconto sul materiale (gestione)
// PATCH /api/partner/:id    { sconto_partner_percento } (gestione)
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { t, validate } from './_lib/validate.js';

export const config = {
  path: ['/api/partner', '/api/partner/:id'],
  excludedPath: ['/api/partner/profilo', '/api/partner/catalogo'],
};

export default createHandler(
  {
    GET: {
      auth: 'gestione',
      withId: false,
      async fn({ sb, token }) {
        const [staff, profili] = await Promise.all([
          sb.rest('staff?ruolo=eq.partner&select=id,nome,telefono,attivo&order=nome.asc', { token }),
          sb.rest('partner_profili?select=staff_id,ragione_sociale,persona,email,telefono,sconto_partner_percento,usa_agb_meekon', { token }),
        ]);
        const p = new Map((profili || []).map((x) => [x.staff_id, x]));
        return json(200, { partner: (staff || []).map((s) => ({ ...s, profilo: p.get(s.id) ?? null })) });
      },
    },
    PATCH: {
      auth: 'gestione',
      withId: true,
      async fn({ req, params, sb, token }) {
        const data = validate(await readJson(req), { sconto_partner_percento: t.decimal({ min: 0, max: 100, decimals: 2, required: true }) });
        // il profilo può non esistere ancora: lo si crea con il solo sconto
        const rows = await sb.rest('partner_profili?on_conflict=staff_id&select=staff_id,sconto_partner_percento', {
          method: 'POST', token, body: { staff_id: params.id, ...data }, prefer: 'resolution=merge-duplicates,return=representation',
        });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { profilo: rows[0] });
      },
    },
  },
  { pattern: /^\/api\/partner(?:\/([^/]+))?\/?$/, paramNames: ['id'] },
);
