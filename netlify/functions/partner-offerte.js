// Offerte dei partner (DJ) ai loro clienti.
// GET    /api/partner-offerte?materiale=   le proprie (partner) o tutte (gestione, filtrabili per stato del materiale)
// GET    /api/partner-offerte/:id          offerta + righe + totali + costo del materiale + profilo del partner e AGB Meekon (per il PDF)
// POST   /api/partner-offerte              nuova offerta (partner)
// PATCH  /api/partner-offerte/:id          campi e stato (partner; le regole sugli stati stanno nel DB)
// DELETE /api/partner-offerte/:id          solo bozze (partner)
import { isGestione } from './_lib/auth.js';
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { partnerOffertaSchema } from './_lib/schemas.js';
import { validate } from './_lib/validate.js';

export const config = { path: ['/api/partner-offerte', '/api/partner-offerte/:id'] };

const CAMPI = Object.keys(partnerOffertaSchema).filter((k) => k !== 'stato');
const SELECT = `id,partner_id,numero,stato,materiale_stato,${CAMPI.join(',')},inviata_il,accettata_il,nota_meekon,evento_id,created_at,updated_at`;
const STATI_MATERIALE = ['nessuno', 'in_attesa', 'da_confermare', 'confermato', 'rifiutato'];
const num = (v, k) => Number(v?.[k] ?? 0);
const totali = (v) => ({
  subtotale: num(v, 'subtotale'), sconto_percento: num(v, 'sconto_percento'), sconto_percento_chf: num(v, 'sconto_percento_chf'),
  sconto_chf: num(v, 'sconto_chf'), imponibile: num(v, 'imponibile'), iva_percento: num(v, 'iva_percento'),
  prezzi_iva_inclusa: v?.prezzi_iva_inclusa !== false, iva: num(v, 'iva'), totale: num(v, 'totale'),
});

export default createHandler(
  {
    GET: {
      auth: 'user',
      async fn({ url, params, sb, token, user }) {
        const gestione = isGestione(user);
        if (!gestione && user.ruolo !== 'partner') throw new HttpError(403, 'forbidden');
        if (!params.id) {
          const q = new URLSearchParams({ select: `${SELECT},partner:staff(nome)`, order: 'created_at.desc', limit: '500' });
          const m = url.searchParams.get('materiale');
          if (m) {
            const lista = m.split(',');
            if (lista.some((x) => !STATI_MATERIALE.includes(x))) throw new HttpError(400, 'invalid_input', { field: 'materiale' });
            q.set('materiale_stato', `in.(${lista.join(',')})`);
          }
          const rows = (await sb.rest(`partner_offerte?${q}`, { token })) || [];
          const ids = rows.map((r) => r.id);
          const tot = ids.length ? await sb.rest(`partner_offerte_totali?offerta_id=in.(${ids.join(',')})`, { token }) : [];
          const t = new Map((tot || []).map((x) => [x.offerta_id, totali(x)]));
          return json(200, { offerte: rows.map((r) => ({ ...r, partner_nome: r.partner?.nome ?? null, partner: undefined, totali: t.get(r.id) ?? totali(null) })) });
        }
        const rows = await sb.rest(`partner_offerte?id=eq.${params.id}&select=${SELECT}`, { token });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        const o = rows[0];
        const [righe, tot, costo, profilo, agb] = await Promise.all([
          sb.rest(`partner_righe?offerta_id=eq.${o.id}&select=id,posizione,tipo,articolo_id,titolo,descrizione,quantita,giorni,prezzo_unitario,sconto_percento,opzionale&order=posizione.asc`, { token }),
          sb.rest(`partner_offerte_totali?offerta_id=eq.${o.id}`, { token }),
          sb.rest('rpc/costo_materiale_partner', { method: 'POST', token, body: { p_offerta: o.id } }),
          sb.rest(`partner_profili?staff_id=eq.${o.partner_id}&select=*`, { token }),
          sb.rest('rpc/agb_meekon', { method: 'POST', token, body: {} }),
        ]);
        return json(200, {
          offerta: o, righe: righe || [], totali: totali(tot?.[0]), costo_materiale: Number(costo ?? 0),
          profilo: profilo?.[0] ?? null, agb_meekon: agb ?? null,
        });
      },
    },
    POST: {
      auth: 'partner',
      withId: false,
      async fn({ req, sb, token, user }) {
        const data = validate(await readJson(req), partnerOffertaSchema);
        delete data.stato;
        const rows = await sb.rest(`partner_offerte?select=${SELECT}`, { method: 'POST', token, body: { ...data, partner_id: user.id }, prefer: 'return=representation' });
        return json(201, { offerta: rows?.[0] ?? null });
      },
    },
    PATCH: {
      auth: 'partner',
      withId: true,
      async fn({ req, params, sb, token }) {
        const data = validate(await readJson(req), partnerOffertaSchema, { partial: true });
        const rows = await sb.rest(`partner_offerte?id=eq.${params.id}&select=${SELECT}`, { method: 'PATCH', token, body: data, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { offerta: rows[0] });
      },
    },
    DELETE: {
      auth: 'partner',
      withId: true,
      async fn({ params, sb, token }) {
        const rows = await sb.rest(`partner_offerte?id=eq.${params.id}&stato=eq.bozza&select=id`, { method: 'DELETE', token, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(409, 'conflict');
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/partner-offerte(?:\/([^/]+))?\/?$/, paramNames: ['id'] },
);
