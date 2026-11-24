// Migrazione 0004: note_squadra / note_interne e pulizia delle richieste vecchie.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, test } from 'node:test';
import { ADMIN_ID, EV_ID, PROFILES, TEC_ID, assertNoLeak, cookieFor, mockFetch, req, setEnv, staffRoute } from './_helpers.js';

setEnv();
const eventi = (await import('../../netlify/functions/eventi.js')).default;
const pulizia = (await import('../../netlify/functions/richieste-pulizia.js')).default;
const richiesteMod = await import('../../netlify/functions/richieste.js');

const ADMIN = cookieFor(ADMIN_ID);
const TEC = cookieFor(TEC_ID);

// Supabase che (per errore) restituisce anche note_interne e importi.
const RIGA = {
  id: EV_ID,
  numero_ordine: '2026-0001',
  titolo: 'Matrimonio',
  note_squadra: 'Montaggio dalle 14',
  note_interne: 'SEGRETO-cliente-paga-tardi',
  importo_chf: 12000,
  acconto_pagato: true,
  saldo_pagato: false,
};

const writes = (calls) => calls.filter((c) => c.method !== 'GET');

describe('note degli eventi', () => {
  beforeEach(setEnv);

  test('tecnico, elenco: mai note_interne né importi, anche se Supabase li restituisse', async () => {
    const calls = mockFetch([staffRoute(PROFILES), ['GET', /^\/rest\/v1\/eventi_tecnico\?/, () => ({ body: [RIGA] })]]);
    const res = await eventi(req('/api/eventi', { cookie: TEC }));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('note_interne') && !text.includes('SEGRETO'), text);
    assert.ok(!text.includes('importo_chf'));
    const q = calls.find((c) => c.url.pathname === '/rest/v1/eventi_tecnico');
    assert.ok(!decodeURIComponent(q.url.search).includes('note_interne'));
  });

  test('tecnico, dettaglio: riceve note_squadra, mai note_interne; chiede colonne esplicite', async () => {
    const calls = mockFetch([
      staffRoute(PROFILES),
      ['GET', /^\/rest\/v1\/eventi_tecnico\?id=eq\./, () => ({ body: [RIGA] })],
      ['GET', /^\/rest\/v1\/(eventi_staff|checklist)\?/, () => ({ body: [] })],
    ]);
    const res = await eventi(req(`/api/eventi/${EV_ID}`, { cookie: TEC }));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('note_interne') && !text.includes('SEGRETO'), text);
    const data = JSON.parse(text);
    assert.equal(data.evento.note_squadra, 'Montaggio dalle 14');
    assert.ok(!('importo_chf' in data.evento));
    const q = calls.find((c) => c.url.pathname === '/rest/v1/eventi_tecnico');
    const select = q.url.searchParams.get('select').split(',');
    assert.ok(select.includes('note_squadra'));
    assert.ok(!select.includes('*') && !select.includes('note_interne'));
  });

  test('admin, dettaglio: riceve entrambe le note', async () => {
    mockFetch([
      staffRoute(PROFILES),
      ['GET', /^\/rest\/v1\/eventi\?id=eq\./, () => ({ body: [RIGA] })],
      ['GET', /^\/rest\/v1\/(eventi_staff|checklist)\?/, () => ({ body: [] })],
    ]);
    const res = await eventi(req(`/api/eventi/${EV_ID}`, { cookie: ADMIN }));
    assert.equal(res.status, 200);
    const { evento } = await res.json();
    assert.equal(evento.note_squadra, 'Montaggio dalle 14');
    assert.equal(evento.note_interne, 'SEGRETO-cliente-paga-tardi');
  });

  test('admin scrive entrambe le note (POST e PATCH), con limite di 10000 caratteri', async () => {
    const calls = mockFetch([
      staffRoute(PROFILES),
      ['POST', /^\/rest\/v1\/eventi\?/, (c) => ({ status: 201, body: [{ id: EV_ID, ...c.body }] })],
      ['PATCH', /^\/rest\/v1\/eventi\?id=eq\./, (c) => ({ body: [{ id: EV_ID, ...c.body }] })],
    ]);
    let res = await eventi(req('/api/eventi', { method: 'POST', cookie: ADMIN, body: { titolo: 'X', note_squadra: 'Riga 1\nRiga 2', note_interne: 'Solo admin' } }));
    assert.equal(res.status, 201);
    assert.equal(writes(calls)[0].body.note_squadra, 'Riga 1\nRiga 2');
    assert.equal(writes(calls)[0].body.note_interne, 'Solo admin');
    res = await eventi(req(`/api/eventi/${EV_ID}`, { method: 'PATCH', cookie: ADMIN, body: { note_squadra: 'Nuova' } }));
    assert.equal(res.status, 200);
    assert.deepEqual(writes(calls)[1].body, { note_squadra: 'Nuova' });
    for (const field of ['note_squadra', 'note_interne']) {
      res = await eventi(req(`/api/eventi/${EV_ID}`, { method: 'PATCH', cookie: ADMIN, body: { [field]: 'x'.repeat(10001) } }));
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: 'invalid_input', field });
      res = await eventi(req(`/api/eventi/${EV_ID}`, { method: 'PATCH', cookie: ADMIN, body: { [field]: 42 } }));
      assert.equal(res.status, 400);
    }
    assert.equal(writes(calls).length, 2);
  });

  test('il tecnico non può scrivere note (403, nessuna scrittura)', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    const res = await eventi(req(`/api/eventi/${EV_ID}`, { method: 'PATCH', cookie: TEC, body: { note_squadra: 'x' } }));
    assert.equal(res.status, 403);
    assert.equal(writes(calls).length, 0);
  });
});

describe('POST /api/richieste/pulizia', () => {
  beforeEach(setEnv);

  test('config: percorso proprio, escluso da richieste.js', () => {
    const ex = richiesteMod.config.excludedPath;
    assert.ok((Array.isArray(ex) ? ex : [ex]).includes('/api/richieste/pulizia'));
  });

  test('admin: chiama la funzione RPC e restituisce il numero di righe cancellate', async () => {
    const calls = mockFetch([staffRoute(PROFILES), ['POST', /^\/rest\/v1\/rpc\/pulisci_richieste_vecchie_admin$/, () => ({ body: 3 })]]);
    const res = await pulizia(req('/api/richieste/pulizia', { method: 'POST', cookie: ADMIN }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, cancellate: 3 });
    const w = writes(calls);
    assert.equal(w.length, 1);
    assert.deepEqual(w[0].body, {});
    assert.match(w[0].headers.get('authorization'), /^Bearer /);
    // mai la funzione del job (riservata al proprietario/pg_cron)
    assert.ok(!calls.some((c) => c.url.pathname.endsWith('/rpc/pulisci_richieste_vecchie')));
  });

  test('tecnico → 403, utente non loggato → 401, nessuna chiamata RPC', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    let res = await pulizia(req('/api/richieste/pulizia', { method: 'POST', cookie: TEC }));
    assert.equal(res.status, 403);
    res = await pulizia(req('/api/richieste/pulizia', { method: 'POST' }));
    assert.equal(res.status, 401);
    assert.equal(writes(calls).length, 0);
  });

  test('CSRF e metodo: Origin errato / X-Requested-With mancante → 403; GET → 405', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    let res = await pulizia(req('/api/richieste/pulizia', { method: 'POST', cookie: ADMIN, origin: 'https://evil.example' }));
    assert.equal(res.status, 403);
    res = await pulizia(req('/api/richieste/pulizia', { method: 'POST', cookie: ADMIN, xrw: false }));
    assert.equal(res.status, 403);
    res = await pulizia(req('/api/richieste/pulizia', { cookie: ADMIN }));
    assert.equal(res.status, 405);
    assert.equal(calls.length, 0);
  });

  test('errore del database → messaggio generico', async () => {
    mockFetch([
      staffRoute(PROFILES),
      ['POST', /^\/rest\/v1\/rpc\/pulisci_richieste_vecchie_admin$/, () => ({ status: 500, body: { code: 'XX000', message: 'postgres internal at line 1' } })],
    ]);
    const res = await pulizia(req('/api/richieste/pulizia', { method: 'POST', cookie: ADMIN }));
    assert.equal(res.status, 502);
    assertNoLeak(assert, await res.text());
  });
});

describe('migrazione 0004 (controlli statici)', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/0004_note_pulizia.sql', import.meta.url), 'utf8');
  const fn = (name) => {
    const m = new RegExp(`create (?:or replace )?function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`).exec(sql);
    assert.ok(m, name);
    return m[0];
  };

  test('eventi_assegnati restituisce note_squadra e non note_interne', () => {
    const f = fn('eventi_assegnati');
    assert.ok(f.includes('note_squadra'));
    assert.ok(!f.includes('note_interne'));
    assert.match(f, /security definer\s+set search_path = public/);
  });

  test('pulizia: definer con search_path, nessun EXECUTE per i ruoli API', () => {
    const f = fn('pulisci_richieste_vecchie');
    assert.match(f, /security definer\s+set search_path = public/);
    assert.match(f, /evento_id is null\s+and created_at < now\(\) - interval '24 months'/);
    assert.match(sql, /revoke all on function public\.pulisci_richieste_vecchie\(\) from public, anon, authenticated;/);
    assert.ok(!/grant execute on function public\.pulisci_richieste_vecchie\(\)/.test(sql));
    const a = fn('pulisci_richieste_vecchie_admin');
    assert.match(a, /security invoker/);
    assert.match(a, /if not public\.is_admin\(\)/);
    assert.match(sql, /cron\.schedule\(\s*'pulisci_richieste_vecchie'/);
  });
});
