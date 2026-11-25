// Flotta veicoli.
// GET    /api/veicoli          tutti i dipendenti tranne i partner (nome e targa servono alla squadra)
// POST   /api/veicoli          { nome, targa?, portata_kg, volume_m3?, scadenza_collaudo?, scadenza_assicurazione?, note?, attivo? } (gestione)
// PATCH  /api/veicoli/:id      (gestione)
// DELETE /api/veicoli/:id      (gestione)
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { t, validate } from './_lib/validate.js';

export const config = { path: ['/api/veicoli', '/api/veicoli/:id'] };

const SELECT = 'id,nome,targa,portata_kg,volume_m3,scadenza_collaudo,scadenza_assicurazione,note,attivo';
const schema = {
  nome: t.string({ max: 80, required: true }),
  targa: t.string({ max: 20 }),
  portata_kg: t.int({ min: 1, max: 100000, required: true }),
  volume_m3: t.decimal({ min: 0, max: 1000, decimals: 2 }),
  scadenza_collaudo: t.date(),
  scadenza_assicurazione: t.date(),
  note: t.string({ max: 1000, multiline: true }),
  attivo: t.bool({ default: true, empty: true }),
};

export default createHandler(
  {
    GET: {
      auth: 'user',
      withId: false,
      async fn({ sb, token, user }) {
        if (user.ruolo === 'partner') throw new HttpError(403, 'forbidden');
        const rows = await sb.rest(`veicoli?select=${SELECT}&order=nome.asc`, { token });
        return json(200, { veicoli: rows || [] });
      },
    },
    POST: {
      auth: 'gestione',
      withId: false,
      async fn({ req, sb, token }) {
        const d = validate(await readJson(req), schema);
        const rows = await sb.rest(`veicoli?select=${SELECT}`, { method: 'POST', token, body: d, prefer: 'return=representation' });
        return json(201, { veicolo: rows?.[0] ?? null });
      },
    },
    PATCH: {
      auth: 'gestione',
      withId: true,
      async fn({ req, params, sb, token }) {
        const d = validate(await readJson(req), schema, { partial: true });
        const rows = await sb.rest(`veicoli?id=eq.${params.id}&select=${SELECT}`, { method: 'PATCH', token, body: d, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { veicolo: rows[0] });
      },
    },
    DELETE: {
      auth: 'gestione',
      withId: true,
      async fn({ params, sb, token }) {
        const rows = await sb.rest(`veicoli?id=eq.${params.id}&select=id`, { method: 'DELETE', token, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/veicoli(?:\/([^/]+))?\/?$/, paramNames: ['id'] },
);
