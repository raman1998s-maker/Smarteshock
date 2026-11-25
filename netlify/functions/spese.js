// Spese degli operai.
// GET    /api/spese?da=&a=&stato=  le proprie (o tutte per la gestione, con ?tutte=1)
// POST   /api/spese                { evento_id?, data?, tipo, importo_chf, descrizione? } — sempre come "inviata"
// PATCH  /api/spese/:id            { stato: approvata | rifiutata | inviata } (gestione)
// DELETE /api/spese/:id            la propria finché è "inviata", o qualsiasi per la gestione (RLS)
import { isGestione } from './_lib/auth.js';
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { spesaSchema } from './_lib/schemas.js';
import { t, isValidDate, validate } from './_lib/validate.js';

export const config = { path: ['/api/spese', '/api/spese/:id'] };

const SELECT = 'id,staff_id,evento_id,data,tipo,importo_chf,descrizione,stato,created_at,staff(nome)';
const piatta = (r) => ({ ...r, nome: r.staff?.nome ?? null, staff: undefined });

export default createHandler(
  {
    GET: {
      auth: 'user',
      withId: false,
      async fn({ url, sb, token, user }) {
        const q = new URLSearchParams({ select: SELECT, order: 'data.desc,created_at.desc', limit: '1000' });
        const da = url.searchParams.get('da');
        const a = url.searchParams.get('a');
        const stato = url.searchParams.get('stato');
        if (da) { if (!isValidDate(da)) throw new HttpError(400, 'invalid_input', { field: 'da' }); q.append('data', `gte.${da}`); }
        if (a) { if (!isValidDate(a)) throw new HttpError(400, 'invalid_input', { field: 'a' }); q.append('data', `lte.${a}`); }
        if (stato) { if (!['inviata', 'approvata', 'rifiutata'].includes(stato)) throw new HttpError(400, 'invalid_input', { field: 'stato' }); q.set('stato', `eq.${stato}`); }
        if (!(isGestione(user) && url.searchParams.get('tutte') === '1')) q.set('staff_id', `eq.${user.id}`);
        const rows = await sb.rest(`spese?${q}`, { token });
        return json(200, { spese: (rows || []).map(piatta) });
      },
    },
    POST: {
      auth: 'user',
      withId: false,
      async fn({ req, sb, token, user }) {
        const data = validate(await readJson(req), spesaSchema);
        if (!(data.importo_chf > 0)) throw new HttpError(400, 'invalid_input', { field: 'importo_chf' });
        const rows = await sb.rest(`spese?select=${SELECT}`, {
          method: 'POST', token, body: { ...data, staff_id: user.id, stato: 'inviata' }, prefer: 'return=representation',
        });
        return json(201, { spesa: rows?.[0] ? piatta(rows[0]) : null });
      },
    },
    PATCH: {
      auth: 'gestione',
      withId: true,
      async fn({ req, params, sb, token }) {
        const data = validate(await readJson(req), { stato: t.enumOf(['inviata', 'approvata', 'rifiutata'], { required: true }) });
        const rows = await sb.rest(`spese?id=eq.${params.id}&select=${SELECT}`, { method: 'PATCH', token, body: data, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { spesa: piatta(rows[0]) });
      },
    },
    DELETE: {
      auth: 'user',
      withId: true,
      async fn({ params, sb, token }) {
        const rows = await sb.rest(`spese?id=eq.${params.id}&select=id`, { method: 'DELETE', token, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(409, 'conflict');
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/spese(?:\/([^/]+))?\/?$/, paramNames: ['id'] },
);
