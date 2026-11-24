import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { ADMIN_ID, PROFILES, SB, TEC_ID, assertNoLeak, cookieFor, fakeJwt, mockFetch, req, setCookies, setEnv, staffRoute } from './_helpers.js';

setEnv();
const login = (await import('../../netlify/functions/auth-login.js')).default;
const logout = (await import('../../netlify/functions/auth-logout.js')).default;
const me = (await import('../../netlify/functions/me.js')).default;

function tokenRoute({ ok = true, id = ADMIN_ID } = {}) {
  return [
    'POST',
    /^\/auth\/v1\/token\?grant_type=password$/,
    (call) =>
      ok && call.body.password === 'giusta'
        ? { body: { access_token: fakeJwt(id), refresh_token: 'rt-nuovo', expires_in: 3600, user: { id } } }
        : { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid login credentials' } },
  ];
}

describe('login', () => {
  beforeEach(setEnv);

  test('imposta i cookie HttpOnly; Secure; SameSite=Strict; Path=/api', async () => {
    const calls = mockFetch([tokenRoute(), staffRoute(PROFILES)]);
    const res = await login(req('/api/auth/login', { method: 'POST', body: { email: 'Admin@Meekon.ch', password: 'giusta' } }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: ADMIN_ID, nome: 'Admin', ruolo: 'admin' });
    const cookies = setCookies(res);
    assert.equal(cookies.length, 2);
    for (const name of ['mk_at', 'mk_rt']) {
      const c = cookies.find((x) => x.startsWith(`${name}=`));
      assert.ok(c, `manca il cookie ${name}`);
      for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api']) assert.ok(c.includes(attr), `${name} senza ${attr}`);
    }
    assert.equal(res.headers.get('cache-control'), 'no-store');
    // La chiave anon va solo nell'header apikey verso Supabase
    assert.equal(calls[0].headers.get('apikey'), 'test-anon-key-non-reale');
    assert.equal(calls[0].body.email, 'admin@meekon.ch');
    assert.ok(calls[0].url.href.startsWith(SB));
  });

  test('credenziali errate → 401 generico, nessun cookie', async () => {
    mockFetch([tokenRoute(), staffRoute(PROFILES)]);
    const res = await login(req('/api/auth/login', { method: 'POST', body: { email: 'a@b.ch', password: 'sbagliata' } }));
    assert.equal(res.status, 401);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: 'invalid_credentials' });
    assertNoLeak(assert, text);
    assert.equal(setCookies(res).length, 0);
  });

  test('utente Auth senza riga staff → 403 e sessione revocata', async () => {
    const calls = mockFetch([
      tokenRoute({ id: '00000000-0000-4000-8000-0000000000ff' }),
      staffRoute(PROFILES),
      ['POST', /^\/auth\/v1\/logout/, () => ({ status: 204 })],
    ]);
    const res = await login(req('/api/auth/login', { method: 'POST', body: { email: 'x@y.ch', password: 'giusta' } }));
    assert.equal(res.status, 403);
    assert.ok(calls.some((c) => c.url.pathname === '/auth/v1/logout'));
    assert.ok(setCookies(res).every((c) => c.includes('Max-Age=0')));
  });

  test('Origin errato o X-Requested-With mancante → 403 senza chiamare Supabase', async () => {
    const calls = mockFetch([tokenRoute(), staffRoute(PROFILES)]);
    const body = { email: 'a@b.ch', password: 'giusta' };
    for (const opts of [{ origin: 'https://evil.example' }, { origin: null }, { xrw: false }]) {
      const res = await login(req('/api/auth/login', { method: 'POST', body, ...opts }));
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: 'forbidden_origin' });
    }
    assert.equal(calls.length, 0);
  });

  test('input non valido → 400 (e-mail errata, password troppo lunga, JSON rotto, content-type errato)', async () => {
    const calls = mockFetch([tokenRoute(), staffRoute(PROFILES)]);
    let res = await login(req('/api/auth/login', { method: 'POST', body: { email: 'non-una-email', password: 'x' } }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'invalid_input', field: 'email' });
    res = await login(req('/api/auth/login', { method: 'POST', body: { email: 'a@b.ch', password: 'x'.repeat(300) } }));
    assert.equal(res.status, 400);
    res = await login(req('/api/auth/login', { method: 'POST', body: '{rotto', headers: { 'Content-Type': 'application/json' } }));
    assert.equal(res.status, 400);
    res = await login(req('/api/auth/login', { method: 'POST', body: 'email=a', headers: { 'Content-Type': 'text/plain' } }));
    assert.equal(res.status, 415);
    res = await login(req('/api/auth/login', { method: 'POST', body: { email: 'a@b.ch', password: 'x'.repeat(5000) } }));
    assert.equal(res.status, 413);
    assert.equal(calls.length, 0);
  });

  test('GET su /api/auth/login → 405', async () => {
    mockFetch([]);
    const res = await login(req('/api/auth/login'));
    assert.equal(res.status, 405);
  });
});

describe('sessione e /api/me', () => {
  beforeEach(setEnv);

  test('senza cookie → 401', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    const res = await me(req('/api/me'));
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
    assert.equal(calls.length, 0);
  });

  test('cookie valido → profilo', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    const res = await me(req('/api/me', { cookie: cookieFor(TEC_ID) }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: TEC_ID, nome: 'Tecnico', ruolo: 'tecnico' });
    assert.match(calls[0].headers.get('authorization'), /^Bearer /);
    assert.equal(setCookies(res).length, 0);
  });

  test('cookie non valido (spazzatura) e refresh rifiutato → 401 e cookie cancellati', async () => {
    mockFetch([staffRoute(PROFILES), ['POST', /grant_type=refresh_token/, () => ({ status: 400, body: { error: 'invalid_grant' } })]]);
    const res = await me(req('/api/me', { cookie: 'mk_at=spazzatura; mk_rt=rt-falso' }));
    assert.equal(res.status, 401);
    const text = await res.text();
    assertNoLeak(assert, text);
    assert.ok(setCookies(res).length === 2 && setCookies(res).every((c) => c.includes('Max-Age=0')));
  });

  test('JWT con firma non valida (rifiutato da Supabase) e senza refresh token → 401', async () => {
    mockFetch([['GET', /^\/rest\/v1\/staff/, () => ({ status: 401, body: { code: 'PGRST301', message: 'JWSError' } })]]);
    const res = await me(req('/api/me', { cookie: `mk_at=${fakeJwt(ADMIN_ID)}` }));
    assert.equal(res.status, 401);
    assertNoLeak(assert, await res.text());
  });

  test('access token scaduto → refresh automatico, nuovi cookie, richiesta servita', async () => {
    const nuovo = fakeJwt(ADMIN_ID);
    const calls = mockFetch([
      staffRoute(PROFILES),
      [
        'POST',
        /grant_type=refresh_token/,
        (call) =>
          call.body.refresh_token === 'rt-valido'
            ? { body: { access_token: nuovo, refresh_token: 'rt-ruotato', expires_in: 3600, user: { id: ADMIN_ID } } }
            : { status: 400, body: {} },
      ],
    ]);
    const res = await me(req('/api/me', { cookie: cookieFor(ADMIN_ID, { exp: -60 }) }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ruolo, 'admin');
    const cookies = setCookies(res);
    assert.ok(cookies.find((c) => c.startsWith(`mk_at=${nuovo}`) && c.includes('HttpOnly')));
    assert.ok(cookies.find((c) => c.startsWith('mk_rt=rt-ruotato')));
    // la chiamata al DB usa il token nuovo
    const staffCall = calls.find((c) => c.url.pathname === '/rest/v1/staff');
    assert.equal(staffCall.headers.get('authorization'), `Bearer ${nuovo}`);
  });

  test('token non scaduto ma rifiutato da Supabase → refresh e nuovo tentativo', async () => {
    const vecchio = fakeJwt(ADMIN_ID).replace('firma-finta', 'scaduto');
    const nuovo = fakeJwt(ADMIN_ID);
    mockFetch([
      staffRoute(PROFILES),
      ['POST', /grant_type=refresh_token/, () => ({ body: { access_token: nuovo, refresh_token: 'rt2', expires_in: 3600 } })],
    ]);
    const res = await me(req('/api/me', { cookie: `mk_at=${vecchio}; mk_rt=rt-valido` }));
    assert.equal(res.status, 200);
    assert.equal(setCookies(res).length, 2);
  });

  test('dipendente disattivato → 403', async () => {
    mockFetch([staffRoute({ [TEC_ID]: { ...PROFILES[TEC_ID], attivo: false } })]);
    const res = await me(req('/api/me', { cookie: cookieFor(TEC_ID) }));
    assert.equal(res.status, 403);
  });
});

describe('logout', () => {
  beforeEach(setEnv);

  test('revoca la sessione e cancella i cookie', async () => {
    const calls = mockFetch([['POST', /^\/auth\/v1\/logout/, () => ({ status: 204 })]]);
    const res = await logout(req('/api/auth/logout', { method: 'POST', cookie: cookieFor(ADMIN_ID) }));
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    const cookies = setCookies(res);
    assert.equal(cookies.length, 2);
    assert.ok(cookies.every((c) => c.includes('Max-Age=0') && c.includes('HttpOnly') && c.includes('SameSite=Strict')));
  });

  test('logout senza X-Requested-With → 403', async () => {
    mockFetch([]);
    const res = await logout(req('/api/auth/logout', { method: 'POST', cookie: cookieFor(ADMIN_ID), xrw: false }));
    assert.equal(res.status, 403);
  });
});

describe('configurazione', () => {
  test('variabile mancante → 500 generico, nessun valore nel corpo', async () => {
    setEnv();
    delete process.env.SUPABASE_ANON_KEY;
    const orig = console.error;
    const logs = [];
    console.error = (...a) => logs.push(a.join(' '));
    try {
      mockFetch([]);
      const res = await me(req('/api/me', { cookie: cookieFor(ADMIN_ID) }));
      assert.equal(res.status, 500);
      const text = await res.text();
      assert.deepEqual(JSON.parse(text), { error: 'server_misconfigured' });
      assert.ok(logs.some((l) => l.includes('SUPABASE_ANON_KEY')));
    } finally {
      console.error = orig;
      setEnv();
    }
  });
});
