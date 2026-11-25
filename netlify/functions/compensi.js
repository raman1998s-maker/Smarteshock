// GET /api/compensi?da=&a= — i miei compensi (paga per evento) nel periodo. Tutti i ruoli.
import { createHandler } from './_lib/handler.js';
import { HttpError, json } from './_lib/http.js';
import { isValidDate } from './_lib/validate.js';

export const config = { path: '/api/compensi' };

export default createHandler(
  {
    GET: {
      auth: 'user',
      async fn({ url, sb, token }) {
        const da = url.searchParams.get('da');
        const a = url.searchParams.get('a');
        if (da && !isValidDate(da)) throw new HttpError(400, 'invalid_input', { field: 'da' });
        if (a && !isValidDate(a)) throw new HttpError(400, 'invalid_input', { field: 'a' });
        const rows = await sb.rest('rpc/miei_compensi', { method: 'POST', token, body: { p_da: da || null, p_a: a || null } });
        return json(200, { compensi: rows || [] });
      },
    },
  },
  { pattern: /^\/api\/compensi\/?$/ },
);
