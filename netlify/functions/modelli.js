// Modelli di allestimento (pacchetti di materiale).
// GET    /api/modelli        con le voci; gestione: tutti, partner: solo quelli "per i partner" attivi (RLS)
// POST   /api/modelli        { nome, descrizione?, per_partner?, attivo?, voci: [{ articolo_id, quantita }] } (gestione)
// PUT    /api/modelli/:id    come POST, sostituisce tutto (gestione)
// DELETE /api/modelli/:id    (gestione)
import { isGestione } from './_lib/auth.js';
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { t, validate } from './_lib/validate.js';

export const config = { path: ['/api/modelli', '/api/modelli/:id'] };

const modelloSchema = {
  nome: t.string({ max: 120, required: true }),
  descrizione: t.string({ max: 500, multiline: true }),
  per_partner: t.bool({ default: true, empty: true }),
  attivo: t.bool({ default: true, empty: true }),
  prezzo_giorno: t.money(), // prezzo di noleggio del pacchetto al giorno
  categoria: t.string({ max: 60 }), // gruppo nel PDF (es. LED, Licht, Audio)
  immagine: t.string({ max: 900000, pattern: /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/ }), // disegno dell'allestimento
};
const voceSchema = { articolo_id: t.uuid({ required: true }), quantita: t.int({ min: 1, max: 100000, default: 1, empty: 1 }) };

function leggi(body) {
  const d = validate(body, modelloSchema, { ignore: ['voci'] });
  if (!Array.isArray(body.voci) || body.voci.length > 200) throw new HttpError(400, 'invalid_input', { field: 'voci' });
  d.voci = body.voci.map((v) => validate(v, voceSchema));
  return d;
}

async function salva({ req, params, sb, token }) {
  const d = leggi(await readJson(req, { maxBytes: 1024 * 1024 }));
  const id = await sb.rest('rpc/salva_modello', { method: 'POST', token, body: { p_id: params.id ?? null, p_dati: d } });
  return json(params.id ? 200 : 201, { id });
}

export default createHandler(
  {
    GET: {
      auth: 'user',
      withId: false,
      async fn({ sb, token, user }) {
        if (!isGestione(user) && user.ruolo !== 'partner') throw new HttpError(403, 'forbidden');
        const rows = await sb.rest('modelli?select=id,nome,descrizione,per_partner,attivo,prezzo_giorno,categoria,immagine,voci:modelli_voci(articolo_id,quantita,posizione)&order=posizione.asc,nome.asc', { token });
        return json(200, { modelli: (rows || []).map((m) => ({ ...m, voci: (m.voci || []).sort((a, b) => a.posizione - b.posizione) })) });
      },
    },
    POST: { auth: 'gestione', withId: false, fn: salva },
    PUT: { auth: 'gestione', withId: true, fn: salva },
    DELETE: {
      auth: 'gestione',
      withId: true,
      async fn({ params, sb, token }) {
        const rows = await sb.rest(`modelli?id=eq.${params.id}&select=id`, { method: 'DELETE', token, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/modelli(?:\/([^/]+))?\/?$/, paramNames: ['id'] },
);
