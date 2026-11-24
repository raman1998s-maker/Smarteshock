// POST /api/richiesta — modulo "preventivo" del sito pubblico.
// - Accetta JSON (fetch) oppure un normale invio di form (urlencoded / multipart):
//   in questo caso risponde 303 verso la pagina di ringraziamento della lingua,
//   così il modulo funziona anche senza JavaScript.
// - Honeypot "bot-field": se compilato si risponde "ok" senza salvare nulla.
// - Inserimento con la sola chiave anon (nessun JWT utente): la policy RLS
//   permette ad anon solo INSERT su richieste_web, nessuna lettura.
import { createHandler } from './_lib/handler.js';
import { API_HEADERS, HttpError, json, mediaType, readText } from './_lib/http.js';
import { DT_ARRAY, DT_PREFIX, LINGUE, dettagliTecnici, richiestaSchema } from './_lib/schemas.js';
import { validate } from './_lib/validate.js';

export const config = { path: '/api/richiesta' };

const MAX_BYTES = 24 * 1024;
const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data'];

const ERRORE = {
  it: ['Richiesta non inviata', 'Controlla i dati inseriti e riprova.', 'Torna al modulo'],
  de: ['Anfrage nicht gesendet', 'Bitte prüfe deine Angaben und versuche es erneut.', 'Zurück zum Formular'],
  fr: ['Demande non envoyée', 'Vérifie les données saisies et réessaie.', 'Retour au formulaire'],
  en: ['Request not sent', 'Please check your details and try again.', 'Back to the form'],
};

function lingua(v) {
  return typeof v === 'string' && LINGUE.includes(v) ? v : 'it';
}

function paginaGrazie(lang) {
  return lang === 'it' ? '/grazie.html' : `/${lang}/grazie.html`;
}

function paginaModulo(lang) {
  return lang === 'it' ? '/#contatti' : `/${lang}/#contatti`;
}

function redirect(location) {
  const h = new Headers(API_HEADERS);
  h.delete('Content-Type');
  h.set('Location', location);
  return new Response(null, { status: 303, headers: h });
}

function erroreHtml(status, lang) {
  const [titolo, testo, link] = ERRORE[lang];
  const html =
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">` +
    `<title>${titolo}</title><link rel="stylesheet" href="/assets/css/style.css"></head>` +
    `<body><main class="thanks"><div><h1>${titolo}</h1><p>${testo}</p>` +
    `<p><a href="${paginaModulo(lang)}">${link}</a></p></div></main></body></html>`;
  const h = new Headers(API_HEADERS);
  h.set('Content-Type', 'text/html; charset=utf-8');
  h.set('Content-Security-Policy', "default-src 'none'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(html, { status, headers: h });
}

async function leggiCorpo(req, type) {
  const text = await readText(req, MAX_BYTES);
  if (type === 'application/json') {
    try {
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      return data;
    } catch {
      throw new HttpError(400, 'invalid_json');
    }
  }
  let form;
  if (type === 'application/x-www-form-urlencoded') {
    form = new URLSearchParams(text);
  } else {
    try {
      form = await new Response(text, { headers: { 'Content-Type': req.headers.get('content-type') } }).formData();
    } catch {
      throw new HttpError(400, 'invalid_input');
    }
  }
  const out = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') throw new HttpError(400, 'invalid_input'); // niente file
    if (key === 'servizi' || (key.startsWith(DT_PREFIX) && DT_ARRAY.includes(key.slice(DT_PREFIX.length)))) (out[key] ||= []).push(value);
    else if (!(key in out)) out[key] = value;
  }
  return out;
}

export default createHandler(
  {
    POST: {
      auth: 'public',
      xrw: false, // un form HTML classico non può inviare header; Origin resta obbligatorio
      async fn({ req, sb }) {
        const type = mediaType(req);
        const isForm = FORM_TYPES.includes(type);
        if (!isForm && type !== 'application/json') throw new HttpError(415, 'unsupported_media_type');
        const htmlMode = isForm && (req.headers.get('x-requested-with') || '').toLowerCase() !== 'meekon';

        let lang = 'it';
        try {
          const body = await leggiCorpo(req, type);
          lang = lingua(body.lingua);

          const honeypot = body['bot-field'];
          if (typeof honeypot === 'string' ? honeypot.trim() !== '' : honeypot != null) {
            return htmlMode ? redirect(paginaGrazie(lang)) : json(200, { ok: true });
          }

          // Si considerano solo i campi del modulo; il resto viene ignorato.
          const input = {};
          for (const key of Object.keys(richiestaSchema)) if (key in body) input[key] = body[key];
          const data = validate(input, richiestaSchema);
          const dettagli = dettagliTecnici(body);
          if (dettagli) data.dettagli_tecnici = dettagli;

          await sb.rest('richieste_web', { method: 'POST', token: null, body: data, prefer: 'return=minimal' });
          return htmlMode ? redirect(paginaGrazie(data.lingua)) : json(200, { ok: true });
        } catch (err) {
          if (!htmlMode) throw err;
          if (!(err instanceof HttpError)) console.error(`[api] richiesta: ${err && err.name}`);
          return erroreHtml(err instanceof HttpError && err.status < 500 ? 400 : 502, lang);
        }
      },
    },
  },
  { pattern: /^\/api\/richiesta\/?$/ },
);
