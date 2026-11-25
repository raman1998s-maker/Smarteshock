// GET/POST /api/eventi · GET/PATCH/DELETE /api/eventi/:id
import { isGestione } from './_lib/auth.js';
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { STATI_EVENTO, eventoSchema, perTecnico } from './_lib/schemas.js';
import { isValidDate, validate } from './_lib/validate.js';

export const config = { path: ['/api/eventi', '/api/eventi/:id'] };

const LIST_ADMIN =
  'id,numero_ordine,titolo,tipo,stato,data_inizio,data_fine,localita,sala,indirizzo,paese,ospiti,servizi,' +
  'importo_chf,acconto_pagato,saldo_pagato,cliente_id,cliente:clienti(nome,azienda)';
const LIST_TECNICO =
  'id,numero_ordine,titolo,tipo,stato,data_inizio,data_fine,localita,sala,indirizzo,paese,ospiti,servizi,' +
  'cliente_id,cliente_nome,cliente_telefono';
// Colonne esplicite (non *): il tecnico chiede solo ciò che può vedere.
const DETAIL_TECNICO = `${LIST_TECNICO},montaggio_da,smontaggio_da,contatto_luogo_nome,contatto_luogo_telefono,programma,note_squadra,created_at,updated_at`;
const DETAIL_ADMIN = '*,cliente:clienti(id,nome,azienda,email,telefono,lingua)';

function filtri(url) {
  const q = new URLSearchParams();
  const da = url.searchParams.get('da');
  const a = url.searchParams.get('a');
  const stato = url.searchParams.get('stato');
  if (da) {
    if (!isValidDate(da)) throw new HttpError(400, 'invalid_input', { field: 'da' });
    // eventi che finiscono (o iniziano, se senza fine) dopo "da"
    q.set('or', `(data_fine.gte.${da},and(data_fine.is.null,data_inizio.gte.${da}))`);
  }
  if (a) {
    if (!isValidDate(a)) throw new HttpError(400, 'invalid_input', { field: 'a' });
    q.set('data_inizio', `lte.${a}T23:59:59`);
  }
  if (stato) {
    if (!STATI_EVENTO.includes(stato)) throw new HttpError(400, 'invalid_input', { field: 'stato' });
    q.set('stato', `eq.${stato}`);
  }
  return q;
}

function controllaDate(ev) {
  if (ev.data_inizio && ev.data_fine && ev.data_fine < ev.data_inizio) {
    throw new HttpError(400, 'invalid_input', { field: 'data_fine' });
  }
}

async function elenco({ url, sb, token, user }) {
  const q = filtri(url);
  q.set('order', 'data_inizio.asc.nullslast,numero_ordine.asc');
  q.set('limit', '500');
  if (isGestione(user)) {
    q.set('select', LIST_ADMIN);
    const rows = await sb.rest(`eventi?${q}`, { token });
    return json(200, { eventi: rows || [] });
  }
  q.set('select', LIST_TECNICO);
  const rows = await sb.rest(`eventi_tecnico?${q}`, { token });
  return json(200, { eventi: (rows || []).map(perTecnico) });
}

async function dettaglio({ params, sb, token, user }) {
  const id = params.id;
  const isAdmin = isGestione(user);
  const [eventi, staff, checklist] = await Promise.all([
    isAdmin
      ? sb.rest(`eventi?id=eq.${id}&select=${encodeURIComponent(DETAIL_ADMIN)}`, { token })
      : sb.rest(`eventi_tecnico?id=eq.${id}&select=${encodeURIComponent(DETAIL_TECNICO)}`, { token }),
    sb.rest(`eventi_staff?evento_id=eq.${id}&select=staff_id,ruolo_evento,staff(nome,telefono)`, { token }),
    // ruolo base: la RLS non restituisce la checklist
    sb.rest(`checklist?evento_id=eq.${id}&select=id,voce,quantita,articolo_id,caricato,rientrato,note,updated_at&order=created_at.asc`, { token }),
  ]);
  if (!Array.isArray(eventi) || eventi.length !== 1) throw new HttpError(404, 'not_found');
  const evento = isAdmin ? eventi[0] : perTecnico(eventi[0]);
  return json(200, {
    evento,
    staff: (staff || []).map((s) => ({
      staff_id: s.staff_id,
      ruolo_evento: s.ruolo_evento,
      nome: s.staff?.nome ?? null,
      telefono: s.staff?.telefono ?? null,
    })),
    checklist: checklist || [],
  });
}

export default createHandler(
  {
    GET: {
      auth: 'user',
      fn: (ctx) => (ctx.params.id ? dettaglio(ctx) : elenco(ctx)),
    },
    POST: {
      auth: 'gestione',
      withId: false,
      async fn({ req, sb, token }) {
        const data = validate(await readJson(req), eventoSchema);
        controllaDate(data);
        const rows = await sb.rest('eventi?select=*', { method: 'POST', token, body: data, prefer: 'return=representation' });
        return json(201, { evento: rows?.[0] ?? null });
      },
    },
    PATCH: {
      auth: 'gestione',
      withId: true,
      async fn({ req, params, sb, token }) {
        const data = validate(await readJson(req), eventoSchema, { partial: true });
        controllaDate(data);
        const rows = await sb.rest(`eventi?id=eq.${params.id}&select=*`, {
          method: 'PATCH',
          token,
          body: data,
          prefer: 'return=representation',
        });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { evento: rows[0] });
      },
    },
    DELETE: {
      auth: 'admin',
      withId: true,
      async fn({ params, sb, token }) {
        const rows = await sb.rest(`eventi?id=eq.${params.id}&select=id`, {
          method: 'DELETE',
          token,
          prefer: 'return=representation',
        });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/eventi(?:\/([^/]+))?\/?$/, paramNames: ['id'] },
);
