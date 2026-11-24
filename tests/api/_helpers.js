// Utilità per i test: ambiente finto, JWT finti, fetch simulato (nessuna rete).

export const ORIGIN = 'https://meekondisplay.ch';
export const SB = 'https://progetto-test.supabase.co';
export const ADMIN_ID = '00000000-0000-4000-8000-00000000000a';
export const TEC_ID = '00000000-0000-4000-8000-00000000000b';
export const EV_ID = '20000000-0000-4000-8000-000000000001';

export function setEnv() {
  process.env.SUPABASE_URL = SB;
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-non-reale';
  process.env.ALLOWED_ORIGIN = ORIGIN;
}

export function fakeJwt(sub, expInSeconds = 3600) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + expInSeconds, role: 'authenticated' })}.firma-finta`;
}

/**
 * Sostituisce globalThis.fetch. `routes` è una lista di [metodo, regex sul path+query, handler(call) => {status, body}].
 * Restituisce l'elenco delle chiamate effettuate.
 */
export function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || {});
    const body = init.body ? JSON.parse(init.body) : undefined;
    const call = { method, url, path: url.pathname + url.search, headers, body };
    calls.push(call);
    for (const [m, re, fn] of routes) {
      if (m === method && re.test(decodeURIComponent(call.path))) {
        const { status = 200, body: resBody = null } = (await fn(call)) || {};
        return new Response(resBody === null ? null : JSON.stringify(resBody), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ message: 'route non simulata' }), { status: 500 });
  };
  return calls;
}

/** Route Supabase standard per il profilo staff. */
export function staffRoute(profiles) {
  return [
    'GET',
    /^\/rest\/v1\/staff\?id=eq\./,
    (call) => {
      const auth = call.headers.get('authorization') || '';
      if (!auth.startsWith('Bearer ') || auth.includes('scaduto')) return { status: 401, body: { code: 'PGRST301', message: 'JWT expired' } };
      const id = /id=eq\.([0-9a-f-]+)/.exec(call.path)[1];
      const p = profiles[id];
      return { status: 200, body: p ? [p] : [] };
    },
  ];
}

export const PROFILES = {
  [ADMIN_ID]: { id: ADMIN_ID, nome: 'Admin', ruolo: 'admin', attivo: true },
  [TEC_ID]: { id: TEC_ID, nome: 'Tecnico', ruolo: 'tecnico', attivo: true },
};

export function cookieFor(id, { exp = 3600, rt = 'rt-valido' } = {}) {
  return `mk_at=${fakeJwt(id, exp)}; mk_rt=${rt}`;
}

export function req(path, { method = 'GET', headers = {}, body, origin = ORIGIN, xrw = true, cookie } = {}) {
  const h = new Headers(headers);
  if (method !== 'GET') {
    if (origin) h.set('Origin', origin);
    if (xrw) h.set('X-Requested-With', 'meekon');
  }
  if (cookie) h.set('Cookie', cookie);
  let payload = body;
  if (body !== undefined && typeof body !== 'string') {
    payload = JSON.stringify(body);
    if (!h.has('Content-Type')) h.set('Content-Type', 'application/json');
  }
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: payload });
}

export function setCookies(res) {
  return res.headers.getSetCookie();
}

/** Verifica che il corpo non contenga dettagli interni. */
export function assertNoLeak(assert, text) {
  for (const bad of ['stack', 'at ', 'PGRST', 'postgres', 'supabase.co', 'test-anon-key', 'Bearer', 'JWT', 'violates', 'route non simulata']) {
    assert.ok(!text.includes(bad), `la risposta contiene "${bad}": ${text}`);
  }
}
