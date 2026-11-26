// Costanti e schemi del CMS (contenuti pubblici modificabili dall'admin).
// Specifica: docs/architettura.md, "Contenuti pubblici modificabili".

import { HttpError } from './http.js';
import { PAESI, LINGUE } from './schemas.js';
import { t } from './validate.js';
// Testi italiani del sito: servono solo per sapere quali chiavi esistono
// (esbuild li include nel bundle della function; nessuna lettura di file a runtime).
import itTexts from '../../../src/i18n/it.json' with { type: 'json' };

export const BUCKET = 'media';
export const CARTELLE = ['galleria', 'dj', 'partner'];
export const CATEGORIE = ['matrimoni', 'aziende', 'feste', 'palco'];
export const FORMATI = ['wide', 'tall', 'reel'];
export const TIPI_MEDIA = ['foto', 'video'];

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Percorso di un file nel bucket (come generato da /api/media/upload-url). */
export const MEDIA_PATH_RE = new RegExp(`^(?:galleria|dj|partner)/${UUID}\\.(?:jpg|png|webp|mp4)$`);
/** Solo immagini (poster, foto DJ, loghi). */
export const IMAGE_PATH_RE = new RegExp(`^(?:galleria|dj|partner)/${UUID}\\.(?:jpg|png|webp)$`);

/** Tipi ammessi → estensione e dimensione massima dichiarabile (byte). */
export const MIME = Object.freeze({
  'image/jpeg': { ext: 'jpg', max: 10 * 1024 * 1024, estensioni: ['jpg', 'jpeg'] },
  'image/png': { ext: 'png', max: 10 * 1024 * 1024, estensioni: ['png'] },
  'image/webp': { ext: 'webp', max: 10 * 1024 * 1024, estensioni: ['webp'] },
  'video/mp4': { ext: 'mp4', max: 200 * 1024 * 1024, estensioni: ['mp4'] },
});

const LINK_RE = /^https:\/\/[^\s"'<>\\]+$/;
export const CHIAVE_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
export const TESTO_MAX = 2000;

/**
 * Chiavi NON modificabili dal CMS (contatti, privacy, consenso del modulo,
 * metadati della lingua): restano nel codice, revisionate dall'agente sicurezza.
 * Una chiave è esclusa se è uguale a una voce o inizia con "<voce>.".
 */
export const CHIAVI_ESCLUSE = ['locale', 'label', 'hint', 'hint_link', 'privacy', 'privacy_page', 'form.note', 'contact.phone', 'whatsapp'];

function fail(field) {
  return new HttpError(400, 'invalid_input', field ? { field } : undefined);
}

/** Validatore per link facoltativi: solo https://, niente credenziali, max 500 caratteri. */
export function httpsLink() {
  const base = t.string({ max: 500, pattern: LINK_RE });
  const fn = (v, f) => {
    const s = base(v, f);
    if (s === null) return null;
    let u;
    try {
      u = new URL(s);
    } catch {
      throw fail(f);
    }
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) throw fail(f);
    return s;
  };
  fn.required = false;
  fn.default = undefined;
  return fn;
}

const ordine = () => t.int({ min: 0, max: 100000, default: 0 });
const pubblicato = () => t.bool({ default: false });

/** Sezioni del CMS: tabella, colonne restituite, schema di validazione. */
export const SEZIONI = Object.freeze({
  galleria: {
    tabella: 'media_galleria',
    select: 'id,file_path,poster_path,tipo,categoria,formato,alt_it,alt_de,alt_fr,alt_en,ordine,pubblicato,created_at,updated_at,updated_by',
    schema: {
      file_path: t.string({ max: 80, pattern: MEDIA_PATH_RE, required: true }),
      poster_path: t.string({ max: 80, pattern: IMAGE_PATH_RE }),
      tipo: t.enumOf(TIPI_MEDIA, { required: true }),
      categoria: t.enumOf(CATEGORIE, { required: true }),
      formato: t.enumOf(FORMATI, { default: 'wide' }),
      alt_it: t.string({ max: 300, required: true }),
      alt_de: t.string({ max: 300 }),
      alt_fr: t.string({ max: 300 }),
      alt_en: t.string({ max: 300 }),
      ordine: ordine(),
      pubblicato: pubblicato(),
    },
    /** Coerenza tipo/file (ricontrollata dal vincolo del DB anche nelle modifiche parziali). */
    check(data) {
      const isVideoFile = typeof data.file_path === 'string' ? data.file_path.endsWith('.mp4') : null;
      if (data.tipo === 'foto') {
        if (isVideoFile === true) throw fail('file_path');
        if (data.poster_path) throw fail('poster_path');
      }
      if (data.tipo === 'video' && isVideoFile === false) throw fail('file_path');
      if (data.tipo === undefined && isVideoFile !== null) throw fail('tipo'); // file cambiato senza tipo
    },
  },
  sale: {
    tabella: 'sale',
    select: 'id,nome,luogo,paese,tipo_it,tipo_de,tipo_fr,tipo_en,ordine,pubblicato,created_at,updated_at,updated_by',
    schema: {
      nome: t.string({ max: 160, required: true }),
      luogo: t.string({ max: 160 }),
      paese: t.enumOf(PAESI, { default: 'CH' }),
      tipo_it: t.string({ max: 120 }),
      tipo_de: t.string({ max: 120 }),
      tipo_fr: t.string({ max: 120 }),
      tipo_en: t.string({ max: 120 }),
      ordine: ordine(),
      pubblicato: pubblicato(),
    },
  },
  dj: {
    tabella: 'dj',
    select: 'id,nome,genere_it,genere_de,genere_fr,genere_en,foto_path,foto_e_logo,link,ordine,pubblicato,created_at,updated_at,updated_by',
    schema: {
      nome: t.string({ max: 120, required: true }),
      genere_it: t.string({ max: 120 }),
      genere_de: t.string({ max: 120 }),
      genere_fr: t.string({ max: 120 }),
      genere_en: t.string({ max: 120 }),
      foto_path: t.string({ max: 80, pattern: IMAGE_PATH_RE }),
      foto_e_logo: t.bool(), // l'immagine è un logo (centrato), non una foto
      link: httpsLink(),
      ordine: ordine(),
      pubblicato: pubblicato(),
    },
  },
  partner: {
    tabella: 'partner',
    select: 'id,nome,logo_path,ruolo_it,ruolo_de,ruolo_fr,ruolo_en,link,ordine,pubblicato,created_at,updated_at,updated_by',
    schema: {
      nome: t.string({ max: 120, required: true }),
      logo_path: t.string({ max: 80, pattern: IMAGE_PATH_RE }),
      ruolo_it: t.string({ max: 60 }),
      ruolo_de: t.string({ max: 60 }),
      ruolo_fr: t.string({ max: 60 }),
      ruolo_en: t.string({ max: 60 }),
      link: httpsLink(),
      ordine: ordine(),
      pubblicato: pubblicato(),
    },
  },
});

/** Sezione dal percorso, altrimenti 404. */
export function sezione(name) {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(SEZIONI, name)) {
    throw new HttpError(404, 'not_found');
  }
  return SEZIONI[name];
}

// ---------------------------------------------------------------- testi

function chiaviStringa(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.add(key);
    else if (v && typeof v === 'object' && !Array.isArray(v)) chiaviStringa(v, key, out);
  }
  return out;
}

/** Chiavi di testo (stringhe) presenti in src/i18n/it.json. */
export const CHIAVI_TESTO = chiaviStringa(itTexts);

export function chiaveEsclusa(chiave) {
  return CHIAVI_ESCLUSE.some((x) => chiave === x || chiave.startsWith(`${x}.`));
}

/** La chiave deve avere il formato giusto, esistere in it.json (come testo) e non essere esclusa. */
export function chiaveValida(chiave) {
  return (
    typeof chiave === 'string' &&
    chiave.length <= 120 &&
    CHIAVE_RE.test(chiave) &&
    CHIAVI_TESTO.has(chiave) &&
    !chiaveEsclusa(chiave)
  );
}

export const testoSchema = Object.fromEntries(LINGUE.map((l) => [l, t.string({ max: TESTO_MAX, multiline: true })]));
