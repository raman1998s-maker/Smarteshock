// GET/POST /api/clienti · PATCH /api/clienti/:id (admin)
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { clienteSchema } from './_lib/schemas.js';
import { validate } from './_lib/validate.js';

export const config = { path: ['/api/clienti', '/api/clienti/:id'] };

const SELECT = 'id,nome,azienda,email,telefono,lingua,note,created_at,updated_at';

/** Testo di ricerca ripulito dai caratteri speciali della sintassi PostgREST. */
function testoRicerca(raw) {
  if (raw == null) return null;
  const s = raw.replace(/[^\p{L}\p{N} @.'_+-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > 60) throw new HttpError(400, 'invalid_input', { field: 'q' });
  return s || null;
}

export default createHandler(
  {
    GET: {
      auth: 'gestione',
      withId: false,
      async fn({ url, sb, token }) {
        const q = new URLSearchParams({ select: SELECT, order: 'nome.asc', limit: '500' });
        const testo = testoRicerca(url.searchParams.get('q'));
        if (testo) {
          const v = `"*${testo}*"`;
          q.set('or', `(nome.ilike.${v},azienda.ilike.${v},email.ilike.${v})`);
        }
        const rows = await sb.rest(`clienti?${q}`, { token });
        return json(200, { clienti: rows || [] });
      },
    },
    POST: {
      auth: 'gestione',
      withId: false,
      async fn({ req, sb, token }) {
        const data = validate(await readJson(req), clienteSchema);
        const rows = await sb.rest(`clienti?select=${SELECT}`, { method: 'POST', token, body: data, prefer: 'return=representation' });
        return json(201, { cliente: rows?.[0] ?? null });
      },
    },
    PATCH: {
      auth: 'gestione',
      withId: true,
      async fn({ req, params, sb, token }) {
        const data = validate(await readJson(req), clienteSchema, { partial: true });
        const rows = await sb.rest(`clienti?id=eq.${params.id}&select=${SELECT}`, {
          method: 'PATCH',
          token,
          body: data,
          prefer: 'return=representation',
        });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { cliente: rows[0] });
      },
    },
  },
  { pattern: /^\/api\/clienti(?:\/([^/]+))?\/?$/, paramNames: ['id'] },
);
