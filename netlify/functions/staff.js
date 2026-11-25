// GET /api/staff — elenco dipendenti (admin e ufficio: serve per assegnare la squadra).
// PATCH /api/staff/:id — nome, telefono, ruolo, attivo (solo admin).
// Gli account si creano dalla dashboard Supabase (nessuna service_role qui);
// il DB impedisce di restare senza un admin attivo (trigger staff_protegge_admin).
import { RUOLI } from './_lib/auth.js';
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { t, validate } from './_lib/validate.js';

export const config = { path: ['/api/staff', '/api/staff/:id'] };

const SELECT = 'id,nome,ruolo,telefono,attivo';
const staffSchema = {
  nome: t.string({ max: 120, required: true }),
  telefono: t.phone(),
  ruolo: t.enumOf(RUOLI, { required: true }),
  attivo: t.bool({ required: true }),
};

export default createHandler(
  {
    GET: {
      auth: 'gestione',
      withId: false,
      async fn({ sb, token }) {
        const rows = await sb.rest(`staff?select=${SELECT}&order=nome.asc`, { token });
        return json(200, { staff: rows || [] });
      },
    },
    PATCH: {
      auth: 'admin',
      withId: true,
      async fn({ req, params, sb, token, user }) {
        const data = validate(await readJson(req), staffSchema, { partial: true });
        if (params.id === user.id && (data.attivo === false || (data.ruolo && data.ruolo !== 'admin'))) {
          throw new HttpError(409, 'conflict', { field: data.attivo === false ? 'attivo' : 'ruolo' });
        }
        const rows = await sb.rest(`staff?id=eq.${params.id}&select=${SELECT}`, {
          method: 'PATCH',
          token,
          body: data,
          prefer: 'return=representation',
        });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { dipendente: rows[0] });
      },
    },
  },
  { pattern: /^\/api\/staff(?:\/([^/]+))?\/?$/, paramNames: ['id'] },
);
