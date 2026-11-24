// Schemi di validazione condivisi e costanti del modello dati.

import { t } from './validate.js';

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
