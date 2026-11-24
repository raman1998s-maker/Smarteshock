import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { assertNoLeak, mockFetch, req, setEnv } from './_helpers.js';

setEnv();
const richiesta = (await import('../../netlify/functions/richiesta.js')).default;

const insertRoute = () => ['POST', /^\/rest\/v1\/richieste_web$/, () => ({ status: 201 })];
const VALIDA = { nome: 'Maria Muster', email: 'maria@example.ch', telefono: '+41 79 000 00 00', tipo: 'Hochzeit', data: '2026-08-15', localita: 'Zürich', ospiti: '120', servizi: ['Licht', 'Audio'], messaggio: 'Hallo', lingua: 'de' };

describe('POST /api/richiesta', () => {
  beforeEach(setEnv);

  test('JSON valido → {ok:true}, inserimento con la sola chiave anon (nessun JWT)', async () => {
    const calls = mockFetch([insertRoute()]);
    const res = await richiesta(req('/api/richiesta', { method: 'POST', body: VALIDA }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(calls.length, 1);
    const c = calls[0];
    assert.equal(c.headers.get('apikey'), 'test-anon-key-non-reale');
    assert.equal(c.headers.get('authorization'), null);
    assert.equal(c.headers.get('prefer'), 'return=minimal');
    assert.equal(c.body.ospiti, 120);
    assert.equal(c.body.stato, undefined);
    assert.deepEqual(c.body.servizi, ['Licht', 'Audio']);
  });

  test('honeypot compilato → risposta ok ma nessun inserimento', async () => {
    const calls = mockFetch([insertRoute()]);
    const res = await richiesta(req('/api/richiesta', { method: 'POST', body: { ...VALIDA, 'bot-field': 'http://spam' } }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(calls.length, 0);

    const form = new URLSearchParams({ 'form-name': 'preventivo', lingua: 'fr', 'bot-field': 'spam', nome: 'x', email: 'x@y.ch' });
    const res2 = await richiesta(req('/api/richiesta', { method: 'POST', body: form.toString(), xrw: false, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
    assert.equal(res2.status, 303);
    assert.equal(res2.headers.get('location'), '/fr/grazie.html');
    assert.equal(calls.length, 0);
  });

  test('form classico (senza JS) → 303 verso la pagina di ringraziamento della lingua', async () => {
    const calls = mockFetch([insertRoute()]);
    const form = new URLSearchParams([
      ['form-name', 'preventivo'], ['lingua', 'de'], ['bot-field', ''], ['nome', 'Hans'], ['telefono', ''], ['email', 'hans@example.ch'],
      ['tipo', 'Hochzeit'], ['data', ''], ['localita', 'Bern'], ['ospiti', ''], ['servizi', 'Licht'], ['servizi', 'Audio'], ['messaggio', 'Grüezi\nmiteinander'],
    ]);
    const res = await richiesta(req('/api/richiesta', { method: 'POST', body: form.toString(), xrw: false, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/de/grazie.html');
    assert.deepEqual(calls[0].body.servizi, ['Licht', 'Audio']);
    assert.equal(calls[0].body.data, null);
    assert.equal(calls[0].body.ospiti, null);

    const it = new URLSearchParams({ lingua: 'it', nome: 'Mario', email: 'mario@example.ch' });
    const res2 = await richiesta(req('/api/richiesta', { method: 'POST', body: it.toString(), xrw: false, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
    assert.equal(res2.headers.get('location'), '/grazie.html');
  });

  test('multipart (FormData via fetch con X-Requested-With) → JSON', async () => {
    const calls = mockFetch([insertRoute()]);
    const fd = new FormData();
    fd.append('nome', 'Jean');
    fd.append('email', 'jean@example.fr');
    fd.append('lingua', 'fr');
    fd.append('servizi', 'Lumières');
    const res = await richiesta(new Request('https://meekondisplay.ch/api/richiesta', { method: 'POST', body: fd, headers: { Origin: 'https://meekondisplay.ch', 'X-Requested-With': 'meekon' } }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(calls[0].body.servizi[0], 'Lumières');
  });

  test('validazione: e-mail errata, campi troppo lunghi, enum lingua, data non valida, troppi servizi', async () => {
    const calls = mockFetch([insertRoute()]);
    const casi = [
      [{ ...VALIDA, email: 'non-valida' }, 'email'],
      [{ ...VALIDA, email: undefined }, 'email'],
      [{ ...VALIDA, nome: 'x'.repeat(121) }, 'nome'],
      [{ ...VALIDA, nome: '' }, 'nome'],
      [{ ...VALIDA, messaggio: 'x'.repeat(4001) }, 'messaggio'],
      [{ ...VALIDA, lingua: 'es' }, 'lingua'],
      [{ ...VALIDA, data: '15.08.2026' }, 'data'],
      [{ ...VALIDA, ospiti: '0' }, 'ospiti'],
      [{ ...VALIDA, telefono: '<script>' }, 'telefono'],
      [{ ...VALIDA, servizi: Array(16).fill(0).map((_, i) => `s${i}`) }, 'servizi'],
      [{ ...VALIDA, tipo: 'x'.repeat(81) }, 'tipo'],
    ];
    for (const [body, field] of casi) {
      const res = await richiesta(req('/api/richiesta', { method: 'POST', body: JSON.parse(JSON.stringify(body)) }));
      assert.equal(res.status, 400, field);
      assert.deepEqual(await res.json(), { error: 'invalid_input', field });
    }
    assert.equal(calls.length, 0);
  });

  test('form classico non valido → pagina HTML 400 nella lingua giusta', async () => {
    mockFetch([insertRoute()]);
    const form = new URLSearchParams({ lingua: 'en', nome: 'Bob', email: 'bob' });
    const res = await richiesta(req('/api/richiesta', { method: 'POST', body: form.toString(), xrw: false, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
    assert.equal(res.status, 400);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.ok(html.includes('Request not sent') && html.includes('/en/#contatti'));
    assert.ok(!html.includes('<script'));
  });

  test('corpo troppo grande → 413; content-type non supportato → 415', async () => {
    const calls = mockFetch([insertRoute()]);
    let res = await richiesta(req('/api/richiesta', { method: 'POST', body: { ...VALIDA, messaggio: 'x'.repeat(30000) } }));
    assert.equal(res.status, 413);
    res = await richiesta(req('/api/richiesta', { method: 'POST', body: 'ciao', headers: { 'Content-Type': 'text/plain' } }));
    assert.equal(res.status, 415);
    assert.equal(calls.length, 0);
  });

  test('Origin mancante o diverso → 403', async () => {
    const calls = mockFetch([insertRoute()]);
    for (const origin of [null, 'https://evil.example']) {
      const res = await richiesta(req('/api/richiesta', { method: 'POST', body: VALIDA, origin }));
      assert.equal(res.status, 403);
    }
    assert.equal(calls.length, 0);
  });

  test('errore del database → generico, nessun dettaglio', async () => {
    mockFetch([['POST', /^\/rest\/v1\/richieste_web$/, () => ({ status: 401, body: { code: '42501', message: 'new row violates row-level security policy for table "richieste_web"' } })]]);
    const res = await richiesta(req('/api/richiesta', { method: 'POST', body: VALIDA }));
    assert.ok(res.status >= 400);
    assertNoLeak(assert, await res.text());
  });

  test('GET non consentito → 405', async () => {
    mockFetch([]);
    const res = await richiesta(req('/api/richiesta'));
    assert.equal(res.status, 405);
  });
});
