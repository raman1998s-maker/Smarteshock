// POST /api/eventi/:id/checklist — aggiunge una voce alla checklist (admin).
import { createHandler } from './_lib/handler.js';
import { json, readJson } from './_lib/http.js';
import { checklistCreateSchema } from './_lib/schemas.js';
import { validate } from './_lib/validate.js';

export const config = { path: '/api/eventi/:id/checklist' };

export default createHandler(
  {
    POST: {
      auth: 'admin',
      async fn({ req, params, sb, token }) {
        const data = validate(await readJson(req), checklistCreateSchema);
        const rows = await sb.rest('checklist?select=id,evento_id,voce,quantita,caricato,note,updated_at', {
          method: 'POST',
          token,
          body: { ...data, evento_id: params.id },
          prefer: 'return=representation',
        });
        return json(201, { voce: rows?.[0] ?? null });
      },
    },
  },
  { pattern: /^\/api\/eventi\/([^/]+)\/checklist\/?$/, paramNames: ['id'] },
);
