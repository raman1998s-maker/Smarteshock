// CMS (solo admin):
//   GET/POST     /api/contenuti/:sezione
//   PATCH/DELETE /api/contenuti/:sezione/:id
//   PUT          /api/contenuti/ordine/:sezione   { ids: [uuid, ...] }
// sezione = galleria | sale | dj | partner
import { sezione } from './_lib/cms.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { UUID_RE, createHandler } from './_lib/handler.js';
import { validate } from './_lib/validate.js';

export const config = {
  path: ['/api/contenuti/ordine/:sezione', '/api/contenuti/:sezione', '/api/contenuti/:sezione/:id'],
};

const MAX_IDS = 1000;

const voci = createHandler(
  {
    GET: {
      auth: 'admin',
      withId: false,
      async fn({ params, sb, token }) {
        const s = sezione(params.sezione);
        const q = new URLSearchParams({ select: s.select, order: 'ordine.asc,created_at.asc', limit: '1000' });
        const rows = await sb.rest(`${s.tabella}?${q}`, { token });
        return json(200, { voci: rows || [] });
      },
    },
    POST: {
      auth: 'admin',
      withId: false,
      async fn({ req, params, sb, token }) {
        const s = sezione(params.sezione);
        const data = validate(await readJson(req), s.schema);
        if (s.check) s.check(data);
        const rows = await sb.rest(`${s.tabella}?select=${s.select}`, {
          method: 'POST',
          token,
          body: data,
          prefer: 'return=representation',
        });
        return json(201, { voce: rows?.[0] ?? null });
      },
    },
    PATCH: {
      auth: 'admin',
      withId: true,
      async fn({ req, params, sb, token }) {
        const s = sezione(params.sezione);
        const data = validate(await readJson(req), s.schema, { partial: true });
        if (s.check) s.check(data);
        const rows = await sb.rest(`${s.tabella}?id=eq.${params.id}&select=${s.select}`, {
          method: 'PATCH',
          token,
          body: data,
          prefer: 'return=representation',
        });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { voce: rows[0] });
      },
    },
    DELETE: {
      auth: 'admin',
      withId: true,
      async fn({ params, sb, token }) {
        const s = sezione(params.sezione);
        const rows = await sb.rest(`${s.tabella}?id=eq.${params.id}&select=id`, {
          method: 'DELETE',
          token,
          prefer: 'return=representation',
        });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/contenuti\/([a-z]{1,20})(?:\/([^/]+))?\/?$/, paramNames: ['sezione', 'id'] },
);

const ordine = createHandler(
  {
    PUT: {
      auth: 'admin',
      async fn({ req, params, sb, token }) {
        sezione(params.sezione);
        const body = await readJson(req);
        if (Object.keys(body).some((k) => k !== 'ids')) throw new HttpError(400, 'invalid_input');
        const ids = body.ids;
        if (!Array.isArray(ids) || ids.length > MAX_IDS) throw new HttpError(400, 'invalid_input', { field: 'ids' });
        const seen = new Set();
        for (const id of ids) {
          if (typeof id !== 'string' || !UUID_RE.test(id) || seen.has(id.toLowerCase())) {
            throw new HttpError(400, 'invalid_input', { field: 'ids' });
          }
          seen.add(id.toLowerCase());
        }
        const aggiornate = await sb.rest('rpc/cms_riordina', {
          method: 'POST',
          token,
          body: { p_sezione: params.sezione, p_ids: [...seen] },
        });
        return json(200, { ok: true, aggiornate: Number.isInteger(aggiornate) ? aggiornate : 0 });
      },
    },
  },
  { pattern: /^\/api\/contenuti\/ordine\/([a-z]{1,20})\/?$/, paramNames: ['sezione'] },
);

export default function handler(req) {
  let pathname = '';
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    /* il gestore risponde 404 */
  }
  return /^\/api\/contenuti\/ordine(?:\/|$)/.test(pathname) ? ordine(req) : voci(req);
}

