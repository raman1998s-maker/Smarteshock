// POST /api/richieste/pulizia (admin) — cancella subito le richieste del sito
// senza seguito (evento_id nullo) più vecchie di 24 mesi.
// Di norma lo fa ogni giorno il job pg_cron (migrazione 0004); questo endpoint
// è la seconda via (pg_cron non disponibile o pulizia immediata).
// Nessun corpo. Risposta: { ok: true, cancellate: <numero> }
import { createHandler } from './_lib/handler.js';
import { json } from './_lib/http.js';

// excludedPath in richieste.js evita che '/api/richieste/:id' catturi questo percorso.
export const config = { path: '/api/richieste/pulizia' };

export default createHandler(
  {
    POST: {
      auth: 'admin',
      async fn({ sb, token }) {
        const result = await sb.rest('rpc/pulisci_richieste_vecchie_admin', { method: 'POST', token, body: {} });
        const n = Number(result);
        return json(200, { ok: true, cancellate: Number.isSafeInteger(n) && n >= 0 ? n : 0 });
      },
    },
  },
  { pattern: /^\/api\/richieste\/pulizia\/?$/ },
);
