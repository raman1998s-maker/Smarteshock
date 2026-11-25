// Schemi di validazione condivisi e costanti del modello dati.

import { HttpError } from './http.js';
import { t, validate } from './validate.js';

export const STATI_EVENTO = ['richiesta', 'offerta', 'confermato', 'completato', 'annullato'];
export const PAESI = ['CH', 'IT', 'DE', 'FR'];
export const LINGUE = ['it', 'de', 'fr', 'en'];
export const STATI_RICHIESTA = ['nuova', 'gestita', 'scartata'];
export const CAMPI_ECONOMICI = ['importo_chf', 'acconto_pagato', 'saldo_pagato'];
/** Campi che il tecnico non riceve mai: importi + note solo per l'admin. */
export const CAMPI_SOLO_ADMIN = [...CAMPI_ECONOMICI, 'note_interne'];

export const eventoSchema = {
  cliente_id: t.uuid(),
  titolo: t.string({ max: 200, required: true }),
  tipo: t.string({ max: 80 }),
  stato: t.enumOf(STATI_EVENTO, { default: 'richiesta', required: false }),
  data_inizio: t.datetime(),
  data_fine: t.datetime(),
  localita: t.string({ max: 200 }),
  sala: t.string({ max: 200 }),
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
  note: t.string({ max: 4000, multiline: true }),
};

export const checklistCreateSchema = {
  voce: t.string({ max: 200, required: true }),
  quantita: t.int({ min: 1, max: 100000, default: 1 }),
  note: t.string({ max: 1000, multiline: true }),
};

export const checklistUpdateSchema = {
  caricato: t.bool(),
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
  prese: t.array(t.enumOf(['230v', 'cee400', 'non_so']), { max: 3 }),
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
