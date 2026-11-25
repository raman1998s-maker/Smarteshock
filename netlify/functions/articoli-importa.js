// POST /api/articoli/importa — aggiunge al catalogo molte righe in una volta
// (lista incollata da Excel, già divisa in colonne dal browser). Gestione.
// Corpo: { "articoli": [ {categoria, marca, descrizione, quantita, prezzo_vendita, …} ] }
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { articoloSchema } from './_lib/schemas.js';
import { validate } from './_lib/validate.js';

export const config = { path: '/api/articoli/importa' };

const MAX_RIGHE = 500;

export default createHandler(
  {
    POST: {
      auth: 'gestione',
      async fn({ req, sb, token }) {
        const body = await readJson(req, { maxBytes: 512 * 1024 });
        if (Object.keys(body).some((k) => k !== 'articoli')) throw new HttpError(400, 'invalid_input');
        const list = body.articoli;
        if (!Array.isArray(list) || list.length === 0 || list.length > MAX_RIGHE) {
          throw new HttpError(400, 'invalid_input', { field: 'articoli' });
        }
        const righe = list.map((item, i) => {
          try {
            return validate(item, articoloSchema);
          } catch (err) {
            // indica la riga (1 = prima) e il campo sbagliato
            if (err instanceof HttpError) throw new HttpError(400, 'invalid_input', { ...err.extra, riga: i + 1 });
            throw err;
          }
        });
        await sb.rest('articoli', { method: 'POST', token, body: righe, prefer: 'return=minimal' });
        return json(201, { ok: true, importati: righe.length });
      },
    },
  },
  { pattern: /^\/api\/articoli\/importa\/?$/ },
);
