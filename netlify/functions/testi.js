// Testi del sito modificabili dall'admin (sovrascrivono src/i18n/*.json).
//   GET /api/testi                     → { testi: [{chiave, it, de, fr, en, updated_at}], chiavi: [...] }
//   PUT /api/testi/:chiave  {it, de, fr, en}  (max 2000 caratteri ciascuno; vuoto = testo del file)
// Se tutte e quattro le lingue sono vuote la riga viene eliminata (si torna ai testi dei file).
import { CHIAVI_TESTO, chiaveEsclusa, chiaveValida, testoSchema } from './_lib/cms.js';
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { validate } from './_lib/validate.js';

export const config = { path: ['/api/testi', '/api/testi/:chiave'] };

const SELECT = 'chiave,it,de,fr,en,updated_at';
// Chiavi modificabili (per l'interfaccia dell'area riservata).
const CHIAVI = [...CHIAVI_TESTO].filter((k) => !chiaveEsclusa(k)).sort();

export default createHandler(
  {
    GET: {
      auth: 'admin',
      async fn({ params, sb, token }) {
        if (params.chiave !== undefined) throw new HttpError(405, 'method_not_allowed');
        const rows = await sb.rest(`testi?select=${SELECT}&order=chiave.asc&limit=1000`, { token });
        return json(200, { testi: rows || [], chiavi: CHIAVI });
      },
    },
    PUT: {
      auth: 'admin',
      async fn({ req, params, sb, token }) {
        if (params.chiave === undefined) throw new HttpError(405, 'method_not_allowed');
        let chiave;
        try {
          chiave = decodeURIComponent(params.chiave);
        } catch {
          throw new HttpError(400, 'invalid_input', { field: 'chiave' });
        }
        if (!chiaveValida(chiave)) throw new HttpError(400, 'invalid_input', { field: 'chiave' });
        const data = validate(await readJson(req), testoSchema, { partial: true });
        const valori = { it: null, de: null, fr: null, en: null, ...data };

        if (Object.values(valori).every((v) => v === null)) {
          await sb.rest(`testi?chiave=eq.${encodeURIComponent(chiave)}`, { method: 'DELETE', token });
          return json(200, { testo: null });
        }
        const rows = await sb.rest(`testi?on_conflict=chiave&select=${SELECT}`, {
          method: 'POST',
          token,
          body: { chiave, ...valori },
          prefer: 'resolution=merge-duplicates,return=representation',
        });
        return json(200, { testo: rows?.[0] ?? null });
      },
    },
  },
  { pattern: /^\/api\/testi(?:\/([^/]{1,200}))?\/?$/, paramNames: ['chiave'] },
);
