// Gestionale: ruoli ufficio/base, utenti, magazzino, offerte, assenze.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { ADMIN_ID, EV_ID, PROFILES, TEC_ID, cookieFor, mockFetch, req, setEnv, staffRoute } from './_helpers.js';

setEnv();
const eventi = (await import('../../netlify/functions/eventi.js')).default;
const staff = (await import('../../netlify/functions/staff.js')).default;
const articoli = (await import('../../netlify/functions/articoli.js')).default;
const importa = (await import('../../netlify/functions/articoli-importa.js')).default;
const disponibilita = (await import('../../netlify/functions/articoli-disponibilita.js')).default;
const offerteMod = await import('../../netlify/functions/offerte.js');
const offerte = offerteMod.default;
const righe = (await import('../../netlify/functions/offerte-righe.js')).default;
const assenze = (await import('../../netlify/functions/assenze.js')).default;

const UFF_ID = '00000000-0000-4000-8000-00000000000c';
const BASE_ID = '00000000-0000-4000-8000-00000000000d';
const OFF_ID = '30000000-0000-4000-8000-000000000001';
const P = {
  ...PROFILES,
  [UFF_ID]: { id: UFF_ID, nome: 'Ufficio', ruolo: 'ufficio', attivo: true },
  [BASE_ID]: { id: BASE_ID, nome: 'Base', ruolo: 'base', attivo: true },
};
const ADMIN = cookieFor(ADMIN_ID);
const UFF = cookieFor(UFF_ID);
const TEC = cookieFor(TEC_ID);
const BASE = cookieFor(BASE_ID);
const writes = (calls) => calls.filter((c) => c.method !== 'GET');

describe('ruolo ufficio', () => {
  beforeEach(setEnv);

  test('crea eventi e legge la tabella completa', async () => {
    const calls = mockFetch([
      staffRoute(P),
      ['POST', /^\/rest\/v1\/eventi\?/, () => ({ status: 201, body: [{ id: EV_ID, titolo: 'X' }] })],
      ['GET', /^\/rest\/v1\/eventi\?/, () => ({ body: [{ id: EV_ID, importo_chf: 100 }] })],
    ]);
    let res = await eventi(req('/api/eventi', { method: 'POST', cookie: UFF, body: { titolo: 'X', indirizzo: 'Via 1' } }));
    assert.equal(res.status, 201);
    res = await eventi(req('/api/eventi', { cookie: UFF }));
    assert.equal((await res.json()).eventi[0].importo_chf, 100);
    assert.ok(calls.some((c) => c.path.startsWith('/rest/v1/eventi?') && c.method === 'GET'));
  });

  test('non elimina eventi e non cambia i ruoli (403)', async () => {
    const calls = mockFetch([staffRoute(P)]);
    let res = await eventi(req(`/api/eventi/${EV_ID}`, { method: 'DELETE', cookie: UFF }));
    assert.equal(res.status, 403);
    res = await staff(req(`/api/staff/${TEC_ID}`, { method: 'PATCH', cookie: UFF, body: { ruolo: 'admin' } }));
    assert.equal(res.status, 403);
    assert.equal(writes(calls).length, 0);
  });

  test('legge l\'elenco dei dipendenti per assegnare la squadra', async () => {
    mockFetch([staffRoute(P), ['GET', /^\/rest\/v1\/staff\?select=/, () => ({ body: [] })]]);
    const res = await staff(req('/api/staff', { cookie: UFF }));
    assert.equal(res.status, 200);
  });
});

describe('ruolo base e tecnico', () => {
  beforeEach(setEnv);

  test('il ruolo base entra e legge solo la vista eventi_tecnico, senza importi', async () => {
    const calls = mockFetch([staffRoute(P), ['GET', /^\/rest\/v1\/eventi_tecnico\?/, () => ({ body: [{ id: EV_ID, titolo: 'Oggi', importo_chf: 1 }] })]]);
    const res = await eventi(req('/api/eventi', { cookie: BASE }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.eventi[0].importo_chf, undefined);
    assert.ok(!calls.some((c) => c.path.startsWith('/rest/v1/eventi?')));
  });

  test('base e tecnico non accedono a magazzino e offerte (403)', async () => {
    const calls = mockFetch([staffRoute(P)]);
    for (const cookie of [TEC, BASE]) {
      assert.equal((await articoli(req('/api/articoli', { cookie }))).status, 403);
      assert.equal((await disponibilita(req('/api/articoli/disponibilita?da=2026-12-01', { cookie }))).status, 403);
      assert.equal((await offerte(req(`/api/offerte?evento=${EV_ID}`, { cookie }))).status, 403);
      assert.equal((await offerte(req('/api/offerte', { method: 'POST', cookie, body: { evento_id: EV_ID } }))).status, 403);
      assert.equal((await righe(req(`/api/offerte/${OFF_ID}/righe`, { method: 'PUT', cookie, body: { righe: [] } }))).status, 403);
    }
    assert.equal(writes(calls).length, 0);
  });

  test('un ruolo sconosciuto viene rifiutato', async () => {
    const ID = '00000000-0000-4000-8000-00000000000e';
    mockFetch([staffRoute({ [ID]: { id: ID, nome: 'X', ruolo: 'ospite', attivo: true } })]);
    const res = await eventi(req('/api/eventi', { cookie: cookieFor(ID) }));
    assert.equal(res.status, 403);
  });
});

describe('utenti (solo admin)', () => {
  beforeEach(setEnv);

  test('l\'admin cambia ruolo e stato di un dipendente', async () => {
    const calls = mockFetch([
      staffRoute(P),
      ['PATCH', /^\/rest\/v1\/staff\?id=eq\./, (c) => ({ body: [{ id: TEC_ID, ...c.body }] })],
    ]);
    const res = await staff(req(`/api/staff/${TEC_ID}`, { method: 'PATCH', cookie: ADMIN, body: { ruolo: 'base', attivo: false } }));
    assert.equal(res.status, 200);
    assert.deepEqual(writes(calls)[0].body, { ruolo: 'base', attivo: false });
  });

  test('l\'admin non può disattivarsi né togliersi il ruolo (409)', async () => {
    const calls = mockFetch([staffRoute(P)]);
    let res = await staff(req(`/api/staff/${ADMIN_ID}`, { method: 'PATCH', cookie: ADMIN, body: { attivo: false } }));
    assert.equal(res.status, 409);
    res = await staff(req(`/api/staff/${ADMIN_ID}`, { method: 'PATCH', cookie: ADMIN, body: { ruolo: 'ufficio' } }));
    assert.equal(res.status, 409);
    assert.equal(writes(calls).length, 0);
  });

  test('ruolo non valido → 400', async () => {
    mockFetch([staffRoute(P)]);
    const res = await staff(req(`/api/staff/${TEC_ID}`, { method: 'PATCH', cookie: ADMIN, body: { ruolo: 'capo' } }));
    assert.equal(res.status, 400);
  });
});

describe('magazzino', () => {
  beforeEach(setEnv);

  test('importazione: indica la riga sbagliata e non scrive nulla', async () => {
    const calls = mockFetch([staffRoute(P)]);
    const res = await importa(req('/api/articoli/importa', {
      method: 'POST', cookie: UFF,
      body: { articoli: [{ categoria: 'Audio', descrizione: 'Shure' }, { categoria: 'Audio', descrizione: '', quantita: 2 }] },
    }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'invalid_input', field: 'descrizione', riga: 2 });
    assert.equal(writes(calls).length, 0);
  });

  test('importazione valida: una sola scrittura con tutte le righe', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/articoli$/, () => ({ status: 201 })]]);
    const res = await importa(req('/api/articoli/importa', {
      method: 'POST', cookie: UFF,
      body: { articoli: [{ categoria: 'Rigging', marca: 'Eurotruss', descrizione: 'FD34 300cm', quantita: 68, prezzo_vendita: 203, in_vendita: true }] },
    }));
    assert.equal(res.status, 201);
    const w = writes(calls);
    assert.equal(w.length, 1);
    assert.equal(w[0].body[0].prezzo_vendita, 203);
  });

  test('cancellare un articolo è solo per l\'admin', async () => {
    mockFetch([staffRoute(P)]);
    const res = await articoli(req(`/api/articoli/${EV_ID}`, { method: 'DELETE', cookie: UFF }));
    assert.equal(res.status, 403);
  });

  test('disponibilità: date controllate e passate alla funzione del DB', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/rpc\/disponibilita_articoli$/, () => ({ body: [] })]]);
    let res = await disponibilita(req('/api/articoli/disponibilita?da=2026-12-10&a=2026-12-01', { cookie: UFF }));
    assert.equal(res.status, 400);
    res = await disponibilita(req(`/api/articoli/disponibilita?da=2026-12-01&a=2026-12-03&escludi=${EV_ID}`, { cookie: UFF }));
    assert.equal(res.status, 200);
    assert.deepEqual(calls.at(-1).body, { p_da: '2026-12-01', p_a: '2026-12-03', p_escludi: EV_ID });
  });
});

describe('offerte', () => {
  beforeEach(setEnv);

  test('totali: IVA 8.1% e arrotondamento ai 5 centesimi', () => {
    const t = offerteMod.totali({ subtotale: 693.33, sconto_chf: 0, imponibile: 693.33, iva_percento: 8.1 });
    assert.equal(t.iva, 56.16);
    assert.equal(t.totale, 749.5);
  });

  test('"accettata" passa dalla funzione del DB che conferma l\'evento', async () => {
    const calls = mockFetch([
      staffRoute(P),
      ['POST', /^\/rest\/v1\/rpc\/accetta_offerta$/, () => ({ status: 204 })],
      ['GET', /^\/rest\/v1\/offerte\?id=eq\./, () => ({ body: [{ id: OFF_ID, stato: 'accettata' }] })],
    ]);
    const res = await offerte(req(`/api/offerte/${OFF_ID}`, { method: 'PATCH', cookie: UFF, body: { stato: 'accettata' } }));
    assert.equal(res.status, 200);
    assert.deepEqual(writes(calls).map((c) => c.url.pathname), ['/rest/v1/rpc/accetta_offerta']);
  });

  test('"inviata" registra la data di invio', async () => {
    const calls = mockFetch([staffRoute(P), ['PATCH', /^\/rest\/v1\/offerte\?id=eq\./, (c) => ({ body: [{ id: OFF_ID, ...c.body }] })]]);
    const res = await offerte(req(`/api/offerte/${OFF_ID}`, { method: 'PATCH', cookie: UFF, body: { stato: 'inviata' } }));
    assert.equal(res.status, 200);
    assert.ok(writes(calls)[0].body.inviata_il);
  });

  test('righe validate e salvate in una sola chiamata', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/rpc\/imposta_righe_offerta$/, () => ({ status: 204 })]]);
    let res = await righe(req(`/api/offerte/${OFF_ID}/righe`, { method: 'PUT', cookie: UFF, body: { righe: [{ descrizione: 'LED', quantita: -1 }] } }));
    assert.equal(res.status, 400);
    res = await righe(req(`/api/offerte/${OFF_ID}/righe`, { method: 'PUT', cookie: UFF, body: { righe: [{ descrizione: 'LED', quantita: '2,5', prezzo_unitario: 100 }] } }));
    assert.equal(res.status, 200);
    assert.deepEqual(calls.at(-1).body.p_righe[0], { descrizione: 'LED', quantita: 2.5, giorni: 1, prezzo_unitario: 100, sconto_percento: 0 });
  });

  test('offerta non più in bozza → 409', async () => {
    mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/rpc\/imposta_righe_offerta$/, () => ({ status: 400, body: { code: '55000', message: 'x' } })]]);
    const res = await righe(req(`/api/offerte/${OFF_ID}/righe`, { method: 'PUT', cookie: UFF, body: { righe: [] } }));
    assert.equal(res.status, 409);
  });
});

describe('assenze', () => {
  beforeEach(setEnv);

  test('il tecnico segna solo le proprie (staff_id forzato)', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/assenze\?/, (c) => ({ status: 201, body: [{ id: EV_ID, ...c.body }] })]]);
    const res = await assenze(req('/api/assenze', { method: 'POST', cookie: TEC, body: { dal: '2026-12-01', al: '2026-12-02', staff_id: ADMIN_ID } }));
    assert.equal(res.status, 201);
    assert.equal(writes(calls)[0].body.staff_id, TEC_ID);
  });

  test('l\'ufficio può segnarle per un altro dipendente', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/assenze\?/, (c) => ({ status: 201, body: [{ id: EV_ID, ...c.body }] })]]);
    await assenze(req('/api/assenze', { method: 'POST', cookie: UFF, body: { dal: '2026-12-01', al: '2026-12-01', staff_id: TEC_ID } }));
    assert.equal(writes(calls)[0].body.staff_id, TEC_ID);
  });

  test('date al contrario → 400', async () => {
    mockFetch([staffRoute(P)]);
    const res = await assenze(req('/api/assenze', { method: 'POST', cookie: BASE, body: { dal: '2026-12-05', al: '2026-12-01' } }));
    assert.equal(res.status, 400);
  });
});
