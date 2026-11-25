// GET/POST /api/articoli · PATCH/DELETE /api/articoli/:id — catalogo del magazzino.
// Lettura e modifica: gestione (admin + ufficio). Cancellazione: solo admin
// (meglio disattivare: le righe di offerte e checklist restano collegate).
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { articoloSchema } from './_lib/schemas.js';
import { validate } from './_lib/validate.js';

export const config = {
  path: ['/api/articoli', '/api/articoli/:id'],
  excludedPath: ['/api/articoli/disponibilita', '/api/articoli/importa'],
};

export const SELECT_ARTICOLO =
  'id,codice,categoria,sottocategoria,marca,descrizione,accessori,note,quantita,danneggiati,prezzo_noleggio_giorno,prezzo_vendita,in_vendita,attivo,updated_at';

function testoRicerca(raw) {
  if (raw == null) return null;
  const s = raw.replace(/[^\p{L}\p{N} .'_+-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > 60) throw new HttpError(400, 'invalid_input', { field: 'q' });
  return s || null;
}

export default createHandler(
  {
    GET: {
      auth: 'gestione',
      withId: false,
      async fn({ url, sb, token }) {
        const q = new URLSearchParams({ select: SELECT_ARTICOLO, order: 'categoria.asc,descrizione.asc', limit: '2000' });
        const testo = testoRicerca(url.searchParams.get('q'));
        if (testo) {
          const v = `"*${testo}*"`;
          q.set('or', `(descrizione.ilike.${v},marca.ilike.${v},categoria.ilike.${v},sottocategoria.ilike.${v},codice.ilike.${v})`);
        }
        if (url.searchParams.get('in_vendita') === '1') q.set('in_vendita', 'is.true');
        if (url.searchParams.get('tutti') !== '1') q.set('attivo', 'is.true');
        const rows = await sb.rest(`articoli?${q}`, { token });
        return json(200, { articoli: rows || [] });
      },
    },
    POST: {
      auth: 'gestione',
      withId: false,
      async fn({ req, sb, token }) {
        const data = validate(await readJson(req), articoloSchema);
        const rows = await sb.rest(`articoli?select=${SELECT_ARTICOLO}`, { method: 'POST', token, body: data, prefer: 'return=representation' });
        return json(201, { articolo: rows?.[0] ?? null });
      },
    },
    PATCH: {
      auth: 'gestione',
      withId: true,
      async fn({ req, params, sb, token }) {
        const data = validate(await readJson(req), articoloSchema, { partial: true });
        const rows = await sb.rest(`articoli?id=eq.${params.id}&select=${SELECT_ARTICOLO}`, {
          method: 'PATCH', token, body: data, prefer: 'return=representation',
        });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { articolo: rows[0] });
      },
    },
    DELETE: {
      auth: 'admin',
      withId: true,
      async fn({ params, sb, token }) {
        const rows = await sb.rest(`articoli?id=eq.${params.id}&select=id`, { method: 'DELETE', token, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/articoli(?:\/([^/]+))?\/?$/, paramNames: ['id'] },
);
