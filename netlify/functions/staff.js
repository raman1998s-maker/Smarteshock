// GET /api/staff — elenco dipendenti (admin).
import { createHandler } from './_lib/handler.js';
import { json } from './_lib/http.js';

export const config = { path: '/api/staff' };

export default createHandler(
  {
    GET: {
      auth: 'admin',
      async fn({ sb, token }) {
        const rows = await sb.rest('staff?select=id,nome,ruolo,telefono,attivo&order=nome.asc', { token });
        return json(200, { staff: rows || [] });
      },
    },
  },
  { pattern: /^\/api\/staff\/?$/ },
);
