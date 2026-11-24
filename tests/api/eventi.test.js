import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { ADMIN_ID, EV_ID, PROFILES, TEC_ID, assertNoLeak, cookieFor, mockFetch, req, setEnv, staffRoute } from './_helpers.js';

setEnv();
const eventi = (await import('../../netlify/functions/eventi.js')).default;
const eventiStaff = (await import('../../netlify/functions/eventi-staff.js')).default;
const eventiChecklist = (await import('../../netlify/functions/eventi-checklist.js')).default;
const checklist = (await import('../../netlify/functions/checklist.js')).default;
const clienti = (await import('../../netlify/functions/clienti.js')).default;
const staff = (await import('../../netlify/functions/staff.js')).default;
const richieste = (await import('../../netlify/functions/richieste.js')).default;
const converti = (await import('../../netlify/functions/richieste-converti.js')).default;

const ADMIN = cookieFor(ADMIN_ID);
const TEC = cookieFor(TEC_ID);

// Supabase che (per errore) restituisce anche i campi economici: l'API deve toglierli.
const RIGA_CON_IMPORTI = { id: EV_ID, numero_ordine: '2026-0001', titolo: 'Matrimonio', importo_chf: 12000, acconto_pagato: true, saldo_pagato: false };

function writes(calls) {
  return calls.filter((c) => c.method !== 'GET');
}

describe('eventi — ruolo tecnico', () => {
  beforeEach(setEnv);

  test('non può creare eventi (403) e nessuna scrittura arriva a Supabase', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    const res = await eventi(req('/api/eventi', { method: 'POST', cookie: TEC, body: { titolo: 'X' } }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'forbidden' });
    assert.equal(writes(calls).length, 0);
  });

  test('non può eliminare né modificare eventi (403)', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    let res = await eventi(req(`/api/eventi/${EV_ID}`, { method: 'DELETE', cookie: TEC }));
    assert.equal(res.status, 403);
    res = await eventi(req(`/api/eventi/${EV_ID}`, { method: 'PATCH', cookie: TEC, body: { titolo: 'Y' } }));
    assert.equal(res.status, 403);
    res = await eventiStaff(req(`/api/eventi/${EV_ID}/staff`, { method: 'PUT', cookie: TEC, body: { assegnazioni: [] } }));
    assert.equal(res.status, 403);
    res = await eventiChecklist(req(`/api/eventi/${EV_ID}/checklist`, { method: 'POST', cookie: TEC, body: { voce: 'LED' } }));
    assert.equal(res.status, 403);
    for (const fn of [clienti, staff, richieste]) {
      const name = fn === clienti ? 'clienti' : fn === staff ? 'staff' : 'richieste';
      res = await fn(req(`/api/${name}`, { cookie: TEC }));
      assert.equal(res.status, 403, name);
    }
    assert.equal(writes(calls).length, 0);
  });

  test('elenco: usa la vista eventi_tecnico e non riceve mai importo_chf', async () => {
    const calls = mockFetch([staffRoute(PROFILES), ['GET', /^\/rest\/v1\/eventi_tecnico\?/, () => ({ body: [RIGA_CON_IMPORTI] })]]);
    const res = await eventi(req('/api/eventi?da=2026-01-01&a=2026-12-31&stato=confermato', { cookie: TEC }));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('importo_chf') && !text.includes('acconto_pagato') && !text.includes('saldo_pagato'));
    const q = calls.find((c) => c.url.pathname === '/rest/v1/eventi_tecnico');
    assert.ok(q, 'deve interrogare eventi_tecnico');
    assert.ok(!decodeURIComponent(q.url.search).includes('importo'));
    assert.ok(!calls.some((c) => c.url.pathname === '/rest/v1/eventi'));
  });

  test('dettaglio: niente campi economici', async () => {
    mockFetch([
      staffRoute(PROFILES),
      ['GET', /^\/rest\/v1\/eventi_tecnico\?id=eq\./, () => ({ body: [RIGA_CON_IMPORTI] })],
      ['GET', /^\/rest\/v1\/eventi_staff\?/, () => ({ body: [{ staff_id: TEC_ID, ruolo_evento: 'audio', staff: { nome: 'Tecnico', telefono: null } }] })],
      ['GET', /^\/rest\/v1\/checklist\?/, () => ({ body: [{ id: 'c1', voce: 'LED', quantita: 1, caricato: false, note: null }] })],
    ]);
    const res = await eventi(req(`/api/eventi/${EV_ID}`, { cookie: TEC }));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.evento.titolo, 'Matrimonio');
    assert.ok(!('importo_chf' in data.evento));
    assert.equal(data.staff[0].nome, 'Tecnico');
    assert.equal(data.checklist.length, 1);
  });

  test('dettaglio di un evento non assegnato → 404', async () => {
    mockFetch([staffRoute(PROFILES), ['GET', /^\/rest\/v1\/(eventi_tecnico|eventi_staff|checklist)\?/, () => ({ body: [] })]]);
    const res = await eventi(req(`/api/eventi/${EV_ID}`, { cookie: TEC }));
    assert.equal(res.status, 404);
  });

  test('checklist: può spuntare caricato/note ma non cambiare la voce', async () => {
    const calls = mockFetch([
      staffRoute(PROFILES),
      ['PATCH', /^\/rest\/v1\/checklist\?id=eq\./, (c) => ({ body: [{ id: 'x', caricato: c.body.caricato, note: c.body.note ?? null }] })],
    ]);
    const id = '30000000-0000-4000-8000-000000000001';
    let res = await checklist(req(`/api/checklist/${id}`, { method: 'PATCH', cookie: TEC, body: { caricato: true, note: 'ok' } }));
    assert.equal(res.status, 200);
    assert.deepEqual(writes(calls)[0].body, { caricato: true, note: 'ok' });
    res = await checklist(req(`/api/checklist/${id}`, { method: 'PATCH', cookie: TEC, body: { voce: 'altro' } }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'invalid_input', field: 'voce' });
    res = await checklist(req(`/api/checklist/${id}`, { method: 'PATCH', cookie: TEC, body: { caricato: 'si' } }));
    assert.equal(res.status, 400);
    assert.equal(writes(calls).length, 1);
  });
});

describe('eventi — admin', () => {
  beforeEach(setEnv);

  test('crea evento con dati validi', async () => {
    const calls = mockFetch([
      staffRoute(PROFILES),
      ['POST', /^\/rest\/v1\/eventi\?/, (c) => ({ status: 201, body: [{ id: EV_ID, numero_ordine: '2026-0001', ...c.body }] })],
    ]);
    const body = { titolo: '  Matrimonio Rossi ', data_inizio: '2026-06-20T16:00', data_fine: '2026-06-21', paese: 'CH', servizi: ['Luci', 'Audio'], importo_chf: '1500.50' };
    const res = await eventi(req('/api/eventi', { method: 'POST', cookie: ADMIN, body }));
    assert.equal(res.status, 201);
    const sent = writes(calls)[0];
    assert.equal(sent.body.titolo, 'Matrimonio Rossi');
    assert.equal(sent.body.data_inizio, '2026-06-20T16:00:00');
    assert.equal(sent.body.importo_chf, 1500.5);
    assert.equal(sent.body.numero_ordine, undefined);
    assert.equal(sent.headers.get('prefer'), 'return=representation');
    assert.match(sent.headers.get('authorization'), /^Bearer /);
  });

  test('validazione: campi troppo lunghi, enum errati, campi sconosciuti, date incoerenti', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    const casi = [
      [{ titolo: 'x'.repeat(201) }, 'titolo'],
      [{}, 'titolo'],
      [{ titolo: 'ok', stato: 'pagato' }, 'stato'],
      [{ titolo: 'ok', paese: 'US' }, 'paese'],
      [{ titolo: 'ok', ospiti: -1 }, 'ospiti'],
      [{ titolo: 'ok', importo_chf: 10.123 }, 'importo_chf'],
      [{ titolo: 'ok', data_inizio: '2026-02-30' }, 'data_inizio'],
      [{ titolo: 'ok', data_inizio: '2026-06-02', data_fine: '2026-06-01' }, 'data_fine'],
      [{ titolo: 'ok', servizi: Array(31).fill('a') }, 'servizi'],
      [{ titolo: 'ok', numero_ordine: '1999-0001' }, 'numero_ordine'],
      [{ titolo: 'ok', cliente_id: "1' or 1=1" }, 'cliente_id'],
    ];
    for (const [body, field] of casi) {
      const res = await eventi(req('/api/eventi', { method: 'POST', cookie: ADMIN, body }));
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
      assert.deepEqual(await res.json(), { error: 'invalid_input', field });
    }
    const res = await eventi(req(`/api/eventi?da=ieri`, { cookie: ADMIN }));
    assert.equal(res.status, 400);
    assert.equal(writes(calls).length, 0);
  });

  test('id non valido → 404 senza chiamare il DB', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    const res = await eventi(req('/api/eventi/..%2Fstaff', { method: 'DELETE', cookie: ADMIN }));
    assert.equal(res.status, 404);
    assert.equal(writes(calls).length, 0);
  });

  test('CSRF: Origin errato o X-Requested-With mancante su POST/PATCH/DELETE/PUT → 403', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    const cases = [
      () => eventi(req('/api/eventi', { method: 'POST', cookie: ADMIN, body: { titolo: 'x' }, origin: 'https://evil.example' })),
      () => eventi(req('/api/eventi', { method: 'POST', cookie: ADMIN, body: { titolo: 'x' }, xrw: false })),
      () => eventi(req(`/api/eventi/${EV_ID}`, { method: 'PATCH', cookie: ADMIN, body: { titolo: 'x' }, origin: null })),
      () => eventi(req(`/api/eventi/${EV_ID}`, { method: 'PATCH', cookie: ADMIN, body: { titolo: 'x' }, xrw: false })),
      () => eventi(req(`/api/eventi/${EV_ID}`, { method: 'DELETE', cookie: ADMIN, origin: 'https://meekondisplay.ch.evil.example' })),
      () => eventi(req(`/api/eventi/${EV_ID}`, { method: 'DELETE', cookie: ADMIN, xrw: false })),
      () => eventiStaff(req(`/api/eventi/${EV_ID}/staff`, { method: 'PUT', cookie: ADMIN, body: { assegnazioni: [] }, xrw: false })),
      () => checklist(req(`/api/checklist/${EV_ID}`, { method: 'PATCH', cookie: ADMIN, body: { caricato: true }, origin: 'null' })),
      () => eventi(req('/api/eventi', { method: 'POST', cookie: ADMIN, body: { titolo: 'x' }, headers: { 'Sec-Fetch-Site': 'cross-site' } })),
    ];
    for (const run of cases) {
      const res = await run();
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: 'forbidden_origin' });
    }
    assert.equal(calls.length, 0, 'il controllo CSRF avviene prima di qualsiasi chiamata');
  });

  test('admin vede gli importi', async () => {
    mockFetch([staffRoute(PROFILES), ['GET', /^\/rest\/v1\/eventi\?/, () => ({ body: [RIGA_CON_IMPORTI] })]]);
    const res = await eventi(req('/api/eventi', { cookie: ADMIN }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).eventi[0].importo_chf, 12000);
  });

  test('errore del database → messaggio generico senza dettagli interni', async () => {
    mockFetch([
      staffRoute(PROFILES),
      ['POST', /^\/rest\/v1\/eventi\?/, () => ({ status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "eventi_numero_ordine_key"', details: 'Key (numero_ordine)=(2026-0001)' } })],
      ['DELETE', /^\/rest\/v1\/eventi\?/, () => ({ status: 500, body: { code: 'XX000', message: 'internal postgres error at line 42' } })],
    ]);
    let res = await eventi(req('/api/eventi', { method: 'POST', cookie: ADMIN, body: { titolo: 'x' } }));
    assert.equal(res.status, 409);
    let text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: 'conflict' });
    assertNoLeak(assert, text);
    res = await eventi(req(`/api/eventi/${EV_ID}`, { method: 'DELETE', cookie: ADMIN }));
    assert.equal(res.status, 502);
    text = await res.text();
    assertNoLeak(assert, text);
  });

  test('eccezione inattesa (rete giù) → 502 generico', async () => {
    setEnv();
    globalThis.fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND progetto-test.supabase.co');
    };
    const res = await eventi(req('/api/eventi', { cookie: ADMIN }));
    assert.equal(res.status, 502);
    assertNoLeak(assert, await res.text());
  });

  test('PUT staff: deduplica e chiama la funzione RPC', async () => {
    const calls = mockFetch([staffRoute(PROFILES), ['POST', /^\/rest\/v1\/rpc\/imposta_staff_evento$/, () => ({ status: 204 })]]);
    const res = await eventiStaff(
      req(`/api/eventi/${EV_ID}/staff`, {
        method: 'PUT',
        cookie: ADMIN,
        body: { assegnazioni: [{ staff_id: TEC_ID, ruolo_evento: 'audio' }, { staff_id: TEC_ID, ruolo_evento: 'luci' }] },
      }),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(writes(calls)[0].body, { p_evento: EV_ID, p_assegnazioni: [{ staff_id: TEC_ID, ruolo_evento: 'audio' }] });
  });

  test('clienti: la ricerca viene ripulita dalla sintassi PostgREST', async () => {
    const calls = mockFetch([staffRoute(PROFILES), ['GET', /^\/rest\/v1\/clienti\?/, () => ({ body: [] })]]);
    const res = await clienti(req('/api/clienti?q=' + encodeURIComponent('rossi),id.eq.(x*'), { cookie: ADMIN }));
    assert.equal(res.status, 200);
    const q = new URL(calls.at(-1).url).searchParams.get('or');
    assert.equal(q, '(nome.ilike."*rossi id.eq. x*",azienda.ilike."*rossi id.eq. x*",email.ilike."*rossi id.eq. x*")');
  });

  test('richieste: GET include il paese nel select e nella risposta', async () => {
    const riga = { id: EV_ID, nome: 'Anna', email: 'anna@example.ch', paese: 'IT', stato: 'nuova' };
    const calls = mockFetch([staffRoute(PROFILES), ['GET', /^\/rest\/v1\/richieste_web\?/, () => ({ body: [riga] })]]);
    const res = await richieste(req('/api/richieste?stato=nuova', { cookie: ADMIN }));
    assert.equal(res.status, 200);
    const select = new URL(calls.at(-1).url).searchParams.get('select').split(',');
    assert.ok(select.includes('paese'));
    assert.equal((await res.json()).richieste[0].paese, 'IT');
  });

  test('converti richiesta → 201 con numero ordine', async () => {
    const calls = mockFetch([
      staffRoute(PROFILES),
      ['POST', /^\/rest\/v1\/rpc\/converti_richiesta$/, () => ({ body: { cliente_id: 'c', evento_id: 'e', numero_ordine: '2026-0007' } })],
    ]);
    const res = await converti(req(`/api/richieste/${EV_ID}/converti`, { method: 'POST', cookie: ADMIN }));
    assert.equal(res.status, 201);
    assert.equal((await res.json()).numero_ordine, '2026-0007');
    // Il paese passa all'evento dentro la funzione SQL (migrazione 0002): l'API invia solo id e titolo.
    assert.deepEqual(calls.at(-1).body, { p_richiesta: EV_ID, p_titolo: null });
  });
});
