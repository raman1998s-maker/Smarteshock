// Blocco facoltativo "Dettagli tecnici sul luogo" del modulo pubblico (POST /api/richiesta):
// campi dt_* → richieste_web.dettagli_tecnici (jsonb), solo valori validati.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, test } from 'node:test';
import { mockFetch, req, setEnv } from './_helpers.js';

setEnv();
const richiesta = (await import('../../netlify/functions/richiesta.js')).default;
const { FORNITORI, dettagliTecnici, dettagliTecniciSchema } = await import('../../netlify/functions/_lib/schemas.js');

const insertRoute = () => ['POST', /^\/rest\/v1\/richieste_web$/, () => ({ status: 201 })];
const BASE = { nome: 'Maria Muster', email: 'maria@example.ch', lingua: 'de', servizi: ['Ton', 'Licht'] };
const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' };

const post = (body) => richiesta(req('/api/richiesta', { method: 'POST', body }));

describe('dettagli tecnici sul luogo', () => {
  beforeEach(setEnv);

  test('valori validi (JSON) → salvati in dettagli_tecnici senza prefisso, numeri convertiti', async () => {
    const calls = mockFetch([insertRoute()]);
    const res = await post({
      ...BASE,
      dt_spazio: 'tendone',
      dt_superficie_m2: '250',
      dt_altezza_m: '4,5',
      dt_prese: ['230v', 'cee32', 'cee125'],
      dt_prese_cee32_n: '2',
      dt_prese_vicine: 'no',
      dt_montaggio_giorno_prima: 'richiesto',
      dt_montaggio_dalle: 'il giorno prima dalle 14',
      dt_volume_limiti: 'si',
      dt_musica_fino: '23:30',
      dt_decibel_max: '95',
      dt_discorsi: 'si',
      dt_oratori: '3_5',
      dt_rilevatori_fumo: 'si',
      dt_nebbia_permessa: 'da_chiedere',
      dt_contenuti_da: 'agenzia',
      dt_forn_foto_nome: 'Studio Esempio',
      dt_forn_foto_contatto: 'foto@example.ch',
    });
    assert.equal(res.status, 200);
    const d = calls[0].body.dettagli_tecnici;
    assert.deepEqual(d, {
      spazio: 'tendone',
      superficie_m2: 250,
      altezza_m: 4.5,
      prese: ['230v', 'cee32', 'cee125'],
      prese_cee32_n: 2,
      prese_vicine: 'no',
      montaggio_dalle: 'il giorno prima dalle 14',
      montaggio_giorno_prima: 'richiesto',
      volume_limiti: 'si',
      musica_fino: '23:30',
      decibel_max: 95,
      discorsi: 'si',
      oratori: '3_5',
      rilevatori_fumo: 'si',
      nebbia_permessa: 'da_chiedere',
      contenuti_da: 'agenzia',
      forn_foto_nome: 'Studio Esempio',
      forn_foto_contatto: 'foto@example.ch',
    });
    // nessun campo dt_* finisce come colonna della tabella
    assert.ok(Object.keys(calls[0].body).every((k) => !k.startsWith('dt_')));
  });

  test('invio classico del form (urlencoded, senza JS): dt_prese ripetibile, campi vuoti scartati', async () => {
    const calls = mockFetch([insertRoute()]);
    const form = new URLSearchParams([
      ['lingua', 'it'], ['nome', 'Mario'], ['email', 'mario@example.ch'],
      ['dt_prese', '230v'], ['dt_prese', 'non_so'], ['dt_accesso', 'scale'], ['dt_altezza_m', ''], ['dt_volume_quali', '  '],
    ]);
    const res = await richiesta(req('/api/richiesta', { method: 'POST', body: form.toString(), xrw: false, headers: FORM_HEADERS }));
    assert.equal(res.status, 303);
    assert.deepEqual(calls[0].body.dettagli_tecnici, { prese: ['230v', 'non_so'], accesso: 'scale' });
  });

  test('nessun dettaglio compilato → la colonna non viene inviata', async () => {
    const calls = mockFetch([insertRoute()]);
    const res = await post({ ...BASE, dt_spazio: '', dt_prese: [] });
    assert.equal(res.status, 200);
    assert.equal('dettagli_tecnici' in calls[0].body, false);
  });

  test('campi sconosciuti scartati (anche con prefisso dt_ o oggetti annidati)', async () => {
    const calls = mockFetch([insertRoute()]);
    const res = await post({ ...BASE, dt_spazio: 'sala', dt_hack: 'x', dt___proto__: 'x', dettagli_tecnici: { evil: true }, campo_strano: 1 });
    assert.equal(res.status, 200);
    assert.deepEqual(calls[0].body.dettagli_tecnici, { spazio: 'sala' });
    assert.equal(calls[0].body.campo_strano, undefined);
  });

  test('enum sbagliati → 400 con il nome del campo del modulo, niente salvataggio', async () => {
    const calls = mockFetch([insertRoute()]);
    const casi = {
      dt_spazio: 'castello',
      dt_prese: ['230v', 'nucleare'],
      dt_nebbia_permessa: 'forse',
      dt_oratori: '10',
      dt_montaggio_giorno_prima: 'si',
      dt_discorsi: 'non_so',
      dt_contenuti_da: ['cliente'],
    };
    for (const [campo, valore] of Object.entries(casi)) {
      const res = await post({ ...BASE, [campo]: valore });
      assert.equal(res.status, 400, campo);
      assert.deepEqual(await res.json(), { error: 'invalid_input', field: campo }, campo);
    }
    assert.equal(calls.length, 0);
  });

  test('numeri fuori dai limiti o non validi → 400', async () => {
    const calls = mockFetch([insertRoute()]);
    const casi = [
      ['dt_altezza_m', '0.5'], ['dt_altezza_m', '41'], ['dt_altezza_m', '3.55'], ['dt_altezza_m', 'alta'],
      ['dt_superficie_m2', '0'], ['dt_superficie_m2', '10001'], ['dt_superficie_m2', '12.5'],
      ['dt_decibel_max', '59'], ['dt_decibel_max', '121'],
      ['dt_musica_fino', '24:00'], ['dt_musica_fino', '7:30'], ['dt_musica_fino', 'mezzanotte'],
    ];
    for (const [campo, valore] of casi) {
      const res = await post({ ...BASE, [campo]: valore });
      assert.equal(res.status, 400, `${campo}=${valore}`);
    }
    assert.equal(calls.length, 0);
  });

  test('testi troppo lunghi o su più righe → 400', async () => {
    const calls = mockFetch([insertRoute()]);
    const casi = [
      ['dt_montaggio_dalle', 'x'.repeat(81)],
      ['dt_volume_quali', 'x'.repeat(121)],
      ['dt_forn_location_nome', 'x'.repeat(81)],
      ['dt_forn_planner_contatto', 'x'.repeat(81)],
      ['dt_smontaggio_entro', 'riga 1\nriga 2'],
    ];
    for (const [campo, valore] of casi) {
      const res = await post({ ...BASE, [campo]: valore });
      assert.equal(res.status, 400, campo);
    }
    // al limite esatto va bene
    const ok = await post({ ...BASE, dt_montaggio_dalle: 'x'.repeat(80), dt_volume_quali: 'y'.repeat(120) });
    assert.equal(ok.status, 200);
    assert.equal(calls.length, 1);
  });

  test('ogni campo dello schema ha un limite (enum, numero o lunghezza): il caso peggiore resta piccolo', () => {
    // tutti i campi di testo al massimo, con caratteri multibyte: sotto il limite della colonna (8 kB)
    const body = {};
    for (const key of Object.keys(dettagliTecniciSchema)) body[`dt_${key}`] = 'é'.repeat(200);
    assert.throws(() => dettagliTecnici(body)); // nessun campo accetta 200 caratteri
    const max = {};
    for (const key of Object.keys(dettagliTecniciSchema)) {
      if (/^forn_|montaggio_dalle|smontaggio_entro/.test(key)) max[`dt_${key}`] = 'é'.repeat(80);
    }
    max.dt_volume_quali = 'é'.repeat(120);
    const d = dettagliTecnici(max);
    assert.ok(Buffer.byteLength(JSON.stringify(d)) < 8192);
  });
});

describe('migrazione 0005 (controlli statici)', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/0005_richieste_dettagli_tecnici.sql', import.meta.url), 'utf8');

  test('colonna jsonb rieseguibile, solo oggetti < 8 kB, anon solo INSERT della colonna', () => {
    assert.match(sql, /add column if not exists dettagli_tecnici jsonb/);
    assert.match(sql, /jsonb_typeof\(dettagli_tecnici\) = 'object' and pg_column_size\(dettagli_tecnici\) < 8192/);
    assert.match(sql, /grant insert \(dettagli_tecnici\) on public\.richieste_web to anon;/);
    assert.doesNotMatch(sql, /grant select[^;]*to anon/i);
  });

  test('la pulizia dei 24 mesi toglie i dati dei fornitori, chiavi uguali allo schema', () => {
    const chiavi = FORNITORI.flatMap((r) => [`forn_${r}_nome`, `forn_${r}_contatto`]);
    for (const k of chiavi) {
      assert.ok(sql.includes(`'${k}'`), k);
      assert.ok(Object.prototype.hasOwnProperty.call(dettagliTecniciSchema, k), k);
    }
    assert.equal((sql.match(/dettagli_tecnici - public\.chiavi_fornitori\(\)/g) || []).length, 2);
    assert.match(sql, /function public\.pulisci_richieste_vecchie\(\)[\s\S]*security definer[\s\S]*set search_path = public/);
    assert.match(sql, /revoke all on function public\.pulisci_richieste_vecchie\(\) from public, anon, authenticated;/);
  });
});
