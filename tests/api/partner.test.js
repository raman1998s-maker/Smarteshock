// Area partner (DJ): permessi e validazione delle API.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { ADMIN_ID, PROFILES, TEC_ID, cookieFor, mockFetch, req, setEnv, staffRoute } from './_helpers.js';

setEnv();
const partner = (await import('../../netlify/functions/partner.js')).default;
const profilo = (await import('../../netlify/functions/partner-profilo.js')).default;
const catalogo = (await import('../../netlify/functions/partner-catalogo.js')).default;
const offerte = (await import('../../netlify/functions/partner-offerte.js')).default;
const righe = (await import('../../netlify/functions/partner-offerte-righe.js')).default;
const materiale = (await import('../../netlify/functions/partner-materiale.js')).default;
const eventi = (await import('../../netlify/functions/eventi.js')).default;
const articoli = (await import('../../netlify/functions/articoli.js')).default;

const DJ_ID = '00000000-0000-4000-8000-0000000000d1';
const OFF = '40000000-0000-4000-8000-000000000001';
const ART = '50000000-0000-4000-8000-000000000001';
const P = { ...PROFILES, [DJ_ID]: { id: DJ_ID, nome: 'DJ Uno', ruolo: 'partner', attivo: true } };
const DJ = cookieFor(DJ_ID);
const ADMIN = cookieFor(ADMIN_ID);
const TEC = cookieFor(TEC_ID);
const writes = (calls) => calls.filter((c) => c.method !== 'GET');

describe('partner: cosa può fare', () => {
  beforeEach(setEnv);

  test('non accede a eventi, catalogo interno, elenco partner (403 o solo la vista vuota)', async () => {
    mockFetch([staffRoute(P), ['GET', /^\/rest\/v1\/eventi_tecnico\?/, () => ({ body: [] })]]);
    assert.equal((await articoli(req('/api/articoli', { cookie: DJ }))).status, 403);
    assert.equal((await partner(req('/api/partner', { cookie: DJ }))).status, 403);
    const res = await eventi(req('/api/eventi', { cookie: DJ }));
    assert.deepEqual((await res.json()).eventi, []);
  });

  test('il profilo si salva per sé stesso, senza sconto', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/partner_profili\?on_conflict=staff_id/, (c) => ({ body: [c.body] })]]);
    let res = await profilo(req('/api/partner/profilo', { method: 'PUT', cookie: DJ, body: { ragione_sociale: 'DJ Uno GmbH', sconto_partner_percento: 50 } }));
    assert.equal(res.status, 400); // sconto non è un campo del profilo
    res = await profilo(req('/api/partner/profilo', { method: 'PUT', cookie: DJ, body: { ragione_sociale: 'DJ Uno GmbH', iban: 'CH9300762011623852957', logo: 'data:image/png;base64,iVBORw0KGgo=' } }));
    assert.equal(res.status, 200);
    const w = writes(calls)[0].body;
    assert.equal(w.staff_id, DJ_ID);
    assert.equal(w.usa_agb_meekon, true);
    assert.ok(!('sconto_partner_percento' in w));
  });

  test('logo che non è un\'immagine → 400', async () => {
    mockFetch([staffRoute(P)]);
    const res = await profilo(req('/api/partner/profilo', { method: 'PUT', cookie: DJ, body: { logo: 'javascript:alert(1)' } }));
    assert.equal(res.status, 400);
  });

  test('crea offerte solo come partner; lo stato iniziale lo decide il DB', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/partner_offerte\?/, (c) => ({ status: 201, body: [{ id: OFF, ...c.body }] })]]);
    assert.equal((await offerte(req('/api/partner-offerte', { method: 'POST', cookie: TEC, body: {} }))).status, 403);
    const res = await offerte(req('/api/partner-offerte', { method: 'POST', cookie: DJ, body: { cliente_nome: 'Sposi Rossi', stato: 'accettata' } }));
    assert.equal(res.status, 201);
    const w = writes(calls)[0].body;
    assert.equal(w.partner_id, DJ_ID);
    assert.equal(w.stato, undefined);
  });

  test('righe materiale senza articolo → 400', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/rpc\/imposta_righe_partner$/, () => ({ status: 204 })]]);
    let res = await righe(req(`/api/partner-offerte/${OFF}/righe`, { method: 'PUT', cookie: DJ, body: { righe: [{ tipo: 'materiale', descrizione: 'Truss' }] } }));
    assert.equal(res.status, 400);
    res = await righe(req(`/api/partner-offerte/${OFF}/righe`, { method: 'PUT', cookie: DJ, body: { righe: [{ tipo: 'servizio', descrizione: 'DJ 6 ore', prezzo_unitario: 1200 }, { tipo: 'materiale', articolo_id: ART, descrizione: 'Truss', quantita: 4 }] } }));
    assert.equal(res.status, 200);
    assert.equal(calls.at(-1).body.p_righe.length, 2);
  });

  test('il catalogo partner non è per tecnici', async () => {
    mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/rpc\/catalogo_partner$/, () => ({ body: [] })]]);
    assert.equal((await catalogo(req('/api/partner/catalogo', { cookie: TEC }))).status, 403);
    assert.equal((await catalogo(req('/api/partner/catalogo?da=2026-12-01', { cookie: DJ }))).status, 200);
  });

  test('non decide sul materiale (solo la gestione)', async () => {
    const calls = mockFetch([staffRoute(P)]);
    const res = await materiale(req(`/api/partner-offerte/${OFF}/materiale`, { method: 'POST', cookie: DJ, body: { azione: 'conferma' } }));
    assert.equal(res.status, 403);
    assert.equal(writes(calls).length, 0);
  });
});

describe('ufficio: richieste dei partner', () => {
  beforeEach(setEnv);

  test('conferma tramite la funzione del DB, rifiuto solo con una nota', async () => {
    const calls = mockFetch([
      staffRoute(P),
      ['POST', /^\/rest\/v1\/rpc\/conferma_materiale_partner$/, () => ({ body: '60000000-0000-4000-8000-000000000001' })],
      ['PATCH', /^\/rest\/v1\/partner_offerte\?id=eq\./, () => ({ body: [{ id: OFF }] })],
    ]);
    let res = await materiale(req(`/api/partner-offerte/${OFF}/materiale`, { method: 'POST', cookie: ADMIN, body: { azione: 'conferma' } }));
    assert.equal(res.status, 200);
    res = await materiale(req(`/api/partner-offerte/${OFF}/materiale`, { method: 'POST', cookie: ADMIN, body: { azione: 'rifiuta' } }));
    assert.equal(res.status, 400);
    res = await materiale(req(`/api/partner-offerte/${OFF}/materiale`, { method: 'POST', cookie: ADMIN, body: { azione: 'rifiuta', nota: 'Truss non disponibili' } }));
    assert.equal(res.status, 200);
    assert.deepEqual(writes(calls).at(-1).body, { materiale_stato: 'rifiutato', nota_meekon: 'Truss non disponibili' });
  });

  test('imposta lo sconto del partner', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/partner_profili\?on_conflict=staff_id/, (c) => ({ body: [c.body] })]]);
    const res = await partner(req(`/api/partner/${DJ_ID}`, { method: 'PATCH', cookie: ADMIN, body: { sconto_partner_percento: 20 } }));
    assert.equal(res.status, 200);
    assert.deepEqual(writes(calls)[0].body, { staff_id: DJ_ID, sconto_partner_percento: 20 });
  });
});

describe('modelli di allestimento', () => {
  beforeEach(setEnv);
  test('li crea solo la gestione; le voci sono controllate', async () => {
    const modelli = (await import('../../netlify/functions/modelli.js')).default;
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/rpc\/salva_modello$/, () => ({ body: '70000000-0000-4000-8000-000000000001' })], ['GET', /^\/rest\/v1\/modelli\?/, () => ({ body: [] })]]);
    const body = { nome: 'Schermo davanti e dietro', voci: [{ articolo_id: ART, quantita: 12 }] };
    assert.equal((await modelli(req('/api/modelli', { method: 'POST', cookie: DJ, body }))).status, 403);
    assert.equal((await modelli(req('/api/modelli', { method: 'POST', cookie: ADMIN, body: { nome: 'X', voci: [{ articolo_id: 'no' }] } }))).status, 400);
    assert.equal((await modelli(req('/api/modelli', { method: 'POST', cookie: ADMIN, body }))).status, 201);
    assert.deepEqual(calls.at(-1).body.p_dati.voci, [{ articolo_id: ART, quantita: 12 }]);
    assert.equal((await modelli(req('/api/modelli', { cookie: DJ }))).status, 200);
    assert.equal((await modelli(req('/api/modelli', { cookie: TEC }))).status, 403);
  });
});
