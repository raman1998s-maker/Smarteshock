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
  titolo_firma: t.string({ max: 80 }), // es. "Inhaber"
  iban: t.string({ max: 42, pattern: /^[A-Z]{2}[0-9]{2}[A-Z0-9 ]{10,36}$/ }),
  twint: t.phone(),
  whatsapp: t.phone(),
  mwst_pflichtig: t.bool({ empty: false }), // false = "nicht mehrwertsteuerpflichtig" (niente IVA nel PDF)
  mwst_nr: t.string({ max: 40, pattern: /^CHE-?\d{3}\.?\d{3}\.?\d{3}( ?(MWST|TVA|IVA))?$/ }),
  piede: t.string({ max: 1000, multiline: true }), // riga libera in fondo alle pagine
};
// Regole dell'offerta (valori predefiniti della specifica di dicembre 2026, modificabili dall'admin).
const regoleSchema = {
  validita_giorni: t.int({ min: 1, max: 365 }),
  acconto_percento: t.int({ min: 0, max: 100 }),
  acconto_giorni: t.int({ min: 0, max: 90 }),
  saldo_giorni_prima: t.int({ min: 0, max: 90 }),
  sofort_sotto_giorni: t.int({ min: 0, max: 365 }),
  indennita_percento: t.int({ min: 0, max: 100 }),
  bedenkfrist_giorni: t.int({ min: 0, max: 60 }),
  km_inclusi: t.int({ min: 0, max: 1000 }),
  agb_versione: t.string({ max: 20 }),
  agb_stand: t.string({ max: 40 }),
};
const scaglioneSchema = {
  giorni_min: t.int({ min: 0, max: 3650, required: true }),
  percento: t.int({ min: 0, max: 100, required: true }),
};
const testiSchema = {
  introduzione: t.string({ max: 2000, multiline: true }),
  condizioni: t.string({ max: 4000, multiline: true }),
  saluti: t.string({ max: 300, multiline: true }),
  inbegriffen: t.string({ max: 500, multiline: true }), // {von} {bis} = orari di servizio
  chiusura: t.string({ max: 500, multiline: true }),
  agb: t.string({ max: 30000, multiline: true }),
};

// Tariffe proposte per la paga della squadra (es. "Autista + Installatore", 300 CHF; "Magazzino", 150 CHF al giorno).
const tariffaSchema = {
  ruolo: t.string({ max: 80, required: true }),
  tariffa: t.money({ max: 100000, required: true }),
  per_giorno: t.bool({ default: false, empty: false }),
};

export function validaImpostazioni(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_input');
  if (Object.keys(body).some((k) => !['ditta', 'testi', 'tariffe', 'regole', 'scaglioni'].includes(k))) throw new HttpError(400, 'invalid_input');
  const scaglioni = body.scaglioni ?? [];
  if (!Array.isArray(scaglioni) || scaglioni.length > 10) throw new HttpError(400, 'invalid_input', { field: 'scaglioni' });
  const tariffe = body.tariffe ?? [];
  if (!Array.isArray(tariffe) || tariffe.length > 30) throw new HttpError(400, 'invalid_input', { field: 'tariffe' });
  const out = {
    ditta: validate(body.ditta ?? {}, dittaSchema),
    regole: validate(body.regole ?? {}, regoleSchema),
    scaglioni: scaglioni.map((x) => validate(x, scaglioneSchema)).sort((a, b) => b.giorni_min - a.giorni_min),
    testi: {},
    tariffe: tariffe.map((x) => validate(x, tariffaSchema)),
  };
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
