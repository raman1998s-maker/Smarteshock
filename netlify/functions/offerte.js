// Offerte (solo gestione: admin + ufficio).
// GET    /api/offerte?evento=<uuid>   versioni dell'evento con i totali
// GET    /api/offerte/:id             offerta + righe + totali + evento e cliente (per il PDF)
// POST   /api/offerte                 { evento_id, copia_da? } → nuova versione
// PATCH  /api/offerte/:id             stato, validità, IVA, sconto, testi
// DELETE /api/offerte/:id             solo se in bozza
// Le righe si salvano con PUT /api/offerte/:id/righe (offerte-righe.js).
import { randomBytes } from 'node:crypto';
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { offertaSchema } from './_lib/schemas.js';
import { t, validate } from './_lib/validate.js';

export const config = { path: ['/api/offerte', '/api/offerte/:id'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT =
  'id,evento_id,versione,stato,lingua,anrede,valida_fino,iva_percento,prezzi_iva_inclusa,sconto_percento,sconto_chf,introduzione,condizioni,' +
  'inviata_il,token,accettata_il,accettata_nome,accettata_ip,accettata_agb,accettata_online,foto_consenso,created_at,updated_at';
const SELECT_EVENTO =
  'id,numero_ordine,titolo,tipo,stato,data_inizio,data_fine,montaggio_da,smontaggio_da,localita,sala,indirizzo,' +
  'contatto_luogo_nome,contatto_luogo_telefono,paese,ospiti,cliente:clienti(nome,azienda,email,telefono,lingua,indirizzo,anrede)';

/** Totali calcolati dal DB (vista offerte_totali), convertiti in numeri. */
export function totali(v) {
  const n = (k) => Number(v?.[k] ?? 0);
  return {
    subtotale: n('subtotale'),
    sconto_percento: n('sconto_percento'),
    sconto_percento_chf: n('sconto_percento_chf'),
    sconto_chf: n('sconto_chf'),
    imponibile: n('imponibile'),
    iva_percento: n('iva_percento'),
    prezzi_iva_inclusa: v?.prezzi_iva_inclusa !== false,
    iva: n('iva'),
    totale: n('totale'),
  };
}

async function totaliPer(sb, token, ids) {
  if (!ids.length) return new Map();
  const rows = await sb.rest(`offerte_totali?offerta_id=in.(${ids.join(',')})`, { token });
  return new Map((rows || []).map((r) => [r.offerta_id, totali(r)]));
}

export default createHandler(
  {
    GET: {
      auth: 'gestione',
      async fn({ url, params, sb, token }) {
        if (!params.id) {
          const evento = url.searchParams.get('evento');
          if (!evento || !UUID_RE.test(evento)) throw new HttpError(400, 'invalid_input', { field: 'evento' });
          const rows = (await sb.rest(`offerte?evento_id=eq.${evento}&select=${SELECT}&order=versione.desc`, { token })) || [];
          const tot = await totaliPer(sb, token, rows.map((r) => r.id));
          return json(200, { offerte: rows.map((r) => ({ ...r, totali: tot.get(r.id) ?? totali(null) })) });
        }
        const rows = await sb.rest(`offerte?id=eq.${params.id}&select=${SELECT}`, { token });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        const offerta = rows[0];
        const [righe, eventi, tot, imp] = await Promise.all([
          sb.rest(`offerte_righe?offerta_id=eq.${offerta.id}&select=id,articolo_id,modello_id,componenti,posizione,titolo,descrizione,quantita,giorni,prezzo_unitario,sconto_percento,opzionale&order=posizione.asc`, { token }),
          sb.rest(`eventi?id=eq.${offerta.evento_id}&select=${encodeURIComponent(SELECT_EVENTO)}`, { token }),
          totaliPer(sb, token, [offerta.id]),
          sb.rest('impostazioni?id=eq.1&select=dati', { token }),
        ]);
        return json(200, {
          offerta,
          righe: righe || [],
          totali: tot.get(offerta.id) ?? totali(null),
          evento: eventi?.[0] ?? null,
          impostazioni: imp?.[0]?.dati ?? {}, // intestazione, testi e AGB per il PDF
        });
      },
    },
    POST: {
      auth: 'gestione',
      withId: false,
      async fn({ req, sb, token }) {
        const data = validate(await readJson(req), { evento_id: t.uuid({ required: true }), copia_da: t.uuid() });
        const id = await sb.rest('rpc/nuova_offerta', {
          method: 'POST',
          token,
          body: { p_evento: data.evento_id, p_copia_da: data.copia_da ?? null },
        });
        return json(201, { id });
      },
    },
    PATCH: {
      auth: 'gestione',
      withId: true,
      async fn({ req, params, sb, token }) {
        const data = validate(await readJson(req), offertaSchema, { partial: true });
        if (data.stato === 'accettata') {
          // conferma l'evento e ne aggiorna l'importo, nella stessa transazione
          await sb.rest('rpc/accetta_offerta', { method: 'POST', token, body: { p_offerta: params.id } });
          delete data.stato;
        }
        if (data.stato === 'inviata') {
          // prima dell'invio serve l'indirizzo completo del cliente; si crea il link segreto per l'accettazione online
          const rows = await sb.rest(`offerte?id=eq.${params.id}&select=token,evento:eventi(cliente:clienti(indirizzo))`, { token });
          if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
          if (!rows[0].evento?.cliente?.indirizzo) throw new HttpError(409, 'conflict', { field: 'indirizzo_cliente' });
          data.inviata_il = new Date().toISOString();
          if (!rows[0].token) data.token = randomBytes(24).toString('hex');
        }
        let rows;
        if (Object.keys(data).length) {
          rows = await sb.rest(`offerte?id=eq.${params.id}&select=${SELECT}`, { method: 'PATCH', token, body: data, prefer: 'return=representation' });
        } else {
          rows = await sb.rest(`offerte?id=eq.${params.id}&select=${SELECT}`, { token });
        }
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(404, 'not_found');
        return json(200, { offerta: rows[0] });
      },
    },
    DELETE: {
      auth: 'gestione',
      withId: true,
      async fn({ params, sb, token }) {
        const rows = await sb.rest(`offerte?id=eq.${params.id}&stato=eq.bozza&select=id`, { method: 'DELETE', token, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(409, 'conflict');
        return json(200, { ok: true });
      },
    },
  },
  { pattern: /^\/api\/offerte(?:\/([^/]+))?\/?$/, paramNames: ['id'] },
);
