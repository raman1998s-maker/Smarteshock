// GET /api/impostazioni — intestazione della ditta, testi predefiniti e AGB delle offerte,
// tariffe della squadra (gestione).
// PUT /api/impostazioni — li sostituisce (solo admin).
// Stanno nel database (tabella impostazioni, riga unica) e non nel codice: indirizzo,
// coordinate bancarie e AGB non devono finire nel repository.
// Nei testi, {cliente} viene sostituito con il nome del cliente.
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { LINGUE } from './_lib/schemas.js';
import { t, validate } from './_lib/validate.js';

export const config = { path: '/api/impostazioni' };

const dittaSchema = {
  nome: t.string({ max: 120 }),
  persona: t.string({ max: 120 }),
  slogan: t.string({ max: 160 }),
  indirizzo: t.string({ max: 300, multiline: true }),
  telefono: t.phone(),
  email: t.email(),
  piede: t.string({ max: 1000, multiline: true }), // es. banca, IBAN, TWINT (riga in fondo alle AGB)
};
const testiSchema = {
  introduzione: t.string({ max: 2000, multiline: true }),
  condizioni: t.string({ max: 4000, multiline: true }),
  saluti: t.string({ max: 300, multiline: true }),
  agb: t.string({ max: 20000, multiline: true }),
};

// Tariffe proposte per la paga della squadra (es. "Autista + Installatore", 300 CHF; "Magazzino", 150 CHF al giorno).
const tariffaSchema = {
  ruolo: t.string({ max: 80, required: true }),
  tariffa: t.money({ max: 100000, required: true }),
  per_giorno: t.bool({ default: false, empty: false }),
};

export function validaImpostazioni(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_input');
  if (Object.keys(body).some((k) => !['ditta', 'testi', 'tariffe'].includes(k))) throw new HttpError(400, 'invalid_input');
  const tariffe = body.tariffe ?? [];
  if (!Array.isArray(tariffe) || tariffe.length > 30) throw new HttpError(400, 'invalid_input', { field: 'tariffe' });
  const out = { ditta: validate(body.ditta ?? {}, dittaSchema), testi: {}, tariffe: tariffe.map((x) => validate(x, tariffaSchema)) };
  const testi = body.testi ?? {};
  if (typeof testi !== 'object' || Array.isArray(testi)) throw new HttpError(400, 'invalid_input', { field: 'testi' });
  for (const k of Object.keys(testi)) {
    if (!LINGUE.includes(k)) throw new HttpError(400, 'invalid_input', { field: 'testi' });
    out.testi[k] = validate(testi[k] ?? {}, testiSchema);
  }
  return out;
}

export default createHandler(
  {
    GET: {
      auth: 'gestione',
      async fn({ sb, token }) {
        const rows = await sb.rest('impostazioni?id=eq.1&select=dati,updated_at', { token });
        return json(200, { impostazioni: rows?.[0]?.dati ?? {}, updated_at: rows?.[0]?.updated_at ?? null });
      },
    },
    PUT: {
      auth: 'admin',
      async fn({ req, sb, token }) {
        const dati = validaImpostazioni(await readJson(req, { maxBytes: 64 * 1024 }));
        const rows = await sb.rest('impostazioni?id=eq.1&select=dati', { method: 'PATCH', token, body: { dati }, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { impostazioni: rows[0].dati });
      },
    },
  },
  { pattern: /^\/api\/impostazioni\/?$/ },
);
