// GET /api/articoli/disponibilita?da=AAAA-MM-GG&a=AAAA-MM-GG[&escludi=<evento>]
// Per ogni articolo: quantità, impegnati (eventi confermati nel periodo), in offerta,
// fuori adesso (caricati e non rientrati), disponibili. Gestione.
import { createHandler } from './_lib/handler.js';
import { HttpError, json } from './_lib/http.js';
import { isValidDate } from './_lib/validate.js';

export const config = { path: '/api/articoli/disponibilita' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default createHandler(
  {
    GET: {
      auth: 'gestione',
      async fn({ url, sb, token }) {
        const da = url.searchParams.get('da');
        const a = url.searchParams.get('a') || da;
        const escludi = url.searchParams.get('escludi');
        if (!da || !isValidDate(da)) throw new HttpError(400, 'invalid_input', { field: 'da' });
        if (!isValidDate(a) || a < da) throw new HttpError(400, 'invalid_input', { field: 'a' });
        if (escludi && !UUID_RE.test(escludi)) throw new HttpError(400, 'invalid_input', { field: 'escludi' });
        const rows = await sb.rest('rpc/disponibilita_articoli', {
          method: 'POST',
          token,
          body: { p_da: da, p_a: a, p_escludi: escludi || null },
        });
        return json(200, { disponibilita: rows || [] });
      },
    },
  },
  { pattern: /^\/api\/articoli\/disponibilita\/?$/ },
);
