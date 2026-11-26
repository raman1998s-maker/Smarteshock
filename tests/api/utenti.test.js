// Invito di persone nuove (solo admin) e scelta della password dal link.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ADMIN_ID, ORIGIN, PROFILES, TEC_ID, cookieFor, fakeJwt, mockFetch, req, setEnv, staffRoute } from './_helpers.js';

setEnv();
const invito = (await import('../../netlify/functions/utenti-invito.js')).default;
const password = (await import('../../netlify/functions/auth-password.js')).default;

const ADMIN = cookieFor(ADMIN_ID);
const TEC = cookieFor(TEC_ID);
const DATI = { nome: 'Anna Muster', email: 'Anna@Example.ch', ruolo: 'tecnico', lingua: 'de' };

describe('invito utenti', () => {
  test('solo l\'admin: il tecnico riceve 403 e la funzione non viene chiamata', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    const res = await invito(req('/api/utenti-invito', { method: 'POST', cookie: TEC, body: DATI }));
    assert.equal(res.status, 403);
    assert.ok(!calls.some((c) => c.path.startsWith('/functions/')));
  });

  test('passa il token dell\'admin alla Edge Function, con e-mail minuscola e pagina della password dello stesso sito', async () => {
    const calls = mockFetch([staffRoute(PROFILES), ['POST', /^\/functions\/v1\/invita-utente$/, () => ({ status: 201, body: { id: 'u1', link: 'https://x.supabase.co/auth/v1/verify?token=abc' } })]]);
    const res = await invito(req('/api/utenti-invito', { method: 'POST', cookie: ADMIN, body: DATI }));
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { id: 'u1', link: 'https://x.supabase.co/auth/v1/verify?token=abc' });
    const c = calls.find((x) => x.path === '/functions/v1/invita-utente');
    assert.match(c.headers.get('authorization'), /^Bearer /);
    assert.deepEqual(c.body, { nome: 'Anna Muster', email: 'anna@example.ch', ruolo: 'tecnico', lingua: 'de', redirect_to: `${ORIGIN}/area-riservata/password.html` });
  });

  test('dati non validi → 400; e-mail già usata → 409', async () => {
    mockFetch([staffRoute(PROFILES), ['POST', /^\/functions\/v1\/invita-utente$/, () => ({ status: 409, body: { error: 'conflict' } })]]);
    assert.equal((await invito(req('/api/utenti-invito', { method: 'POST', cookie: ADMIN, body: { ...DATI, ruolo: 'capo' } }))).status, 400);
    assert.equal((await invito(req('/api/utenti-invito', { method: 'POST', cookie: ADMIN, body: { ...DATI, email: 'no' } }))).status, 400);
    assert.equal((await invito(req('/api/utenti-invito', { method: 'POST', cookie: ADMIN, body: DATI }))).status, 409);
  });
});

describe('scelta della password', () => {
  test('token valido: la password viene impostata con il token del link', async () => {
    const tok = fakeJwt('nuovo');
    const calls = mockFetch([['PUT', /^\/auth\/v1\/user$/, () => ({ status: 200, body: { id: 'nuovo' } })], ['POST', /^\/auth\/v1\/logout/, () => ({ status: 204 })]]);
    const res = await password(req('/api/auth/password', { method: 'POST', body: { access_token: tok, password: 'una-password-lunga' } }));
    assert.equal(res.status, 200);
    const put = calls.find((c) => c.method === 'PUT');
    assert.equal(put.headers.get('authorization'), `Bearer ${tok}`);
    assert.deepEqual(put.body, { password: 'una-password-lunga' });
  });

  test('password corta o token strano → 400; link scaduto → 401', async () => {
    mockFetch([['PUT', /^\/auth\/v1\/user$/, () => ({ status: 401, body: {} })]]);
    assert.equal((await password(req('/api/auth/password', { method: 'POST', body: { access_token: fakeJwt('x'), password: 'corta' } }))).status, 400);
    assert.equal((await password(req('/api/auth/password', { method: 'POST', body: { access_token: 'non-un-token', password: 'una-password-lunga' } }))).status, 400);
    assert.equal((await password(req('/api/auth/password', { method: 'POST', body: { access_token: fakeJwt('x'), password: 'una-password-lunga' } }))).status, 401);
  });
});
