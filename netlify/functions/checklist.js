// PATCH /api/checklist/:id — spunta "caricato"/"rientrato" e/o modifica le note.
// Gestione: qualsiasi voce. Tecnico: solo voci dei suoi eventi (RLS + trigger nel DB).
// DELETE /api/checklist/:id — toglie una voce (gestione).
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
        const rows = await sb.rest(`checklist?id=eq.${params.id}&select=id,evento_id,voce,quantita,articolo_id,caricato,rientrato,note,updated_at`, {
          method: 'PATCH',
          token,
          body: data,
          prefer: 'return=representation',
        });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { voce: rows[0] });
      },
    },
    DELETE: {
      auth: 'gestione',
      async fn({ params, sb, token }) {
        const rows = await sb.rest(`checklist?id=eq.${params.id}&select=id`, { method: 'DELETE', token, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/checklist\/([^/]+)\/?$/, paramNames: ['id'] },
);
