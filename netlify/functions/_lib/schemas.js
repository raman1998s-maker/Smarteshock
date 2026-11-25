// Schemi di validazione condivisi e costanti del modello dati.

import { HttpError } from './http.js';
import { t, validate } from './validate.js';

export const STATI_EVENTO = ['richiesta', 'offerta', 'confermato', 'completato', 'annullato'];
export const PAESI = ['CH', 'IT', 'DE', 'FR'];
export const LINGUE = ['it', 'de', 'fr', 'en'];
export const STATI_RICHIESTA = ['nuova', 'gestita', 'scartata'];
export const CAMPI_ECONOMICI = ['importo_chf', 'acconto_pagato', 'saldo_pagato'];
/** Campi che tecnico e base non ricevono mai: importi + note interne. */
export const CAMPI_SOLO_ADMIN = [...CAMPI_ECONOMICI, 'note_interne'];

export const eventoSchema = {
  cliente_id: t.uuid(),
  titolo: t.string({ max: 200, required: true }),
  tipo: t.string({ max: 80 }),
  stato: t.enumOf(STATI_EVENTO, { default: 'richiesta', required: false }),
  data_inizio: t.datetime(),
  data_fine: t.datetime(),
  montaggio_da: t.datetime(),
  smontaggio_da: t.datetime(),
  localita: t.string({ max: 200 }),
  sala: t.string({ max: 200 }),
  indirizzo: t.string({ max: 300 }),
  contatto_luogo_nome: t.string({ max: 120 }),
  contatto_luogo_telefono: t.phone(),
  paese: t.enumOf(PAESI, { default: 'CH' }),
  ospiti: t.int({ min: 0, max: 100000 }),
  servizi: t.array(t.string({ max: 80 }), { max: 30 }),
  programma: t.string({ max: 10000, multiline: true }),
  note_squadra: t.string({ max: 10000, multiline: true }), // visibili ai tecnici assegnati
  note_interne: t.string({ max: 10000, multiline: true }), // solo admin
  importo_chf: t.money(),
  acconto_pagato: t.bool({ default: false }),
  saldo_pagato: t.bool({ default: false }),
};

export const clienteSchema = {
  nome: t.string({ max: 120, required: true }),
  azienda: t.string({ max: 160 }),
  email: t.email(),
  telefono: t.phone(),
  lingua: t.enumOf(LINGUE, { default: 'it' }),
  indirizzo: t.string({ max: 300, multiline: true }), // obbligatorio prima di inviare un'offerta
  anrede: t.string({ max: 200 }), // es. "Liebe Anna, lieber Marco" / "Sehr geehrter Herr Muster"
  note: t.string({ max: 4000, multiline: true }),
};

export const checklistCreateSchema = {
  voce: t.string({ max: 200, required: true }),
  quantita: t.int({ min: 1, max: 100000, default: 1 }),
  articolo_id: t.uuid(),
  note: t.string({ max: 1000, multiline: true }),
};

// Il tecnico può cambiare solo caricato, rientrato, mancanti, danneggiati e note (trigger nel DB).
export const checklistUpdateSchema = {
  caricato: t.bool(),
  rientrato: t.bool(),
  mancanti: t.int({ min: 0, max: 100000, empty: 0 }),
  veicolo_id: t.uuid(), // su quale furgone va la voce (solo la gestione: trigger nel DB)
  quantita: t.int({ min: 1, max: 100000 }), // per dividere una voce su più veicoli (solo la gestione: trigger nel DB)
  danneggiati: t.int({ min: 0, max: 100000, empty: 0 }),
  note: t.string({ max: 1000, multiline: true }),
};

// Modulo pubblico del sito. tipo e servizi sono testi tradotti (le opzioni
// del modulo cambiano con la lingua), quindi si limitano lunghezza e numero.
export const richiestaSchema = {
  nome: t.string({ max: 120, required: true }),
  email: t.email({ required: true }),
  telefono: t.phone(),
  tipo: t.string({ max: 80 }),
  data: t.date(),
  localita: t.string({ max: 120 }),
  ospiti: t.int({ min: 1, max: 100000 }),
  servizi: t.array(t.string({ max: 60 }), { max: 15 }),
  messaggio: t.string({ max: 4000, multiline: true }),
  lingua: t.enumOf(LINGUE, { default: 'it' }),
  paese: t.enumOf(PAESI), // facoltativo: vuoto/assente → null
};

// Dettagli tecnici sul luogo (blocco facoltativo del modulo pubblico).
// Nel modulo i campi si chiamano "dt_<chiave>"; si salvano in
// richieste_web.dettagli_tecnici (jsonb) senza il prefisso. Solo valori fissi
// (enum) o testi brevi; le chiavi sconosciute vengono ignorate.
const SI_NO_NONSO = ['si', 'no', 'non_so'];
export const DT_PREFIX = 'dt_';
export const DT_ARRAY = ['prese'];
export const FORNITORI = ['decorazioni', 'foto', 'musica', 'planner', 'location'];
export const dettagliTecniciSchema = {
  spazio: t.enumOf(['sala', 'tendone', 'capannone', 'aperto']),
  copertura: t.enumOf(SI_NO_NONSO),
  grandezza: t.enumOf(['piccola', 'media', 'grande', 'non_so']),
  superficie_m2: t.int({ min: 1, max: 10000 }),
  altezza_m: t.decimal({ min: 1, max: 40, decimals: 1 }),
  accesso: t.enumOf(['piano_terra', 'ascensore', 'scale', 'non_so']),
  scarico: t.enumOf(SI_NO_NONSO),
  prese: t.array(t.enumOf(['230v', 'cee16', 'cee32', 'cee63', 'cee125', 'non_so']), { max: 6 }), // CEE per amperaggio
  prese_230v_n: t.int({ min: 1, max: 50 }), // quante prese di quel tipo
  prese_cee16_n: t.int({ min: 1, max: 50 }), // quante prese di quel tipo
  prese_cee32_n: t.int({ min: 1, max: 50 }), // quante prese di quel tipo
  prese_cee63_n: t.int({ min: 1, max: 50 }), // quante prese di quel tipo
  prese_cee125_n: t.int({ min: 1, max: 50 }), // quante prese di quel tipo
  prese_vicine: t.enumOf(SI_NO_NONSO), // "no" = a più di ~20 m
  montaggio_dalle: t.string({ max: 80 }),
  smontaggio_entro: t.string({ max: 80 }),
  montaggio_giorno_prima: t.enumOf(['possibile', 'richiesto', 'non_possibile', 'non_so']),
  volume_limiti: t.enumOf(SI_NO_NONSO),
  volume_quali: t.string({ max: 120 }),
  musica_fino: t.string({ max: 5, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ }), // "HH:MM"
  decibel_max: t.int({ min: 60, max: 120 }),
  discorsi: t.enumOf(['si', 'no']),
  oratori: t.enumOf(['1_2', '3_5', 'oltre_5']),
  rilevatori_fumo: t.enumOf(SI_NO_NONSO),
  nebbia_permessa: t.enumOf(['si', 'no', 'da_chiedere']),
  uscite_libere: t.enumOf(['si', 'verifichiamo', 'non_so']),
  contenuti_da: t.enumOf(['cliente', 'agenzia', 'meekon']),
  // Altri fornitori dell'evento (dati di terzi): solo nome/ditta e un contatto, testi brevi.
  ...Object.fromEntries(
    FORNITORI.flatMap((r) => [[`forn_${r}_nome`, t.string({ max: 80 })], [`forn_${r}_contatto`, t.string({ max: 80 })]]),
  ),
};

/**
 * Estrae e valida i campi "dt_*" del corpo della richiesta.
 * @returns {object|null} solo i valori compilati, oppure null se non c'è niente.
 */
export function dettagliTecnici(body) {
  const input = {};
  for (const key of Object.keys(dettagliTecniciSchema)) {
    const name = DT_PREFIX + key;
    if (Object.prototype.hasOwnProperty.call(body, name)) input[key] = body[name];
  }
  let valid;
  try {
    valid = validate(input, dettagliTecniciSchema);
  } catch (err) {
    // il campo dell'errore col nome usato nel modulo (dt_...), così il browser lo evidenzia
    const field = err instanceof HttpError && err.extra && err.extra.field;
    if (field && Object.prototype.hasOwnProperty.call(dettagliTecniciSchema, field)) {
      throw new HttpError(400, 'invalid_input', { field: DT_PREFIX + field });
    }
    throw err;
  }
  const out = {};
  for (const [key, value] of Object.entries(valid)) {
    if (value !== null && !(Array.isArray(value) && value.length === 0)) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Rimuove i campi economici e note_interne (difesa in profondità per il ruolo
 * tecnico: la vista eventi_tecnico non li restituisce già).
 */
export function perTecnico(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const copy = { ...obj };
  for (const k of CAMPI_SOLO_ADMIN) delete copy[k];
  return copy;
}

// ---------------------------------------------------------------------
// Gestionale: magazzino, offerte, assenze
// ---------------------------------------------------------------------
export const articoloSchema = {
  codice: t.string({ max: 40 }), // codice dell'etichetta, es. E000006623 (unico)
  categoria: t.string({ max: 60, required: true }),
  sottocategoria: t.string({ max: 60 }),
  marca: t.string({ max: 80 }),
  descrizione: t.string({ max: 300, required: true }),
  accessori: t.string({ max: 1000, multiline: true }),
  note: t.string({ max: 1000, multiline: true }),
  quantita: t.int({ min: 0, max: 100000, default: 0, empty: 0 }),
  danneggiati: t.int({ min: 0, max: 100000, default: 0, empty: 0 }),
  peso_kg: t.decimal({ min: 0, max: 100000, decimals: 2 }),
  prezzo_noleggio_giorno: t.money(),
  prezzo_vendita: t.money(),
  in_vendita: t.bool({ default: false, empty: false }),
  attivo: t.bool({ default: true, empty: true }),
};

export const STATI_OFFERTA = ['bozza', 'inviata', 'accettata', 'rifiutata', 'scaduta'];

export const offertaSchema = {
  stato: t.enumOf(STATI_OFFERTA),
  lingua: t.enumOf(LINGUE),
  anrede: t.string({ max: 200 }),
  prezzi_iva_inclusa: t.bool({ empty: true }),
  sconto_percento: t.decimal({ min: 0, max: 100, decimals: 2, empty: 0 }),
  valida_fino: t.date(),
  iva_percento: t.decimal({ min: 0, max: 30, decimals: 2, empty: 8.1 }),
  sconto_chf: t.money({ empty: 0 }),
  introduzione: t.string({ max: 4000, multiline: true }),
  condizioni: t.string({ max: 4000, multiline: true }),
};

// componenti di un pacchetto (modello di allestimento): [{ articolo_id, quantita }] per 1 pacchetto
const componentiSchema = t.array((v, f) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'invalid_input', { field: f });
  return validate(v, { articolo_id: t.uuid({ required: true }), quantita: t.int({ min: 1, max: 100000, required: true }) });
}, { max: 200, empty: null });

// scelta nel configuratore visivo: schermi/pista { parte, w, h }, pezzi { parte, n }
const configurazioneSchema = (v, f) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'invalid_input', { field: f });
  const c = validate(v, {
    parte: t.enumOf(['truss', 'luci_truss', 'schermo_dietro', 'schermo_davanti', 'regia', 'live_stream', 'microfono', 'casse_top', 'sub', 'monitor_dj', 'luci_stativo', 'nebbia', 'effetti', 'dance_floor', 'welcome_board', 'uplight', 'photo_booth', 'palco', 'tv_stativo'], { required: true }),
    w: t.int({ min: 1, max: 30 }), h: t.int({ min: 1, max: 30 }), n: t.int({ min: 1, max: 30 }),
    dj: t.bool(), // materiale portato dal DJ: solo nel disegno, senza prezzo Meekon né magazzino
  });
  return Object.fromEntries(Object.entries(c).filter(([k, x]) => x != null && !(k === 'dj' && x === false)));
};

export const rigaOffertaSchema = {
  articolo_id: t.uuid(),
  modello_id: t.uuid(),
  componenti: componentiSchema,
  configurazione: configurazioneSchema,
  titolo: t.string({ max: 120 }),
  descrizione: t.string({ max: 500, required: true, multiline: true }),
  quantita: t.decimal({ min: 0.01, max: 100000, decimals: 2, default: 1, empty: 1 }),
  giorni: t.decimal({ min: 0.01, max: 365, decimals: 2, default: 1, empty: 1 }),
  prezzo_unitario: t.money({ default: 0, empty: 0 }),
  sconto_percento: t.decimal({ min: 0, max: 100, decimals: 2, default: 0, empty: 0 }),
  opzionale: t.bool({ default: false, empty: false }), // mostrata nel PDF, non sommata
};

export const compensoSchema = {
  staff_id: t.uuid({ required: true }),
  ruolo: t.string({ max: 80, required: true }),
  quantita: t.decimal({ min: 0.01, max: 365, decimals: 2, default: 1, empty: 1 }),
  tariffa_chf: t.money({ max: 100000, required: true }),
};

export const TIPI_SPESA = ['cibo', 'diesel', 'materiale', 'altro'];
export const spesaSchema = {
  evento_id: t.uuid(),
  data: t.date(),
  tipo: t.enumOf(TIPI_SPESA, { required: true }),
  importo_chf: t.money({ max: 10000, required: true }),
  descrizione: t.string({ max: 300 }),
};

// ---------------------------------------------------------------------
// Area partner (DJ)
// ---------------------------------------------------------------------
export const partnerProfiloSchema = {
  ragione_sociale: t.string({ max: 160 }),
  persona: t.string({ max: 120 }),
  slogan: t.string({ max: 160 }),
  indirizzo: t.string({ max: 300, multiline: true }),
  telefono: t.phone(),
  email: t.email(),
  iban: t.string({ max: 34, pattern: /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/ }),
  twint: t.phone(),
  mwst_pflichtig: t.bool(),
  mwst_nr: t.string({ max: 40 }),
  logo: t.string({ max: 400000, pattern: /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/ }),
  usa_agb_meekon: t.bool({ default: true, empty: true }),
  agb: t.string({ max: 30000, multiline: true }),
};

// prese di corrente in location: { "230v": n, "cee16": n, ... } (n = quante, 0 o vuoto = nessuna)
export const PRESE = ['230v', 'cee16', 'cee32', 'cee63', 'cee125'];
const preseSchema = (v, f) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'invalid_input', { field: f });
  const c = validate(v, Object.fromEntries(PRESE.map((k) => [k, t.int({ min: 0, max: 50, empty: 0 })])));
  const out = Object.fromEntries(Object.entries(c).filter(([, n]) => n > 0));
  return Object.keys(out).length ? out : null;
};

export const partnerOffertaSchema = {
  stato: t.enumOf(['bozza', 'inviata', 'accettata', 'rifiutata', 'scaduta']),
  lingua: t.enumOf(LINGUE),
  cliente_nome: t.string({ max: 120 }),
  cliente_azienda: t.string({ max: 160 }),
  cliente_indirizzo: t.string({ max: 300, multiline: true }),
  cliente_email: t.email(),
  cliente_telefono: t.phone(),
  anrede: t.string({ max: 200 }),
  evento_titolo: t.string({ max: 200 }),
  data_inizio: t.datetime(),
  data_fine: t.datetime(),
  montaggio_da: t.datetime(),
  luogo: t.string({ max: 300 }),
  prese: preseSchema,
  valida_fino: t.date(),
  iva_percento: t.decimal({ min: 0, max: 30, decimals: 2, empty: 8.1 }),
  prezzi_iva_inclusa: t.bool({ empty: true }),
  sconto_percento: t.decimal({ min: 0, max: 100, decimals: 2, empty: 0 }),
  sconto_chf: t.money({ empty: 0 }),
  introduzione: t.string({ max: 4000, multiline: true }),
  condizioni: t.string({ max: 4000, multiline: true }),
};

export const partnerRigaSchema = {
  tipo: t.enumOf(['servizio', 'materiale', 'pacchetto'], { default: 'servizio', empty: 'servizio' }),
  articolo_id: t.uuid(),
  modello_id: t.uuid(),
  componenti: componentiSchema,
  configurazione: configurazioneSchema,
  titolo: t.string({ max: 120 }),
  descrizione: t.string({ max: 500, required: true, multiline: true }),
  quantita: t.decimal({ min: 0.01, max: 100000, decimals: 2, default: 1, empty: 1 }),
  giorni: t.decimal({ min: 0.01, max: 365, decimals: 2, default: 1, empty: 1 }),
  prezzo_unitario: t.money({ default: 0, empty: 0 }),
  sconto_percento: t.decimal({ min: 0, max: 100, decimals: 2, default: 0, empty: 0 }),
  opzionale: t.bool({ default: false, empty: false }),
};

export const assenzaSchema = {
  staff_id: t.uuid(),
  dal: t.date({ required: true }),
  al: t.date({ required: true }),
  motivo: t.string({ max: 200 }),
};
