// POST /api/richieste/:id/converti — crea (o riusa) il cliente e crea l'evento
// da una richiesta del sito, in un'unica transazione (funzione SQL converti_richiesta).
// La funzione SQL passa all'evento anche tipo, data, località, paese (se assente
// 'CH'), ospiti, servizi e messaggio della richiesta (migrazione 0002).
// Corpo facoltativo: { "titolo": "..." }
import { createHandler } from './_lib/handler.js';
import { json, readJson } from './_lib/http.js';
import { t, validate } from './_lib/validate.js';

export const config = { path: '/api/richieste/:id/converti' };

export default createHandler(
  {
    POST: {
      auth: 'admin',
      async fn({ req, params, sb, token }) {
        const { titolo } = validate(await readJson(req, { optional: true }), { titolo: t.string({ max: 200 }) });
        const result = await sb.rest('rpc/converti_richiesta', {
          method: 'POST',
          token,
          body: { p_richiesta: params.id, p_titolo: titolo ?? null },
        });
        return json(201, {
          cliente_id: result?.cliente_id ?? null,
          evento_id: result?.evento_id ?? null,
          numero_ordine: result?.numero_ordine ?? null,
        });
      },
    },
  },
  { pattern: /^\/api\/richieste\/([^/]+)\/converti\/?$/, paramNames: ['id'] },
);
