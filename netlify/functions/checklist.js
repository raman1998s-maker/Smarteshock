// PATCH /api/checklist/:id — spunta "caricato" e/o modifica le note.
// Admin: qualsiasi voce. Tecnico: solo voci dei suoi eventi (RLS + trigger nel DB).
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { checklistUpdateSchema } from './_lib/schemas.js';
import { validate } from './_lib/validate.js';

export const config = { path: '/api/checklist/:id' };

export default createHandler(
  {
    PATCH: {
      auth: 'user',
      async fn({ req, params, sb, token }) {
        const data = validate(await readJson(req), checklistUpdateSchema, { partial: true });
        const rows = await sb.rest(`checklist?id=eq.${params.id}&select=id,evento_id,voce,quantita,caricato,note,updated_at`, {
          method: 'PATCH',
          token,
          body: data,
          prefer: 'return=representation',
        });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { voce: rows[0] });
      },
    },
  },
  { pattern: /^\/api\/checklist\/([^/]+)\/?$/, paramNames: ['id'] },
);
