// GET /api/richieste?stato= · PATCH /api/richieste/:id (admin)
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { STATI_RICHIESTA } from './_lib/schemas.js';
import { t, validate } from './_lib/validate.js';

export const config = { path: ['/api/richieste', '/api/richieste/:id'] };

const SELECT = 'id,nome,email,telefono,tipo,data,localita,ospiti,servizi,messaggio,lingua,stato,evento_id,created_at,updated_at';

export default createHandler(
  {
    GET: {
      auth: 'admin',
      withId: false,
      async fn({ url, sb, token }) {
        const q = new URLSearchParams({ select: SELECT, order: 'created_at.desc', limit: '300' });
        const stato = url.searchParams.get('stato');
        if (stato) {
          if (!STATI_RICHIESTA.includes(stato)) throw new HttpError(400, 'invalid_input', { field: 'stato' });
          q.set('stato', `eq.${stato}`);
        }
        const rows = await sb.rest(`richieste_web?${q}`, { token });
        return json(200, { richieste: rows || [] });
      },
    },
    PATCH: {
      auth: 'admin',
      withId: true,
      async fn({ req, params, sb, token }) {
        const data = validate(await readJson(req), { stato: t.enumOf(STATI_RICHIESTA, { required: true }) });
        const rows = await sb.rest(`richieste_web?id=eq.${params.id}&select=${SELECT}`, {
          method: 'PATCH',
          token,
          body: data,
          prefer: 'return=representation',
        });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { richiesta: rows[0] });
      },
    },
  },
  { pattern: /^\/api\/richieste(?:\/([^/]+))?\/?$/, paramNames: ['id'] },
);
