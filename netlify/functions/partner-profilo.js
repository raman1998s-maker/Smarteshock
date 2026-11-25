// GET/PUT /api/partner/profilo — il partner legge e salva il proprio profilo
// (ragione sociale, logo, banca, IVA, AGB). Lo sconto sul materiale non si cambia da qui (trigger nel DB).
import { createHandler } from './_lib/handler.js';
import { json, readJson } from './_lib/http.js';
import { partnerProfiloSchema } from './_lib/schemas.js';
import { validate } from './_lib/validate.js';

export const config = { path: '/api/partner/profilo' };

const SELECT = `staff_id,${Object.keys(partnerProfiloSchema).join(',')},sconto_partner_percento`;

export default createHandler(
  {
    GET: {
      auth: 'partner',
      async fn({ sb, token, user }) {
        const rows = await sb.rest(`partner_profili?staff_id=eq.${user.id}&select=${SELECT}`, { token });
        return json(200, { profilo: rows?.[0] ?? null });
      },
    },
    PUT: {
      auth: 'partner',
      async fn({ req, sb, token, user }) {
        const data = validate(await readJson(req, { maxBytes: 600 * 1024 }), partnerProfiloSchema);
        const tutti = Object.fromEntries(Object.keys(partnerProfiloSchema).map((k) => [k, data[k] ?? partnerProfiloSchema[k].default ?? null]));
        const rows = await sb.rest(`partner_profili?on_conflict=staff_id&select=${SELECT}`, {
          method: 'POST', token, body: { staff_id: user.id, ...tutti }, prefer: 'resolution=merge-duplicates,return=representation',
        });
        return json(200, { profilo: rows?.[0] ?? null });
      },
    },
  },
  { pattern: /^\/api\/partner\/profilo\/?$/ },
);
