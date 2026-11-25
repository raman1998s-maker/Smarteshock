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
const impostazioni = (await import('../../netlify/functions/impostazioni.js')).default;
const eventiCompensi = (await import('../../netlify/functions/eventi-compensi.js')).default;
const compensi = (await import('../../netlify/functions/compensi.js')).default;
const spese = (await import('../../netlify/functions/spese.js')).default;
const pubblica = (await import('../../netlify/functions/offerta-pubblica.js')).default;

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

  test('importazione: righe con campi diversi diventano uniformi (richiesto da PostgREST)', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/articoli$/, () => ({ status: 201 })]]);
    const res = await importa(req('/api/articoli/importa', {
      method: 'POST', cookie: UFF,
      body: { articoli: [{ codice: 'E000006623', categoria: 'Altro', sottocategoria: 'Cables', descrizione: 'DVI Cable Mixed', quantita: 17 }, { categoria: 'Audio', descrizione: 'Shure Beta58', marca: 'Shure', prezzo_vendita: 90 }] },
    }));
    assert.equal(res.status, 201);
    const [x, y] = writes(calls)[0].body;
    assert.deepEqual(Object.keys(x).sort(), Object.keys(y).sort());
    assert.equal(x.marca, null);
    assert.equal(y.codice, null);
    assert.equal(y.danneggiati, 0);
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

  test('totali: i numeri del DB (stringhe numeric) diventano numeri', () => {
    const t = offerteMod.totali({ subtotale: '2700.00', sconto_percento: '15.00', sconto_percento_chf: '405.00', sconto_chf: '0.00', imponibile: '2295.00', iva_percento: '8.10', prezzi_iva_inclusa: true, iva: '171.97', totale: '2295.00' });
    assert.equal(t.totale, 2295);
    assert.equal(t.sconto_percento_chf, 405);
    assert.equal(t.prezzi_iva_inclusa, true);
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

  test('"inviata": serve l\'indirizzo del cliente, poi data di invio e link segreto', async () => {
    let indirizzo = null;
    const calls = mockFetch([
      staffRoute(P),
      ['GET', /^\/rest\/v1\/offerte\?id=eq\..*select=token/, () => ({ body: [{ token: null, evento: { cliente: { indirizzo } } }] })],
      ['PATCH', /^\/rest\/v1\/offerte\?id=eq\./, (c) => ({ body: [{ id: OFF_ID, ...c.body }] })],
    ]);
    let res = await offerte(req(`/api/offerte/${OFF_ID}`, { method: 'PATCH', cookie: UFF, body: { stato: 'inviata' } }));
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'conflict', field: 'indirizzo_cliente' });
    assert.equal(writes(calls).length, 0);
    indirizzo = 'Via Prova 1\n6900 Lugano';
    res = await offerte(req(`/api/offerte/${OFF_ID}`, { method: 'PATCH', cookie: UFF, body: { stato: 'inviata' } }));
    assert.equal(res.status, 200);
    const w = writes(calls)[0].body;
    assert.ok(w.inviata_il);
    assert.match(w.token, /^[0-9a-f]{48}$/);
  });

  test('righe validate e salvate in una sola chiamata', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/rpc\/imposta_righe_offerta$/, () => ({ status: 204 })]]);
    let res = await righe(req(`/api/offerte/${OFF_ID}/righe`, { method: 'PUT', cookie: UFF, body: { righe: [{ descrizione: 'LED', quantita: -1 }] } }));
    assert.equal(res.status, 400);
    res = await righe(req(`/api/offerte/${OFF_ID}/righe`, { method: 'PUT', cookie: UFF, body: { righe: [{ descrizione: 'LED', quantita: '2,5', prezzo_unitario: 100 }] } }));
    assert.equal(res.status, 200);
    assert.deepEqual(calls.at(-1).body.p_righe[0], { descrizione: 'LED', quantita: 2.5, giorni: 1, prezzo_unitario: 100, sconto_percento: 0, opzionale: false });
  });

  test('configurazione del disegno: misure valide passano, parti o misure sbagliate → 400', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/rpc\/imposta_righe_offerta$/, () => ({ status: 204 })]]);
    let res = await righe(req(`/api/offerte/${OFF_ID}/righe`, { method: 'PUT', cookie: UFF, body: { righe: [{ descrizione: 'LED', quantita: 24, configurazione: { parte: 'schermo_dietro', w: 8, h: 3 } }] } }));
    assert.equal(res.status, 200);
    assert.deepEqual(calls.at(-1).body.p_righe[0].configurazione, { parte: 'schermo_dietro', w: 8, h: 3 });
    res = await righe(req(`/api/offerte/${OFF_ID}/righe`, { method: 'PUT', cookie: UFF, body: { righe: [{ descrizione: 'LED', configurazione: { parte: 'razzo', n: 1 } }] } }));
    assert.equal(res.status, 400);
    res = await righe(req(`/api/offerte/${OFF_ID}/righe`, { method: 'PUT', cookie: UFF, body: { righe: [{ descrizione: 'LED', configurazione: { parte: 'casse_top', n: 500 } }] } }));
    assert.equal(res.status, 400);
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

describe('impostazioni delle offerte', () => {
  beforeEach(setEnv);

  test('le legge la gestione, non tecnico e base', async () => {
    mockFetch([staffRoute(P), ['GET', /^\/rest\/v1\/impostazioni\?/, () => ({ body: [{ dati: { ditta: { nome: 'X' } } }] })]]);
    assert.equal((await impostazioni(req('/api/impostazioni', { cookie: UFF }))).status, 200);
    assert.equal((await impostazioni(req('/api/impostazioni', { cookie: TEC }))).status, 403);
    assert.equal((await impostazioni(req('/api/impostazioni', { cookie: BASE }))).status, 403);
  });

  test('le scrive solo l\'admin, con struttura controllata', async () => {
    const calls = mockFetch([staffRoute(P), ['PATCH', /^\/rest\/v1\/impostazioni\?/, (c) => ({ body: [{ dati: c.body.dati }] })]]);
    const body = { ditta: { nome: 'Meekon Display', email: 'info@meekondisplay.ch' }, testi: { de: { introduzione: 'Sehr geehrte/r {cliente}', agb: '1. Punto\n2. Punto' } } };
    assert.equal((await impostazioni(req('/api/impostazioni', { method: 'PUT', cookie: UFF, body }))).status, 403);
    assert.equal((await impostazioni(req('/api/impostazioni', { method: 'PUT', cookie: ADMIN, body: { ...body, altro: 1 } }))).status, 400);
    assert.equal((await impostazioni(req('/api/impostazioni', { method: 'PUT', cookie: ADMIN, body: { testi: { es: {} } } }))).status, 400);
    const res = await impostazioni(req('/api/impostazioni', { method: 'PUT', cookie: ADMIN, body }));
    assert.equal(res.status, 200);
    assert.equal(writes(calls).length, 1);
    assert.equal(writes(calls)[0].body.dati.testi.de.agb, '1. Punto\n2. Punto');
  });
});

describe('paga e spese', () => {
  beforeEach(setEnv);

  test('la paga della squadra la imposta solo la gestione', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/rpc\/imposta_compensi_evento$/, () => ({ status: 204 })]]);
    const body = { compensi: [{ staff_id: TEC_ID, ruolo: 'Autista + Installatore', tariffa_chf: 300 }] };
    assert.equal((await eventiCompensi(req(`/api/eventi/${EV_ID}/compensi`, { method: 'PUT', cookie: TEC, body }))).status, 403);
    assert.equal((await eventiCompensi(req(`/api/eventi/${EV_ID}/compensi`, { method: 'GET', cookie: BASE }))).status, 403);
    const res = await eventiCompensi(req(`/api/eventi/${EV_ID}/compensi`, { method: 'PUT', cookie: UFF, body }));
    assert.equal(res.status, 200);
    assert.deepEqual(calls.at(-1).body.p_compensi[0], { staff_id: TEC_ID, ruolo: 'Autista + Installatore', quantita: 1, tariffa_chf: 300 });
  });

  test('ognuno legge i propri compensi tramite la funzione del DB', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/rpc\/miei_compensi$/, () => ({ body: [] })]]);
    const res = await compensi(req('/api/compensi?da=2026-11-01&a=2026-11-30', { cookie: BASE }));
    assert.equal(res.status, 200);
    assert.deepEqual(calls.at(-1).body, { p_da: '2026-11-01', p_a: '2026-11-30' });
  });

  test('la spesa nasce sempre "inviata" e di chi la inserisce', async () => {
    const calls = mockFetch([staffRoute(P), ['POST', /^\/rest\/v1\/spese\?/, (c) => ({ status: 201, body: [{ id: EV_ID, ...c.body }] })]]);
    let res = await spese(req('/api/spese', { method: 'POST', cookie: TEC, body: { tipo: 'diesel', importo_chf: 80, stato: 'approvata' } }));
    assert.equal(res.status, 400); // "stato" non è un campo ammesso
    res = await spese(req('/api/spese', { method: 'POST', cookie: TEC, body: { tipo: 'diesel', importo_chf: '80.50' } }));
    assert.equal(res.status, 201);
    const w = writes(calls).at(-1).body;
    assert.equal(w.stato, 'inviata');
    assert.equal(w.staff_id, TEC_ID);
    res = await spese(req('/api/spese', { method: 'POST', cookie: TEC, body: { tipo: 'diesel', importo_chf: 0 } }));
    assert.equal(res.status, 400);
  });

  test('approvare è della gestione; l\'elenco di un operaio è sempre il suo', async () => {
    const calls = mockFetch([
      staffRoute(P),
      ['PATCH', /^\/rest\/v1\/spese\?id=eq\./, (c) => ({ body: [{ id: EV_ID, ...c.body }] })],
      ['GET', /^\/rest\/v1\/spese\?/, () => ({ body: [] })],
    ]);
    assert.equal((await spese(req(`/api/spese/${EV_ID}`, { method: 'PATCH', cookie: TEC, body: { stato: 'approvata' } }))).status, 403);
    assert.equal((await spese(req(`/api/spese/${EV_ID}`, { method: 'PATCH', cookie: UFF, body: { stato: 'approvata' } }))).status, 200);
    await spese(req('/api/spese?tutte=1', { cookie: TEC }));
    assert.ok(calls.at(-1).path.includes(`staff_id=eq.${TEC_ID}`));
    await spese(req('/api/spese?tutte=1', { cookie: UFF }));
    assert.ok(!calls.at(-1).path.includes('staff_id=eq.'));
  });
});

describe('accettazione online (pubblica)', () => {
  beforeEach(setEnv);
  const TOK = 'ab'.repeat(24);

  test('senza token valido → 404, nessuna chiamata a Supabase', async () => {
    const calls = mockFetch([]);
    const res = await pubblica(req('/api/offerta-pubblica?t=123'));
    assert.equal(res.status, 404);
    assert.equal(calls.length, 0);
  });

  test('legge il riepilogo con il ruolo anon (nessun JWT utente)', async () => {
    const calls = mockFetch([['POST', /^\/rest\/v1\/rpc\/offerta_pubblica$/, () => ({ body: { numero: '2026-0007', righe: [] } })]]);
    const res = await pubblica(req(`/api/offerta-pubblica?t=${TOK}`));
    assert.equal(res.status, 200);
    assert.equal(calls[0].headers.get('authorization'), null);
  });

  test('le due caselle obbligatorie devono essere spuntate; si registra l\'IP', async () => {
    const calls = mockFetch([['POST', /^\/rest\/v1\/rpc\/accetta_offerta_online$/, () => ({ body: { ok: true, accettata_il: '2026-12-01T10:00:00Z' } })]]);
    let res = await pubblica(req('/api/offerta-pubblica', { method: 'POST', body: { t: TOK, nome: 'Anna Muster', agb: true, annullamento: false } }));
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
    res = await pubblica(req('/api/offerta-pubblica', { method: 'POST', headers: { 'x-nf-client-connection-ip': '203.0.113.7' }, body: { t: TOK, nome: 'Anna Muster', agb: true, annullamento: true, foto: true } }));
    assert.equal(res.status, 200);
    assert.deepEqual(calls[0].body, { p_token: TOK, p_nome: 'Anna Muster', p_foto: true, p_ip: '203.0.113.7' });
  });

  test('da un altro sito (Origin diverso) → 403', async () => {
    mockFetch([]);
    const res = await pubblica(req('/api/offerta-pubblica', { method: 'POST', origin: 'https://evil.example', body: { t: TOK, nome: 'X Y', agb: true, annullamento: true } }));
    assert.equal(res.status, 403);
  });
});

describe('difettoso e veicoli', () => {
  beforeEach(setEnv);
  test('guasti e veicoli: scrive solo la gestione; il partner non vede i veicoli', async () => {
    const guasti = (await import('../../netlify/functions/guasti.js')).default;
    const veicoli = (await import('../../netlify/functions/veicoli.js')).default;
    const P2 = { ...P, '00000000-0000-4000-8000-0000000000d9': { id: '00000000-0000-4000-8000-0000000000d9', nome: 'DJ', ruolo: 'partner', attivo: true } };
    const calls = mockFetch([
      staffRoute(P2),
      ['POST', /^\/rest\/v1\/guasti\?/, (c) => ({ status: 201, body: [c.body] })],
      ['POST', /^\/rest\/v1\/veicoli\?/, (c) => ({ status: 201, body: [c.body] })],
      ['GET', /^\/rest\/v1\/veicoli\?/, () => ({ body: [] })],
    ]);
    const g = { articolo_id: EV_ID, quantita: 2, descrizione: 'Pannello rotto' };
    assert.equal((await guasti(req('/api/guasti', { method: 'POST', cookie: TEC, body: g }))).status, 403);
    assert.equal((await guasti(req('/api/guasti', { method: 'POST', cookie: UFF, body: g }))).status, 201);
    assert.equal(writes(calls).at(-1).body.stato, 'da_riparare');
    assert.equal((await veicoli(req('/api/veicoli', { method: 'POST', cookie: TEC, body: { nome: 'Sprinter', portata_kg: 1000 } }))).status, 403);
    assert.equal((await veicoli(req('/api/veicoli', { method: 'POST', cookie: UFF, body: { nome: 'Sprinter', portata_kg: 0 } }))).status, 400);
    assert.equal((await veicoli(req('/api/veicoli', { method: 'POST', cookie: UFF, body: { nome: 'Sprinter', targa: 'SG 1', portata_kg: 1100 } }))).status, 201);
    assert.equal((await veicoli(req('/api/veicoli', { cookie: TEC }))).status, 200);
    assert.equal((await veicoli(req('/api/veicoli', { cookie: cookieFor('00000000-0000-4000-8000-0000000000d9') }))).status, 403);
  });
});
