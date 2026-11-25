// Materiale difettoso (gestione).
// GET    /api/guasti?stato=aperti|tutti|<stato>   con descrizione e codice dell'articolo
// POST   /api/guasti        { articolo_id, quantita, descrizione?, costo_chf?, stato? }
// PATCH  /api/guasti/:id    { stato?, descrizione?, costo_chf?, quantita? }
// DELETE /api/guasti/:id
// I pezzi non "riparati" non contano come disponibili (disponibilita_articoli).
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { t, validate } from './_lib/validate.js';

export const config = { path: ['/api/guasti', '/api/guasti/:id'] };

const STATI = ['da_riparare', 'in_riparazione', 'riparato', 'da_buttare'];
const SELECT = 'id,articolo_id,quantita,stato,descrizione,costo_chf,evento_id,created_at,updated_at,articolo:articoli(descrizione,codice,categoria),evento:eventi(titolo,numero_ordine)';
const schema = {
  articolo_id: t.uuid({ required: true }),
  quantita: t.int({ min: 1, max: 100000, default: 1, empty: 1 }),
  stato: t.enumOf(STATI, { default: 'da_riparare' }),
  descrizione: t.string({ max: 1000, multiline: true }),
  costo_chf: t.money({ max: 1000000 }),
};

export default createHandler(
  {
    GET: {
      auth: 'gestione',
      withId: false,
      async fn({ url, sb, token }) {
        const q = new URLSearchParams({ select: SELECT, order: 'created_at.desc', limit: '1000' });
        const s = url.searchParams.get('stato') || 'aperti';
        if (s === 'aperti') q.set('stato', 'in.(da_riparare,in_riparazione)');
        else if (STATI.includes(s)) q.set('stato', `eq.${s}`);
        else if (s !== 'tutti') throw new HttpError(400, 'invalid_input', { field: 'stato' });
        const rows = await sb.rest(`guasti?${q}`, { token });
        return json(200, { guasti: rows || [] });
      },
    },
    POST: {
      auth: 'gestione',
      withId: false,
      async fn({ req, sb, token }) {
        const d = validate(await readJson(req), schema);
        const rows = await sb.rest(`guasti?select=${SELECT}`, { method: 'POST', token, body: d, prefer: 'return=representation' });
        return json(201, { guasto: rows?.[0] ?? null });
      },
    },
    PATCH: {
      auth: 'gestione',
      withId: true,
      async fn({ req, params, sb, token }) {
        const d = validate(await readJson(req), { ...schema, articolo_id: t.uuid() }, { partial: true });
        delete d.articolo_id;
        if (!Object.keys(d).length) throw new HttpError(400, 'invalid_input');
        const rows = await sb.rest(`guasti?id=eq.${params.id}&select=${SELECT}`, { method: 'PATCH', token, body: d, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { guasto: rows[0] });
      },
    },
    DELETE: {
      auth: 'gestione',
      withId: true,
      async fn({ params, sb, token }) {
        const rows = await sb.rest(`guasti?id=eq.${params.id}&select=id`, { method: 'DELETE', token, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/guasti(?:\/([^/]+))?\/?$/, paramNames: ['id'] },
);
