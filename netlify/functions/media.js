// Media del CMS (solo admin), bucket privato "media" di Supabase Storage.
//   POST /api/media/upload-url   {nome_file, tipo_mime, dimensione, cartella?}
//        → { path, upload_url, metodo: "PUT", headers, scadenza_secondi }
//        Il browser carica il file con PUT direttamente su upload_url (token monouso, nessuna chiave).
//   GET  /api/media/anteprima/<cartella>/<uuid>.<ext>
//        → { url, scadenza_secondi }  URL firmato di sola lettura, breve (5 minuti).
import { randomUUID } from 'node:crypto';
import { BUCKET, CARTELLE, MEDIA_PATH_RE, MIME } from './_lib/cms.js';
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { t, validate } from './_lib/validate.js';

export const config = { path: ['/api/media/upload-url', '/api/media/anteprima/*'] };

const ANTEPRIMA_SECONDI = 300;
// Gli URL di caricamento firmati di Supabase scadono dopo 2 ore (valore fisso lato Supabase).
const UPLOAD_SECONDI = 7200;

const uploadSchema = {
  nome_file: t.string({ max: 200, required: true }),
  tipo_mime: t.string({ max: 40, required: true }),
  dimensione: t.int({ min: 1, max: 1_000_000_000, required: true }),
  cartella: t.enumOf(CARTELLE, { default: 'galleria' }),
};

function invalid(field) {
  return new HttpError(400, 'invalid_input', { field });
}

/** Percorso firmato restituito da Supabase: deve riferirsi esattamente al file richiesto. */
function checkSigned(rel, prefix, path) {
  if (typeof rel !== 'string' || rel.length > 4096) throw new HttpError(502, 'upstream_error');
  const expected = `${prefix}${BUCKET}/${path}?`;
  const r = rel.startsWith('/') ? rel : `/${rel}`;
  if (!r.startsWith(expected) || !/[?&]token=[A-Za-z0-9._~-]+/.test(r) || /[\s"'<>\\]/.test(r)) {
    throw new HttpError(502, 'upstream_error');
  }
  return r;
}

const uploadUrl = createHandler(
  {
    POST: {
      auth: 'admin',
      async fn({ req, env, sb, token }) {
        const data = validate(await readJson(req), uploadSchema);
        const tipo = data.tipo_mime.toLowerCase();
        const info = Object.prototype.hasOwnProperty.call(MIME, tipo) ? MIME[tipo] : null;
        if (!info) throw invalid('tipo_mime');
        const m = /\.([A-Za-z0-9]{1,5})$/.exec(data.nome_file);
        if (!m || !info.estensioni.includes(m[1].toLowerCase())) throw invalid('nome_file');
        if (data.dimensione > info.max) throw invalid('dimensione');

        // Nome casuale: il nome originale del file non viene mai usato nel percorso.
        const path = `${data.cartella}/${randomUUID()}.${info.ext}`;
        const res = await sb.storage(`object/upload/sign/${BUCKET}/${path}`, { method: 'POST', token });
        const rel = checkSigned(res && res.url, '/object/upload/sign/', path);
        return json(200, {
          path,
          upload_url: `${env.supabaseUrl}/storage/v1${rel}`,
          metodo: 'PUT',
          headers: { 'Content-Type': tipo, 'x-upsert': 'false' },
          scadenza_secondi: UPLOAD_SECONDI,
        });
      },
    },
  },
  { pattern: /^\/api\/media\/upload-url\/?$/ },
);

const anteprima = createHandler(
  {
    GET: {
      auth: 'admin',
      async fn({ params, env, sb, token }) {
        const path = params.path;
        if (typeof path !== 'string' || !MEDIA_PATH_RE.test(path)) throw new HttpError(404, 'not_found');
        const res = await sb.storage(`object/sign/${BUCKET}/${path}`, {
          method: 'POST',
          token,
          body: { expiresIn: ANTEPRIMA_SECONDI },
        });
        const rel = checkSigned(res && (res.signedURL || res.signedUrl), '/object/sign/', path);
        return json(200, { url: `${env.supabaseUrl}/storage/v1${rel}`, scadenza_secondi: ANTEPRIMA_SECONDI });
      },
    },
  },
  { pattern: /^\/api\/media\/anteprima\/([a-z]{1,10}\/[0-9a-f-]{36}\.[a-z0-9]{3,4})$/, paramNames: ['path'] },
);

export default function handler(req) {
  let pathname = '';
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    /* il gestore risponde 404 */
  }
  return pathname.startsWith('/api/media/anteprima/') ? anteprima(req) : uploadUrl(req);
}
