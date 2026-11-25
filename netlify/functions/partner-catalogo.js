// GET /api/partner/catalogo?da=&a= — catalogo Meekon visto dal partner: prezzo partner
// (noleggio meno il suo sconto) e pezzi liberi nelle date, nient'altro. Partner e gestione.
import { isGestione } from './_lib/auth.js';
import { createHandler } from './_lib/handler.js';
import { HttpError, json } from './_lib/http.js';
import { isValidDate } from './_lib/validate.js';

export const config = { path: '/api/partner/catalogo' };

export default createHandler(
  {
    GET: {
      auth: 'user',
      async fn({ url, sb, token, user }) {
        if (user.ruolo !== 'partner' && !isGestione(user)) throw new HttpError(403, 'forbidden');
        const da = url.searchParams.get('da');
        const a = url.searchParams.get('a') || da;
        if (da && !isValidDate(da)) throw new HttpError(400, 'invalid_input', { field: 'da' });
        if (a && !isValidDate(a)) throw new HttpError(400, 'invalid_input', { field: 'a' });
        const rows = await sb.rest('rpc/catalogo_partner', { method: 'POST', token, body: { p_da: da || null, p_a: a || null } });
        return json(200, { catalogo: rows || [] });
      },
    },
  },
  { pattern: /^\/api\/partner\/catalogo\/?$/ },
);
