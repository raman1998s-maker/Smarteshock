// Giorni di assenza dei dipendenti.
// GET    /api/assenze?da=&a=   le proprie (tecnico, base) o tutte (gestione) nel periodo
// POST   /api/assenze          { dal, al, motivo?, staff_id? } — staff_id solo per la gestione
// DELETE /api/assenze/:id      le proprie, o qualsiasi per la gestione (RLS)
import { isGestione } from './_lib/auth.js';
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { assenzaSchema } from './_lib/schemas.js';
import { isValidDate, validate } from './_lib/validate.js';

export const config = { path: ['/api/assenze', '/api/assenze/:id'] };

const SELECT = 'id,staff_id,dal,al,motivo,staff(nome)';

export default createHandler(
  {
    GET: {
      auth: 'user',
      withId: false,
      async fn({ url, sb, token }) {
        const q = new URLSearchParams({ select: SELECT, order: 'dal.asc', limit: '1000' });
        const da = url.searchParams.get('da');
        const a = url.searchParams.get('a');
        if (da) {
          if (!isValidDate(da)) throw new HttpError(400, 'invalid_input', { field: 'da' });
          q.set('al', `gte.${da}`);
        }
        if (a) {
          if (!isValidDate(a)) throw new HttpError(400, 'invalid_input', { field: 'a' });
          q.set('dal', `lte.${a}`);
        }
        const rows = await sb.rest(`assenze?${q}`, { token });
        return json(200, {
          assenze: (rows || []).map((r) => ({ id: r.id, staff_id: r.staff_id, dal: r.dal, al: r.al, motivo: r.motivo, nome: r.staff?.nome ?? null })),
        });
      },
    },
    POST: {
      auth: 'user',
      withId: false,
      async fn({ req, sb, token, user }) {
        const data = validate(await readJson(req), assenzaSchema);
        if (data.al < data.dal) throw new HttpError(400, 'invalid_input', { field: 'al' });
        if (!data.staff_id || !isGestione(user)) data.staff_id = user.id;
        const rows = await sb.rest(`assenze?select=${SELECT}`, { method: 'POST', token, body: data, prefer: 'return=representation' });
        const r = rows?.[0];
        return json(201, { assenza: r ? { id: r.id, staff_id: r.staff_id, dal: r.dal, al: r.al, motivo: r.motivo, nome: r.staff?.nome ?? null } : null });
      },
    },
    DELETE: {
      auth: 'user',
      withId: true,
      async fn({ params, sb, token }) {
        const rows = await sb.rest(`assenze?id=eq.${params.id}&select=id`, { method: 'DELETE', token, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/assenze(?:\/([^/]+))?\/?$/, paramNames: ['id'] },
);
