import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { ADMIN_ID, PROFILES, SB, TEC_ID, assertNoLeak, cookieFor, mockFetch, req, setEnv, staffRoute } from './_helpers.js';

setEnv();
const contenuti = (await import('../../netlify/functions/contenuti.js')).default;
const testi = (await import('../../netlify/functions/testi.js')).default;
const media = (await import('../../netlify/functions/media.js')).default;
const pubblica = (await import('../../netlify/functions/pubblica.js')).default;

const ADMIN = cookieFor(ADMIN_ID);
const TEC = cookieFor(TEC_ID);
const ID = '30000000-0000-4000-8000-000000000001';
const ID2 = '30000000-0000-4000-8000-000000000002';
const FOTO = 'galleria/40000000-0000-4000-8000-000000000001.jpg';
const VIDEO = 'galleria/40000000-0000-4000-8000-000000000002.mp4';
const HOOK = 'https://api.netlify.com/build_hooks/abcdef0123456789abcdef01';

function writes(calls) {
  return calls.filter((c) => c.method !== 'GET' && c.url.origin === SB);
}

function upstream(calls) {
  return calls.filter((c) => !c.url.pathname.startsWith('/rest/v1/staff'));
}

const fotoValida = {
  file_path: FOTO,
  tipo: 'foto',
  categoria: 'feste',
  formato: 'wide',
  alt_it: 'Luci sulla pista',
  pubblicato: true,
};

beforeEach(() => {
  setEnv();
  process.env.NETLIFY_BUILD_HOOK = HOOK;
});

// ---------------------------------------------------------------- ruoli e CSRF

describe('CMS — ruolo tecnico: 403 ovunque, nessuna chiamata a Supabase oltre al profilo', () => {
  test('contenuti, ordine, testi, media, pubblica', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    const casi = [
      [contenuti, '/api/contenuti/galleria', 'GET'],
      [contenuti, '/api/contenuti/dj', 'POST', { nome: 'X' }],
      [contenuti, `/api/contenuti/sale/${ID}`, 'PATCH', { nome: 'X' }],
      [contenuti, `/api/contenuti/partner/${ID}`, 'DELETE'],
      [contenuti, '/api/contenuti/ordine/galleria', 'PUT', { ids: [ID] }],
      [testi, '/api/testi', 'GET'],
      [testi, '/api/testi/hero.title', 'PUT', { it: 'Ciao' }],
      [media, '/api/media/upload-url', 'POST', { nome_file: 'a.jpg', tipo_mime: 'image/jpeg', dimensione: 10 }],
      [media, `/api/media/anteprima/${FOTO}`, 'GET'],
      [pubblica, '/api/pubblica', 'POST'],
      [pubblica, '/api/pubblicazioni', 'GET'],
    ];
    for (const [fn, path, method, body] of casi) {
      const res = await fn(req(path, { method, cookie: TEC, body }));
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.deepEqual(await res.json(), { error: 'forbidden' });
    }
    assert.equal(upstream(calls).length, 0);
  });

  test('senza cookie → 401', async () => {
    mockFetch([staffRoute(PROFILES)]);
    const res = await contenuti(req('/api/contenuti/galleria'));
    assert.equal(res.status, 401);
  });
});

describe('CMS — CSRF', () => {
  const scritture = [
    [contenuti, '/api/contenuti/galleria', 'POST', fotoValida],
    [contenuti, '/api/contenuti/ordine/sale', 'PUT', { ids: [ID] }],
    [testi, '/api/testi/hero.title', 'PUT', { it: 'Ciao' }],
    [media, '/api/media/upload-url', 'POST', { nome_file: 'a.jpg', tipo_mime: 'image/jpeg', dimensione: 10 }],
    [pubblica, '/api/pubblica', 'POST'],
  ];

  test('Origin diverso → 403 forbidden_origin', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    for (const [fn, path, method, body] of scritture) {
      const res = await fn(req(path, { method, cookie: ADMIN, body, origin: 'https://evil.example' }));
      assert.equal(res.status, 403, path);
      assert.deepEqual(await res.json(), { error: 'forbidden_origin' });
    }
    assert.equal(calls.length, 0);
  });

  test('senza X-Requested-With → 403', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    for (const [fn, path, method, body] of scritture) {
      const res = await fn(req(path, { method, cookie: ADMIN, body, xrw: false }));
      assert.equal(res.status, 403, path);
    }
    assert.equal(calls.length, 0);
  });
});

// ---------------------------------------------------------------- contenuti

describe('contenuti — admin', () => {
  test('GET elenco ordinato della sezione galleria (tabella media_galleria)', async () => {
    const calls = mockFetch([staffRoute(PROFILES), ['GET', /^\/rest\/v1\/media_galleria\?/, () => ({ body: [{ id: ID }] })]]);
    const res = await contenuti(req('/api/contenuti/galleria', { cookie: ADMIN }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { voci: [{ id: ID }] });
    const q = calls.find((c) => c.url.pathname === '/rest/v1/media_galleria');
    assert.match(q.url.searchParams.get('order'), /^ordine\.asc/);
    assert.equal(q.headers.get('authorization')?.startsWith('Bearer '), true);
  });

  test('sezione sconosciuta → 404', async () => {
    mockFetch([staffRoute(PROFILES)]);
    for (const p of ['/api/contenuti/staff', '/api/contenuti/eventi', '/api/contenuti/ordine']) {
      const res = await contenuti(req(p, { cookie: ADMIN }));
      assert.equal(res.status, 404, p);
    }
  });

  test('POST galleria valida → 201, updated_by non accettato dal client', async () => {
    const calls = mockFetch([
      staffRoute(PROFILES),
      ['POST', /^\/rest\/v1\/media_galleria\?/, (c) => ({ status: 201, body: [{ id: ID, ...c.body }] })],
    ]);
    const res = await contenuti(req('/api/contenuti/galleria', { method: 'POST', cookie: ADMIN, body: fotoValida }));
    assert.equal(res.status, 201);
    const w = writes(calls)[0];
    assert.equal(w.body.file_path, FOTO);
    assert.equal(w.body.ordine, 0);

    const res2 = await contenuti(req('/api/contenuti/galleria', { method: 'POST', cookie: ADMIN, body: { ...fotoValida, updated_by: ADMIN_ID } }));
    assert.equal(res2.status, 400);
    assert.deepEqual(await res2.json(), { error: 'invalid_input', field: 'updated_by' });
  });

  test('validazione: link non https, percorsi fuori dal bucket, enum, tipo/file incoerenti', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    const casi = [
      ['dj', { nome: 'DJ', link: 'http://example.com' }, 'link'],
      ['dj', { nome: 'DJ', link: 'javascript:alert(1)' }, 'link'],
      ['dj', { nome: 'DJ', link: 'https://user:pw@example.com/' }, 'link'],
      ['dj', { nome: 'DJ', link: 'https://example.com/"><script>' }, 'link'],
      ['partner', { nome: 'P', link: '//example.com' }, 'link'],
      ['dj', { nome: 'DJ', foto_path: '../segreti.jpg' }, 'foto_path'],
      ['dj', { nome: 'DJ', foto_path: 'assets/img/logo.png' }, 'foto_path'],
      ['partner', { nome: 'P', logo_path: VIDEO }, 'logo_path'],
      ['galleria', { ...fotoValida, file_path: 'altro-bucket/x.jpg' }, 'file_path'],
      ['galleria', { ...fotoValida, categoria: 'concerti' }, 'categoria'],
      ['galleria', { ...fotoValida, formato: 'quadrato' }, 'formato'],
      ['galleria', { ...fotoValida, file_path: VIDEO }, 'file_path'],
      ['galleria', { ...fotoValida, tipo: 'video' }, 'file_path'],
      ['galleria', { ...fotoValida, poster_path: FOTO }, 'poster_path'],
      ['galleria', { ...fotoValida, alt_it: 'x'.repeat(301) }, 'alt_it'],
      ['sale', { nome: 'Sala', paese: 'US' }, 'paese'],
      ['sale', { nome: 'x'.repeat(161) }, 'nome'],
      ['sale', { nome: 'Sala', pubblicato: 'si' }, 'pubblicato'],
      ['sale', { nome: 'Sala', ordine: -1 }, 'ordine'],
    ];
    for (const [sez, body, field] of casi) {
      const res = await contenuti(req(`/api/contenuti/${sez}`, { method: 'POST', cookie: ADMIN, body }));
      assert.equal(res.status, 400, `${sez} ${JSON.stringify(body)}`);
      assert.deepEqual(await res.json(), { error: 'invalid_input', field }, `${sez} ${JSON.stringify(body)}`);
    }
    assert.equal(writes(calls).length, 0);
  });

  test('link https valido accettato', async () => {
    const calls = mockFetch([staffRoute(PROFILES), ['POST', /^\/rest\/v1\/dj\?/, (c) => ({ status: 201, body: [c.body] })]]);
    const res = await contenuti(req('/api/contenuti/dj', { method: 'POST', cookie: ADMIN, body: { nome: 'DJ', link: 'https://www.instagram.com/dj/' } }));
    assert.equal(res.status, 201);
    assert.equal(writes(calls)[0].body.link, 'https://www.instagram.com/dj/');
  });

  test('PATCH e DELETE: id non UUID → 404; riga inesistente → 404', async () => {
    mockFetch([
      staffRoute(PROFILES),
      ['PATCH', /^\/rest\/v1\/sale\?id=eq\./, () => ({ body: [] })],
      ['DELETE', /^\/rest\/v1\/sale\?id=eq\./, () => ({ body: [] })],
    ]);
    let res = await contenuti(req('/api/contenuti/sale/1', { method: 'PATCH', cookie: ADMIN, body: { nome: 'X' } }));
    assert.equal(res.status, 404);
    res = await contenuti(req(`/api/contenuti/sale/${ID}`, { method: 'PATCH', cookie: ADMIN, body: { nome: 'X' } }));
    assert.equal(res.status, 404);
    res = await contenuti(req(`/api/contenuti/sale/${ID}`, { method: 'DELETE', cookie: ADMIN }));
    assert.equal(res.status, 404);
  });

  test('PUT ordine: chiama cms_riordina con gli id; input non validi → 400', async () => {
    const calls = mockFetch([staffRoute(PROFILES), ['POST', /^\/rest\/v1\/rpc\/cms_riordina$/, () => ({ body: 2 })]]);
    let res = await contenuti(req('/api/contenuti/ordine/dj', { method: 'PUT', cookie: ADMIN, body: { ids: [ID2, ID] } }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, aggiornate: 2 });
    assert.deepEqual(writes(calls)[0].body, { p_sezione: 'dj', p_ids: [ID2, ID] });

    for (const body of [{ ids: 'x' }, { ids: ['non-uuid'] }, { ids: [ID, ID] }, { ids: [ID], altro: 1 }]) {
      res = await contenuti(req('/api/contenuti/ordine/dj', { method: 'PUT', cookie: ADMIN, body }));
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    res = await contenuti(req('/api/contenuti/ordine/eventi', { method: 'PUT', cookie: ADMIN, body: { ids: [ID] } }));
    assert.equal(res.status, 404);
    assert.equal(writes(calls).length, 1);
  });

  test('errore del DB → messaggio generico, nessun dettaglio interno', async () => {
    mockFetch([
      staffRoute(PROFILES),
      ['POST', /^\/rest\/v1\/sale\?/, () => ({ status: 400, body: { code: '23514', message: 'new row violates check constraint "sale_nome_check"' } })],
      ['GET', /^\/rest\/v1\/dj\?/, () => ({ status: 500, body: { message: 'postgres exploded at line 3', hint: 'supabase.co' } })],
    ]);
    let res = await contenuti(req('/api/contenuti/sale', { method: 'POST', cookie: ADMIN, body: { nome: 'Sala' } }));
    assert.equal(res.status, 400);
    assertNoLeak(assert, await res.text());
    res = await contenuti(req('/api/contenuti/dj', { cookie: ADMIN }));
    assert.equal(res.status, 502);
    assertNoLeak(assert, await res.text());
  });
});

// ---------------------------------------------------------------- testi

describe('testi — admin', () => {
  test('GET restituisce righe e chiavi modificabili (senza privacy e contatti)', async () => {
    mockFetch([staffRoute(PROFILES), ['GET', /^\/rest\/v1\/testi\?/, () => ({ body: [{ chiave: 'hero.title', it: 'X' }] })]]);
    const res = await testi(req('/api/testi', { cookie: ADMIN }));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.testi.length, 1);
    assert.ok(data.chiavi.includes('hero.title'));
    assert.ok(!data.chiavi.some((k) => k.startsWith('privacy')));
    assert.ok(!data.chiavi.includes('form.note'));
  });

  test('PUT valido → upsert su testi con on_conflict=chiave', async () => {
    const calls = mockFetch([staffRoute(PROFILES), ['POST', /^\/rest\/v1\/testi\?on_conflict=chiave/, (c) => ({ status: 201, body: [c.body] })]]);
    const res = await testi(req('/api/testi/hero.title', { method: 'PUT', cookie: ADMIN, body: { it: 'Titolo', de: 'Titel', fr: '', en: null } }));
    assert.equal(res.status, 200);
    const w = writes(calls)[0];
    assert.deepEqual(w.body, { chiave: 'hero.title', it: 'Titolo', de: 'Titel', fr: null, en: null });
    assert.match(w.headers.get('prefer'), /merge-duplicates/);
  });

  test('PUT con tutte le lingue vuote → elimina la riga', async () => {
    const calls = mockFetch([staffRoute(PROFILES), ['DELETE', /^\/rest\/v1\/testi\?chiave=eq\.hero\.title$/, () => ({ status: 204 })]]);
    const res = await testi(req('/api/testi/hero.title', { method: 'PUT', cookie: ADMIN, body: { it: '', de: '', fr: '', en: '' } }));
    assert.equal(res.status, 200);
    assert.equal(writes(calls).length, 1);
  });

  test('chiavi non valide → 400 field chiave, nessuna scrittura', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    for (const k of ['Hero.Title', 'hero..title', 'hero.title%3Cscript%3E', 'chiave.inesistente', 'privacy.note', 'privacy_page.title', 'form.note', 's1.list', 'hero']) {
      const res = await testi(req(`/api/testi/${k}`, { method: 'PUT', cookie: ADMIN, body: { it: 'x' } }));
      assert.equal(res.status, 400, k);
      assert.deepEqual(await res.json(), { error: 'invalid_input', field: 'chiave' }, k);
    }
    assert.equal(writes(calls).length, 0);
  });

  test('testo troppo lungo, lingua sconosciuta, tipo sbagliato → 400', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    const casi = [
      [{ it: 'x'.repeat(2001) }, 'it'],
      [{ es: 'hola' }, 'es'],
      [{ de: 5 }, 'de'],
      [{ fr: 'a\u0000b' }, 'fr'],
    ];
    for (const [body, field] of casi) {
      const res = await testi(req('/api/testi/hero.title', { method: 'PUT', cookie: ADMIN, body }));
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: 'invalid_input', field });
    }
    assert.equal(writes(calls).length, 0);
  });
});

// ---------------------------------------------------------------- media

describe('media — upload-url', () => {
  const signRoute = [
    'POST',
    /^\/storage\/v1\/object\/upload\/sign\/media\//,
    (c) => ({ body: { url: `${c.url.pathname.replace('/storage/v1', '')}?token=tok.en-123` } }),
  ];

  test('immagine valida → percorso casuale galleria/<uuid>.jpg e URL firmato', async () => {
    const calls = mockFetch([staffRoute(PROFILES), signRoute]);
    const res = await media(req('/api/media/upload-url', {
      method: 'POST',
      cookie: ADMIN,
      body: { nome_file: '../../etc/Foto Matrimonio.JPEG', tipo_mime: 'image/jpeg', dimensione: 5 * 1024 * 1024 },
    }));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(data.path, /^galleria\/[0-9a-f-]{36}\.jpg$/);
    assert.ok(!data.path.includes('Matrimonio'));
    assert.equal(data.upload_url, `${SB}/storage/v1/object/upload/sign/media/${data.path}?token=tok.en-123`);
    assert.equal(data.metodo, 'PUT');
    const sign = calls.find((c) => c.url.pathname.startsWith('/storage/'));
    assert.equal(sign.headers.get('authorization')?.startsWith('Bearer '), true);
  });

  test('cartella dj e video mp4 fino a 200 MB', async () => {
    mockFetch([staffRoute(PROFILES), signRoute]);
    let res = await media(req('/api/media/upload-url', { method: 'POST', cookie: ADMIN, body: { nome_file: 'a.png', tipo_mime: 'image/png', dimensione: 100, cartella: 'dj' } }));
    assert.equal(res.status, 200);
    assert.match((await res.json()).path, /^dj\//);
    res = await media(req('/api/media/upload-url', { method: 'POST', cookie: ADMIN, body: { nome_file: 'v.mp4', tipo_mime: 'video/mp4', dimensione: 200 * 1024 * 1024 } }));
    assert.equal(res.status, 200);
  });

  test('MIME non ammesso, estensione incoerente, dimensione eccessiva, cartella non valida → 400', async () => {
    const calls = mockFetch([staffRoute(PROFILES), signRoute]);
    const casi = [
      [{ nome_file: 'a.svg', tipo_mime: 'image/svg+xml', dimensione: 10 }, 'tipo_mime'],
      [{ nome_file: 'a.html', tipo_mime: 'text/html', dimensione: 10 }, 'tipo_mime'],
      [{ nome_file: 'a.gif', tipo_mime: 'image/gif', dimensione: 10 }, 'tipo_mime'],
      [{ nome_file: 'a.mov', tipo_mime: 'video/quicktime', dimensione: 10 }, 'tipo_mime'],
      [{ nome_file: 'a.html', tipo_mime: 'image/jpeg', dimensione: 10 }, 'nome_file'],
      [{ nome_file: 'senza-estensione', tipo_mime: 'image/png', dimensione: 10 }, 'nome_file'],
      [{ nome_file: 'a.jpg', tipo_mime: 'image/jpeg', dimensione: 10 * 1024 * 1024 + 1 }, 'dimensione'],
      [{ nome_file: 'a.mp4', tipo_mime: 'video/mp4', dimensione: 200 * 1024 * 1024 + 1 }, 'dimensione'],
      [{ nome_file: 'a.jpg', tipo_mime: 'image/jpeg', dimensione: 0 }, 'dimensione'],
      [{ nome_file: 'a.jpg', tipo_mime: 'image/jpeg', dimensione: 1.5 }, 'dimensione'],
      [{ nome_file: 'a.jpg', tipo_mime: 'image/jpeg', dimensione: 10, cartella: '../privato' }, 'cartella'],
      [{ nome_file: 'a.jpg', tipo_mime: 'image/jpeg', dimensione: 10, path: 'galleria/x.jpg' }, 'path'],
    ];
    for (const [body, field] of casi) {
      const res = await media(req('/api/media/upload-url', { method: 'POST', cookie: ADMIN, body }));
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(await res.json(), { error: 'invalid_input', field }, JSON.stringify(body));
    }
    assert.equal(calls.filter((c) => c.url.pathname.startsWith('/storage/')).length, 0);
  });

  test('risposta di Storage inattesa (URL per un altro file) → 502 generico', async () => {
    mockFetch([staffRoute(PROFILES), ['POST', /^\/storage\/v1\/object\/upload\/sign\//, () => ({ body: { url: '/object/upload/sign/media/galleria/altro.jpg?token=x' } })]]);
    const res = await media(req('/api/media/upload-url', { method: 'POST', cookie: ADMIN, body: { nome_file: 'a.jpg', tipo_mime: 'image/jpeg', dimensione: 10 } }));
    assert.equal(res.status, 502);
    assertNoLeak(assert, await res.text());
  });

  test('Storage rifiuta (RLS) → 403 generico senza dettagli', async () => {
    mockFetch([staffRoute(PROFILES), ['POST', /^\/storage\/v1\/object\/upload\/sign\//, () => ({ status: 400, body: { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' } })]]);
    const res = await media(req('/api/media/upload-url', { method: 'POST', cookie: ADMIN, body: { nome_file: 'a.jpg', tipo_mime: 'image/jpeg', dimensione: 10 } }));
    assert.equal(res.status, 403);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: 'forbidden' });
    assertNoLeak(assert, text);
  });
});

describe('media — anteprima', () => {
  test('URL firmato breve per un file del bucket', async () => {
    const calls = mockFetch([
      staffRoute(PROFILES),
      ['POST', /^\/storage\/v1\/object\/sign\/media\/galleria\//, (c) => ({ body: { signedURL: `${c.url.pathname.replace('/storage/v1', '')}?token=abc` } })],
    ]);
    const res = await media(req(`/api/media/anteprima/${FOTO}`, { cookie: ADMIN }));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.url, `${SB}/storage/v1/object/sign/media/${FOTO}?token=abc`);
    assert.equal(data.scadenza_secondi, 300);
    const sign = calls.find((c) => c.url.pathname.startsWith('/storage/'));
    assert.deepEqual(sign.body, { expiresIn: 300 });
  });

  test('percorsi non validi → 404, nessuna chiamata a Storage', async () => {
    const calls = mockFetch([staffRoute(PROFILES)]);
    for (const p of ['galleria/../segreto.jpg', 'galleria/x.jpg', 'privato/40000000-0000-4000-8000-000000000001.jpg', '%2e%2e/%2e%2e/etc', 'galleria/40000000-0000-4000-8000-000000000001.svg']) {
      const res = await media(req(`/api/media/anteprima/${p}`, { cookie: ADMIN }));
      assert.equal(res.status, 404, p);
    }
    assert.equal(calls.filter((c) => c.url.pathname.startsWith('/storage/')).length, 0);
  });
});

// ---------------------------------------------------------------- pubblica

describe('pubblica', () => {
  const NETLIFY = /^\/build_hooks\//;

  function hookRoute(status = 200) {
    return ['POST', NETLIFY, () => ({ status, body: {} })];
  }

  test('pubblicazione riuscita → 202, build hook chiamato con POST, esito "avviata"', async () => {
    const calls = mockFetch([
      staffRoute(PROFILES),
      ['POST', /^\/rest\/v1\/rpc\/registra_pubblicazione$/, () => ({ body: { limite: false, id: ID, created_at: '2026-11-24T10:00:00Z' } })],
      hookRoute(200),
      ['PATCH', /^\/rest\/v1\/pubblicazioni\?id=eq\./, () => ({ status: 204 })],
    ]);
    const res = await pubblica(req('/api/pubblica', { method: 'POST', cookie: ADMIN }));
    assert.equal(res.status, 202);
    const text = await res.text();
    assert.ok(!text.includes('build_hooks') && !text.includes('abcdef0123'), 'non deve rivelare il build hook');
    const hook = calls.find((c) => c.url.hostname === 'api.netlify.com');
    assert.equal(hook.method, 'POST');
    assert.ok(!hook.headers.has('cookie') && !hook.headers.has('authorization') && !hook.headers.has('apikey'));
    const patch = calls.find((c) => c.method === 'PATCH');
    assert.deepEqual(patch.body, { esito: 'avviata' });
  });

  test('limite 1 ogni 2 minuti → 429 con Retry-After, build hook NON chiamato', async () => {
    const calls = mockFetch([
      staffRoute(PROFILES),
      ['POST', /^\/rest\/v1\/rpc\/registra_pubblicazione$/, () => ({ body: { limite: true, attesa_secondi: 75 } })],
      hookRoute(200),
    ]);
    const res = await pubblica(req('/api/pubblica', { method: 'POST', cookie: ADMIN }));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '75');
    assert.deepEqual(await res.json(), { error: 'too_many_requests', attesa_secondi: 75 });
    assert.ok(!calls.some((c) => c.url.hostname === 'api.netlify.com'));
  });

  test('build hook in errore → 502 generico ed esito "errore" registrato', async () => {
    const calls = mockFetch([
      staffRoute(PROFILES),
      ['POST', /^\/rest\/v1\/rpc\/registra_pubblicazione$/, () => ({ body: { limite: false, id: ID } })],
      hookRoute(500),
      ['PATCH', /^\/rest\/v1\/pubblicazioni\?id=eq\./, () => ({ status: 204 })],
    ]);
    const res = await pubblica(req('/api/pubblica', { method: 'POST', cookie: ADMIN }));
    assert.equal(res.status, 502);
    const text = await res.text();
    assertNoLeak(assert, text);
    assert.ok(!text.includes('netlify.com'));
    assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { esito: 'errore' });
  });

  test('NETLIFY_BUILD_HOOK mancante o non valido → 500 server_misconfigured, nessuna registrazione', async () => {
    for (const v of [undefined, 'http://api.netlify.com/build_hooks/abcdef0123456789', 'https://evil.example/build_hooks/abcdef0123456789']) {
      if (v === undefined) delete process.env.NETLIFY_BUILD_HOOK;
      else process.env.NETLIFY_BUILD_HOOK = v;
      const calls = mockFetch([staffRoute(PROFILES)]);
      const orig = console.error;
      const logs = [];
      console.error = (...a) => logs.push(a.join(' '));
      let res;
      try {
        res = await pubblica(req('/api/pubblica', { method: 'POST', cookie: ADMIN }));
      } finally {
        console.error = orig;
      }
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { error: 'server_misconfigured' });
      assert.equal(upstream(calls).length, 0);
      assert.ok(!logs.join('\n').includes('evil.example'), 'il valore della variabile non va nei log');
    }
  });

  test('GET /api/pubblicazioni → elenco con nome di chi ha pubblicato', async () => {
    mockFetch([
      staffRoute(PROFILES),
      ['GET', /^\/rest\/v1\/pubblicazioni\?/, () => ({ body: [{ id: ID, created_at: '2026-11-24T10:00:00Z', esito: 'avviata', staff: { nome: 'Admin' } }] })],
    ]);
    const res = await pubblica(req('/api/pubblicazioni', { cookie: ADMIN }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { pubblicazioni: [{ id: ID, created_at: '2026-11-24T10:00:00Z', esito: 'avviata', richiesta_da: 'Admin' }] });
  });

  test('metodi sbagliati → 405', async () => {
    mockFetch([staffRoute(PROFILES)]);
    let res = await pubblica(req('/api/pubblica', { cookie: ADMIN }));
    assert.equal(res.status, 405);
    res = await pubblica(req('/api/pubblicazioni', { method: 'POST', cookie: ADMIN }));
    assert.equal(res.status, 405);
  });
});
