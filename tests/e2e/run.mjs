#!/usr/bin/env node
// Collaudo end-to-end di Meekon Displays (Playwright + Chromium già installati).
//
//   node tests/e2e/run.mjs
//
// - genera le pagine (`python3 build.py`) e avvia un server statico locale su una porta libera
// - applica a ogni documento HTML la CSP letta da netlify.toml (per scoprire violazioni)
// - simula tutte le API /api/* con page.route (nessuna chiamata reale, nessun dominio esterno)
// - stampa un riepilogo passati/falliti ed esce con codice 1 se qualcosa fallisce
//
// Nessuna dipendenza in package.json: `playwright` si carica dall'installazione globale.
// Nessun trace. Screenshot solo se si imposta E2E_SCREENSHOTS=<cartella>.

import { createRequire } from 'node:module';
import { spawn, spawnSync, execSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.E2E_SCREENSHOTS || '';

// ------------------------------------------------------------------ playwright
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const tries = ['playwright'];
  for (const dir of (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) tries.push(path.join(dir, 'playwright'));
  try { tries.push(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch { /* npm assente */ }
  tries.push('/opt/node-tools/node_modules/playwright');
  for (const t of tries) {
    try { return require(t); } catch { /* prossimo */ }
  }
  console.error('Playwright non trovato (serve l\'installazione globale già presente).');
  process.exit(2);
}
const { chromium } = loadPlaywright();

// ------------------------------------------------------------------ risultati
const results = []; // { group, name, ok, detail }
let currentGroup = '';
function check(name, ok, detail = '') {
  results.push({ group: currentGroup, name, ok: !!ok, detail: ok ? '' : String(detail).slice(0, 1500) });
  return !!ok;
}
async function guard(name, fn) {
  try { await fn(); } catch (err) { check(`${name} (eccezione)`, false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err)); }
}

// ------------------------------------------------------------------ CSP da netlify.toml
function readCsp() {
  const toml = readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  const m = /Content-Security-Policy\s*=\s*"([^"]+)"/.exec(toml);
  if (!m) throw new Error('Content-Security-Policy non trovata in netlify.toml');
  return m[1];
}
const CSP_FULL = readCsp();
// `upgrade-insecure-requests` riscriverebbe in https le risorse del server locale http://127.0.0.1;
// in produzione (https) non ha effetto sulle risorse same-origin, quindi qui la togliamo.
const CSP = CSP_FULL.split(';').map((s) => s.trim()).filter((s) => s && s !== 'upgrade-insecure-requests').join('; ');

// ------------------------------------------------------------------ build + server
function build() {
  const r = spawnSync('python3', ['build.py'], { cwd: ROOT, encoding: 'utf8' });
  currentGroup = 'Build';
  check('python3 build.py termina senza errori', r.status === 0, `${r.stdout}\n${r.stderr}`);
  if (r.status !== 0) { summary(); process.exit(1); }
}
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}
async function startServer() {
  const port = await freePort();
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${base}/index.html`); if (r.ok) return { proc, base }; } catch { /* non ancora pronto */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('Il server statico non risponde');
}

// ------------------------------------------------------------------ pagina strumentata
const VIEWPORTS = { desktop: { width: 1366, height: 860 }, mobile: { width: 390, height: 844 } };
const LANGS = [
  { lang: 'it', path: '/', thanks: '/grazie.html' },
  { lang: 'de', path: '/de/', thanks: '/de/grazie.html' },
  { lang: 'fr', path: '/fr/', thanks: '/fr/grazie.html' },
  { lang: 'en', path: '/en/', thanks: '/en/grazie.html' },
];

let browser;
let BASE;

/**
 * Crea contesto + pagina con: CSP sulle risposte HTML, registro errori console/pagina,
 * violazioni CSP, richieste (con header), blocco dei domini esterni.
 * apiHandler(route, request, url) gestisce /api/*; se assente → 404 JSON (e viene segnalato).
 */
async function openPage({ viewport = 'desktop', locale = 'it-CH', apiHandler = null, extraRoutes = null } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    deviceScaleFactor: 1,
    locale,
    isMobile: viewport === 'mobile',
    hasTouch: viewport === 'mobile',
    serviceWorkers: 'block',
  });
  const log = { console: [], pageErrors: [], csp: [], requests: [], external: [], apiUnhandled: [] };
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      // eslint-disable-next-line no-console
      console.error(`[CSP] ${e.violatedDirective} blocked=${e.blockedURI} source=${e.sourceFile}:${e.lineNumber}`);
    });
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const loc = msg.location() || {};
    if (text.startsWith('[CSP]') || /Content Security Policy/i.test(text)) log.csp.push(text);
    else log.console.push({ text, url: loc.url || '' });
  });
  page.on('pageerror', (err) => log.pageErrors.push(String(err && err.message ? err.message : err)));
  page.on('request', (req) => {
    log.requests.push({ url: req.url(), method: req.method(), headers: req.headers(), resourceType: req.resourceType() });
  });

  // tutto ciò che non è il server locale viene bloccato e registrato
  await context.route((url) => !url.href.startsWith(BASE) && !url.href.startsWith('data:') && !url.href.startsWith('blob:'), (route) => {
    log.external.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  // API simulate
  await context.route((url) => url.href.startsWith(`${BASE}/api/`), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (apiHandler) {
      const handled = await apiHandler(route, req, url);
      if (handled !== false) return;
    }
    log.apiUnhandled.push(`${req.method()} ${url.pathname}${url.search}`);
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
  });
  // CSP su ogni documento HTML del server locale
  await context.route((url) => url.href.startsWith(BASE) && !url.pathname.startsWith('/api/'), async (route) => {
    const req = route.request();
    if (req.resourceType() !== 'document') return route.fallback();
    const resp = await route.fetch();
    const headers = { ...resp.headers(), 'content-security-policy': CSP };
    return route.fulfill({ response: resp, headers });
  });
  if (extraRoutes) await extraRoutes(context); // registrate per ultime = hanno la precedenza
  return { context, page, log };
}

// errori console "attesi": risposte API non-2xx simulate di proposito (Chrome li stampa come errori)
function unexpectedConsole(log, { allowApiStatus = false, allowUrl = null } = {}) {
  return log.console.filter((c) => {
    if (/Failed to load resource: the server responded with a status of \d+/.test(c.text)) {
      if (allowApiStatus && c.url.startsWith(`${BASE}/api/`)) return false;
      if (allowUrl && c.url === allowUrl) return false;
    }
    if (/Failed to load resource: net::ERR_FAILED/.test(c.text) && allowApiStatus && c.url.startsWith(`${BASE}/api/`)) return false;
    return true;
  });
}
function fmtConsole(list) { return list.map((c) => `${c.text} @ ${c.url}`).join('\n'); }

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }).catch(() => {});
}

// scorre tutta la pagina (fa comparire gli elementi .reveal e i lazy-load)
async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 150));
    window.scrollTo(0, 0);
  });
}

// ------------------------------------------------------------------ controlli riutilizzabili (nel browser)
async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const over = de.scrollWidth - de.clientWidth;
    if (over <= 0) return null;
    const vw = de.clientWidth;
    const culprits = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1) {
        const s = getComputedStyle(el);
        if (s.position === 'fixed' && s.visibility === 'hidden') continue;
        culprits.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''} right=${Math.round(r.right)}`);
        if (culprits.length >= 8) break;
      }
    }
    return `scrollWidth ${de.scrollWidth} > clientWidth ${vw}: ${culprits.join(', ')}`;
  });
}

async function localRefs(page) {
  return page.evaluate(() => {
    const out = new Set();
    const addUrl = (u) => { if (u) out.add(new URL(u, document.baseURI).href); };
    document.querySelectorAll('[href]').forEach((el) => addUrl(el.getAttribute('href')));
    document.querySelectorAll('[src]').forEach((el) => addUrl(el.getAttribute('src')));
    document.querySelectorAll('[poster]').forEach((el) => addUrl(el.getAttribute('poster')));
    document.querySelectorAll('[srcset]').forEach((el) => el.getAttribute('srcset').split(',').forEach((p) => addUrl(p.trim().split(/\s+/)[0])));
    document.querySelectorAll('template').forEach((t) => t.content.querySelectorAll('[href],[src]').forEach((el) => addUrl(el.getAttribute('href') || el.getAttribute('src'))));
    document.querySelectorAll('[action]').forEach((el) => addUrl(el.getAttribute('action')));
    // CSS: url(...) dei fogli locali
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      const walk = (list) => {
        for (const r of list) {
          if (r.cssRules) walk(r.cssRules);
          const text = r.cssText || '';
          for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
            if (!m[1].startsWith('data:')) out.add(new URL(m[1], sheet.href || document.baseURI).href);
          }
        }
      };
      walk(rules);
    }
    return [...out];
  });
}

async function checkLinks(page, label) {
  const refs = await localRefs(page);
  const origin = new URL(BASE).origin;
  const local = refs.filter((u) => u.startsWith(origin));
  const broken = [];
  const anchors = [];
  for (const u of local) {
    const url = new URL(u);
    if (url.pathname.startsWith('/api/')) continue; // endpoint delle functions (testati a parte)
    if (url.hash && url.hash.length > 1 && url.pathname === new URL(page.url()).pathname) anchors.push(decodeURIComponent(url.hash.slice(1)));
    const target = `${url.origin}${url.pathname}${url.search}`;
    const r = await page.request.get(target, { maxRedirects: 0 }).catch((e) => ({ status: () => `errore ${e.message}` }));
    if (r.status() !== 200) broken.push(`${r.status()} ${url.pathname}`);
  }
  const missingAnchors = await page.evaluate((ids) => ids.filter((id) => !document.getElementById(id)), anchors);
  check(`${label}: link e risorse locali rispondono 200 (${local.length} URL)`, broken.length === 0, broken.join(', '));
  check(`${label}: ancore #id esistenti`, missingAnchors.length === 0, missingAnchors.join(', '));
  const external = refs.filter((u) => !u.startsWith(origin) && /^https?:/.test(u));
  return external;
}

async function a11yBasics(page, label) {
  const res = await page.evaluate(() => {
    const unlabeled = [];
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      if (el.type === 'hidden') return;
      const ok = (el.labels && el.labels.length && [...el.labels].some((l) => l.textContent.trim()))
        || (el.getAttribute('aria-label') || '').trim()
        || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby')))
        || (el.getAttribute('title') || '').trim();
      if (!ok) unlabeled.push(el.name || el.id || el.outerHTML.slice(0, 80));
    });
    const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => !h.closest('template'));
    const levels = hs.map((h) => Number(h.tagName[1]));
    const jumps = [];
    for (let i = 1; i < levels.length; i++) if (levels[i] > levels[i - 1] + 1) jumps.push(`h${levels[i - 1]} → h${levels[i]} ("${hs[i].textContent.trim().slice(0, 40)}")`);
    const h1 = levels.filter((l) => l === 1).length;
    const imgsNoAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).map((i) => i.getAttribute('src'));
    return { unlabeled, jumps, h1, first: levels[0] || 0, imgsNoAlt };
  });
  check(`${label}: ogni campo ha un'etichetta`, res.unlabeled.length === 0, res.unlabeled.join(', '));
  check(`${label}: titoli senza salti di livello`, res.jumps.length === 0, res.jumps.join('; '));
  check(`${label}: un solo h1, ed è il primo titolo`, res.h1 === 1 && res.first === 1, `h1=${res.h1}, primo=h${res.first}`);
  check(`${label}: tutte le immagini hanno alt`, res.imgsNoAlt.length === 0, res.imgsNoAlt.join(', '));
}

// focus visibile: si percorre la pagina con Tab e si confronta lo stile con/senza focus
async function focusVisible(page, label, maxTabs = 200) {
  // punto di partenza della navigazione con Tab = inizio del documento (un clic precedente lo sposterebbe)
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const start = document.createElement('span');
    start.tabIndex = -1;
    start.id = '__qa-start';
    document.body.prepend(start);
    start.focus();
    window.scrollTo(0, 0);
  });
  await page.mouse.move(0, 0).catch(() => {});
  // stile di ogni elemento SENZA focus, registrato prima di iniziare a premere Tab
  await page.evaluate(() => {
    const props = ['outlineStyle', 'outlineWidth', 'outlineColor', 'boxShadow', 'backgroundColor', 'color', 'borderColor', 'textDecorationLine'];
    window.__qaProps = props;
    window.__qaSnap = new Map();
    document.querySelectorAll('a, button, input, select, textarea, summary, [tabindex]').forEach((el) => {
      const st = getComputedStyle(el);
      window.__qaSnap.set(el, props.map((p) => st[p]).join('|'));
    });
  });
  const seen = new Set();
  const bad = [];
  let count = 0;
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      if (!window.__qaSnap.has(el)) return { skip: true };
      if (!window.__qaIds) { window.__qaIds = new Map(); }
      if (!window.__qaIds.has(el)) window.__qaIds.set(el, window.__qaIds.size + 1);
      const focused = getComputedStyle(el);
      const a = window.__qaProps.map((p) => focused[p]).join('|');
      const hasRing = (focused.outlineStyle !== 'none' && parseFloat(focused.outlineWidth) > 0) || focused.boxShadow !== 'none';
      const desc = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''} "${(el.textContent || el.getAttribute('aria-label') || el.name || '').trim().slice(0, 30)}"`;
      return { key: window.__qaIds.get(el), changed: a !== window.__qaSnap.get(el), hasRing, desc };
    });
    if (i === 0) await page.evaluate(() => { const s = document.getElementById('__qa-start'); if (s) s.remove(); });
    if (process.env.E2E_DEBUG_FOCUS) console.log('FOCUS', JSON.stringify(info));
    if (!info) break;
    if (info.skip) continue;
    if (seen.size && info.key === 1) break; // giro completo
    if (seen.has(info.key)) continue; // es. input date: più tab nei sotto-campi dello stesso elemento
    seen.add(info.key);
    count++;
    if (!info.changed || !info.hasRing) bad.push(`${info.desc}${info.changed ? ' (cambia ma senza outline/box-shadow)' : ' (nessun cambiamento)'}`);
  }
  check(`${label}: focus da tastiera visibile su link/pulsanti/campi (${count} elementi)`, count > 0 && bad.length === 0, count === 0 ? 'nessun elemento raggiunto con Tab' : bad.slice(0, 15).join('; '));
}

// contrasto WCAG AA del testo su sfondo uniforme (testo su immagini/video escluso e contato a parte)
async function contrast(page, label) {
  const res = await page.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    const fails = [];
    let tested = 0;
    let skipped = 0;
    const els = [...document.querySelectorAll('body *')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
    for (const el of els) {
      if (el.closest('template, script, style, noscript, [hidden], [aria-hidden="true"]')) continue;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (s.visibility === 'hidden' || s.display === 'none' || r.width < 2 || r.height < 2) continue;
      let fg = parse(s.color);
      if (!fg) continue;
      // sfondo: si risale finché non si trova un colore pieno; immagini/video/gradienti → escluso
      const layers = [];
      let node = el;
      let img = false;
      while (node && node.nodeType === 1) {
        const ns = getComputedStyle(node);
        if (ns.backgroundImage && ns.backgroundImage !== 'none') { img = true; break; }
        const bg = parse(ns.backgroundColor);
        if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break; }
        if (node.matches('.hero, .hero *, figure, .gallery__item')) { img = true; break; }
        node = node.parentElement;
      }
      if (img) { skipped++; continue; }
      let bg = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i], bg);
      if (fg.a < 1) fg = blend(fg, bg);
      const L1 = lum(fg); const L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(s.fontSize);
      const bold = Number(s.fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const min = large ? 3 : 4.5;
      tested++;
      if (ratio + 0.01 < min) fails.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''} "${el.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}:1 < ${min} (${s.color} su rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}), ${size}px)`);
    }
    return { fails, tested, skipped };
  });
  check(`${label}: contrasto testo AA (${res.tested} elementi verificati, ${res.skipped} su immagine/video esclusi)`, res.fails.length === 0, res.fails.slice(0, 12).join('\n'));
}

// ------------------------------------------------------------------ 0. autoverifica dei controlli
// Una pagina volutamente sbagliata: ogni rilevatore deve segnalarla, altrimenti il collaudo non è affidabile.
async function selfTest() {
  currentGroup = 'Autoverifica dei rilevatori';
  const url = `${BASE}/__autoverifica__.html`;
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>x</title>
<style>button{outline:none}button:focus{outline:none}.low{color:#777;background:#888}</style></head>
<body><h1>T</h1><h4>salto</h4><p class="low">testo poco leggibile</p><p>{{segnaposto}}</p>
<img src="/assets/img/logo.png"><input name="senzalabel"><button>pulsante</button>
<div style="width:3000px">largo</div><img src="https://esterno.example/x.png" alt="">
<script>console.log('inline')</script><script src="/assets/js/non-esiste.js"></script></body></html>`;
  const { context, page, log } = await openPage({
    extraRoutes: async (ctx) => {
      // CSP vera (blocca anche il <style> di prova: per questo dopo si usa un foglio costruito)
      await ctx.route(url, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': CSP }, body: html }));
      // senza CSP: serve a verificare che il blocco delle richieste esterne funzioni anche da solo
      await ctx.route(`${url}?nocsp`, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>x</title><img src="https://esterno.example/x.png" alt="">' }));
    },
  });
  await guard('autoverifica', async () => {
    await page.goto(url);
    await page.waitForTimeout(300);
    check('rileva violazioni CSP (script inline, attributo style)', log.csp.length >= 2, log.csp.join('\n') || 'nessuna');
    check('rileva errori in console (risorsa 404)', log.console.some((c) => /404/.test(c.text)), fmtConsole(log.console) || 'nessuno');
    check('la CSP blocca l\'immagine esterna (img-src)', log.csp.some((t) => t.includes('esterno.example')), log.csp.join('\n'));
    await page.goto(`${url}?nocsp`);
    await page.waitForTimeout(200);
    check('senza CSP, il blocco di prova intercetta e registra le richieste esterne', log.external.some((u) => u.includes('esterno.example')), log.external.join(', ') || 'nessuna');
    await page.goto(url);
    await page.waitForTimeout(200);
    // con la CSP vera il <style> è bloccato: lo si inserisce come foglio costruito per provare contrasto/focus/overflow
    await page.evaluate(() => {
      const sh = new CSSStyleSheet();
      sh.replaceSync('button{outline:none!important;box-shadow:none!important}.low{color:#777;background:#888}.wide{width:3000px}');
      document.adoptedStyleSheets = [sh];
      document.querySelector('div').className = 'wide';
    });
    const over = await horizontalOverflow(page);
    check('rileva lo scorrimento orizzontale', !!over, 'non rilevato');
    const before = results.length;
    await a11yBasics(page, 'prova');
    await contrast(page, 'prova');
    await focusVisible(page, 'prova', 10);
    const probe = results.splice(before);
    const failed = (re) => probe.some((r) => re.test(r.name) && !r.ok);
    check('rileva un campo senza etichetta', failed(/etichetta/), JSON.stringify(probe));
    check('rileva un salto nei titoli', failed(/salti/), JSON.stringify(probe));
    check('rileva un\'immagine senza alt', failed(/alt/), JSON.stringify(probe));
    check('rileva un contrasto insufficiente', failed(/contrasto/), JSON.stringify(probe));
    check('rileva un focus non visibile', failed(/focus/), JSON.stringify(probe));
    const ph = await page.evaluate(() => /\{\{|\}\}/.test(document.documentElement.outerHTML));
    check('rileva un segnaposto {{ }}', ph, 'non rilevato');
  });
  await context.close();
}

// ------------------------------------------------------------------ 1. sito pubblico
const ADDRESS_PATTERNS = [
  [/\bIBAN\b/i, 'IBAN'],
  [/\bCH\d{2}[ ]?\d{4}[ ]?\d{4}/, 'numero IBAN CH'],
  [/\b(P\.?\s?IVA|MWST|TVA|UID|USt-IdNr)\b/i, 'partita IVA / UID'],
  [/\bCHE-?\d{3}\.?\d{3}\.?\d{3}\b/, 'numero UID'],
  [/\b(via|viale|piazza|strasse|gasse|weg|platz|rue|avenue|chemin|street|road)\s+[A-ZÄÖÜa-zäöüéè.'-]+\s+\d{1,4}[a-z]?\b/i, 'indirizzo (via + numero)'],
  [/\b[A-ZÄÖÜa-zäöü]+(strasse|gasse|weg)\s+\d{1,4}\b/i, 'indirizzo (…strasse N)'],
  [/\b(CH-)?[1-9]\d{3}\s+(Zürich|Zurich|Bern|Berne|Basel|Bâle|Luzern|Lucerne|Lugano|Bellinzona|Locarno|Chur|Coira|St\.?\s?Gallen|Genève|Geneva|Lausanne|Winterthur|Zug|Aarau|Olten|Thun|Biel|Sion|Fribourg|Neuchâtel|Davos)\b/, 'CAP + città'],
  [/google\.[a-z.]+\/maps|maps\.app\.goo\.gl|openstreetmap/i, 'mappa'],
];

async function publicSite() {
  for (const vpName of Object.keys(VIEWPORTS)) {
    for (const L of LANGS) {
      currentGroup = `Sito pubblico ${L.path} @ ${vpName} ${VIEWPORTS[vpName].width}px`;
      const label = `${L.lang}/${vpName}`;
      const { context, page, log } = await openPage({ viewport: vpName, locale: L.lang === 'it' ? 'it-CH' : `${L.lang}-CH` });
      await guard(label, async () => {
        const resp = await page.goto(BASE + L.path, { waitUntil: 'load' });
        check(`${label}: pagina risponde 200`, resp && resp.status() === 200, resp && resp.status());
        await scrollThrough(page);
        await page.waitForTimeout(300);

        const info = await page.evaluate(() => ({
          lang: document.documentElement.lang,
          bodyLang: document.body.dataset.lang,
          html: (() => { const c = document.documentElement.cloneNode(true); c.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]').forEach((x) => x.remove()); return c.outerHTML; })(),
          text: document.body.innerText,
          hreflang: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => [l.hreflang, l.getAttribute('href')]),
          canonical: (document.querySelector('link[rel="canonical"]') || {}).href || null,
          wa: [...document.querySelectorAll('a[href*="wa.me"]')].map((a) => a.getAttribute('href')),
          fab: (document.querySelector('.fab-whatsapp') || {}).href || null,
          title: document.title,
        }));
        check(`${label}: <html lang="${L.lang}">`, info.lang === L.lang, `lang="${info.lang}"`);
        check(`${label}: nessun segnaposto {{ }} (JSON-LD e dati JSON esclusi)`, !/\{\{|\}\}/.test(info.html), (info.html.match(/.{0,40}(\{\{|\}\}).{0,40}/) || [''])[0]);
        const ldOk = await page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"], script[type="application/json"]')].every((x) => { try { JSON.parse(x.textContent); return !/\{\{\s*\w/.test(x.textContent); } catch { return false; } }));
        check(`${label}: JSON-LD / JSON incorporati validi e senza segnaposto`, ldOk, 'JSON non valido o con {{');
        const hl = Object.fromEntries(info.hreflang);
        const expectHl = { it: '/', de: '/de/', fr: '/fr/', en: '/en/', 'x-default': '/' };
        const hlBad = Object.entries(expectHl).filter(([k, p]) => !hl[k] || new URL(hl[k]).pathname !== p).map(([k]) => `${k}=${hl[k] || 'mancante'}`);
        check(`${label}: hreflang it/de/fr/en/x-default corretti`, hlBad.length === 0, hlBad.join(', '));
        if (info.canonical) check(`${label}: canonical punta alla pagina della lingua`, new URL(info.canonical).pathname === L.path, info.canonical);
        check(`${label}: pulsante WhatsApp → https://wa.me/41799450000`, info.fab === 'https://wa.me/41799450000' && info.wa.every((h) => h === 'https://wa.me/41799450000'), `fab=${info.fab} altri=${info.wa.join(',')}`);
        const addr = ADDRESS_PATTERNS.filter(([re]) => re.test(info.text)).map(([re, name]) => `${name}: "${(info.text.match(re) || [''])[0]}"`);
        check(`${label}: nessun indirizzo/IBAN/P.IVA/mappa nel testo`, addr.length === 0, addr.join('; '));
        if (L.lang === 'de') check(`${label}: tedesco svizzero senza "ß"`, !info.text.includes('ß'), (info.text.match(/.{0,20}ß.{0,20}/) || [''])[0]);

        const over = await horizontalOverflow(page);
        check(`${label}: nessuno scorrimento orizzontale`, !over, over);

        await a11yBasics(page, label);
        const ext = await checkLinks(page, label);
        const extBad = ext.filter((u) => !/^https:\/\/(wa\.me\/41799450000|www\.instagram\.com\/meekon_display\/?|meekondisplay\.ch\/)/.test(u));
        check(`${label}: link esterni solo verso WhatsApp/Instagram/dominio ufficiale`, extBad.length === 0, extBad.join(', '));
        const extA = await page.evaluate(() => [...document.querySelectorAll('a[target="_blank"]')].filter((a) => !/noopener/.test(a.rel)).map((a) => a.href));
        check(`${label}: link target=_blank con rel=noopener`, extA.length === 0, extA.join(', '));

        // filtri galleria
        const gal = await page.evaluate(() => {
          const g = document.getElementById('gallery');
          const f = g && g.previousElementSibling;
          return { has: !!g, filters: f && f.classList.contains('filters') ? [...f.querySelectorAll('button[data-filter]')].map((b) => b.dataset.filter) : [] };
        });
        if (check(`${label}: filtri galleria inseriti dal JS`, gal.has && gal.filters.length > 1, JSON.stringify(gal))) {
          const cat = gal.filters.find((c) => c !== 'all');
          await page.locator(`.filters button[data-filter="${cat}"]`).click();
          const after = await page.evaluate((c) => {
            const items = [...document.querySelectorAll('#gallery .gallery__item')];
            const visible = items.filter((i) => !i.hidden && getComputedStyle(i).display !== 'none');
            return { total: items.length, visible: visible.length, wrong: visible.filter((i) => i.dataset.cat !== c).length, expected: items.filter((i) => i.dataset.cat === c).length, pressed: document.querySelector(`.filters button[data-filter="${c}"]`).getAttribute('aria-pressed') };
          }, cat);
          check(`${label}: filtro "${cat}" mostra solo quella categoria`, after.wrong === 0 && after.visible === after.expected && after.visible > 0 && after.pressed === 'true', JSON.stringify(after));
          await page.locator('.filters button[data-filter="all"]').click();
          const all = await page.evaluate(() => [...document.querySelectorAll('#gallery .gallery__item')].filter((i) => !i.hidden && getComputedStyle(i).display !== 'none').length);
          check(`${label}: filtro "tutti" mostra di nuovo tutto`, all === after.total, `${all}/${after.total}`);
        }

        // menu mobile
        if (vpName === 'mobile') {
          const toggle = page.locator('.nav__toggle');
          if (check(`${label}: pulsante menu visibile`, await toggle.isVisible(), 'non visibile')) {
            const firstLink = page.locator('#menu a').first();
            const before = await firstLink.isVisible();
            await toggle.click();
            await page.waitForTimeout(450);
            const st = await page.evaluate(() => {
              const t = document.querySelector('.nav__toggle');
              const links = [...document.querySelectorAll('#menu a')];
              const vis = links.filter((a) => { const r = a.getBoundingClientRect(); const s = getComputedStyle(a); return r.width > 0 && r.height > 0 && r.top < window.innerHeight && s.visibility !== 'hidden'; });
              // il primo link visibile è davvero cliccabile (non coperto)?
              let top = null;
              if (vis[0]) { const r = vis[0].getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); top = e && (e === vis[0] || vis[0].contains(e)); }
              return { expanded: t.getAttribute('aria-expanded'), label: t.getAttribute('aria-label'), visible: vis.length, total: links.length, clickable: top };
            });
            check(`${label}: menu mobile si apre (aria-expanded, link visibili e cliccabili)`, !before && st.expanded === 'true' && st.visible > 0 && st.clickable, JSON.stringify({ before, ...st }));
            const overOpen = await horizontalOverflow(page);
            check(`${label}: nessuno scorrimento orizzontale a menu aperto`, !overOpen, overOpen);
            await shot(page, `menu-${L.lang}`);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
            const closed = await toggle.getAttribute('aria-expanded');
            check(`${label}: Esc chiude il menu`, closed === 'false', closed);
          }
        } else {
          const navVisible = await page.locator('#menu a').first().isVisible();
          check(`${label}: menu di navigazione visibile su desktop`, navVisible, 'non visibile');
        }

        if (vpName === 'desktop') {
          await contrast(page, label);
          await focusVisible(page, label);
        }

        await shot(page, `public-${L.lang}-${vpName}`);
        const errs = unexpectedConsole(log);
        check(`${label}: 0 errori in console`, errs.length === 0 && log.pageErrors.length === 0, fmtConsole(errs) + log.pageErrors.join('\n'));
        check(`${label}: 0 violazioni CSP`, log.csp.length === 0, log.csp.join('\n'));
        check(`${label}: nessuna richiesta verso domini esterni`, log.external.length === 0, log.external.join(', '));
      });
      await context.close();
    }
  }
}

// ------------------------------------------------------------------ 2. modulo di richiesta
async function fillForm(page) {
  await page.fill('#preventivo [name="nome"]', 'Prova Collaudo');
  await page.fill('#preventivo [name="email"]', 'collaudo@example.com');
  await page.fill('#preventivo [name="telefono"]', '+41 00 000 00 00');
  await page.fill('#preventivo [name="ospiti"]', '80');
  await page.locator('#preventivo [name="servizi"]').first().check();
  await page.locator('#preventivo [name="servizi"]').nth(2).check();
  await page.fill('#preventivo [name="messaggio"]', 'Messaggio di prova del collaudo automatico.');
}

async function formTests() {
  for (const L of LANGS) {
    currentGroup = `Modulo di richiesta ${L.path}`;
    // 200 → pagina grazie della lingua
    {
      let sent = null;
      const { context, page, log } = await openPage({
        locale: `${L.lang}-CH`,
        apiHandler: async (route, req, url) => {
          if (url.pathname !== '/api/richiesta' || req.method() !== 'POST') return false;
          sent = { headers: req.headers(), body: req.postData() };
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
        },
      });
      await guard(`${L.lang} invio ok`, async () => {
        await page.goto(BASE + L.path);
        await fillForm(page);
        await Promise.all([page.waitForURL(`${BASE}${L.thanks}`, { timeout: 8000 }), page.locator('#preventivo button[type="submit"]').click()]);
        check(`${L.lang}: risposta 200 → ${L.thanks}`, new URL(page.url()).pathname === L.thanks, page.url());
        let body = {};
        try { body = JSON.parse(sent && sent.body); } catch { body = {}; }
        check(`${L.lang}: invio JSON con X-Requested-With: meekon`, sent && sent.headers['x-requested-with'] === 'meekon' && /application\/json/.test(sent.headers['content-type'] || ''), JSON.stringify(sent && sent.headers));
        check(`${L.lang}: corpo con nome, email, lingua="${L.lang}", servizi[] e honeypot vuoto`, body.nome === 'Prova Collaudo' && body.email === 'collaudo@example.com' && body.lingua === L.lang && Array.isArray(body.servizi) && body.servizi.length === 2 && !body['bot-field'], JSON.stringify(body));
        const thanks = await page.evaluate(() => ({ lang: document.documentElement.lang, h1: (document.querySelector('h1') || {}).textContent || '', robots: (document.querySelector('meta[name="robots"]') || {}).content || '' }));
        check(`${L.lang}: pagina grazie con lang="${L.lang}" e titolo`, thanks.lang === L.lang && thanks.h1.trim().length > 0, JSON.stringify(thanks));
        const errs = unexpectedConsole(log);
        check(`${L.lang}: invio ok senza errori console/CSP`, errs.length === 0 && log.pageErrors.length === 0 && log.csp.length === 0, fmtConsole(errs) + log.pageErrors.join('\n') + log.csp.join('\n'));
      });
      await context.close();
    }
    // 400 con field → errore visibile e campo marcato
    {
      const { context, page, log } = await openPage({
        locale: `${L.lang}-CH`,
        apiHandler: async (route, req, url) => {
          if (url.pathname !== '/api/richiesta') return false;
          return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_input","field":"email"}' });
        },
      });
      await guard(`${L.lang} invio 400`, async () => {
        await page.goto(BASE + L.path);
        await fillForm(page);
        await page.locator('#preventivo button[type="submit"]').click();
        await page.locator('#preventivo .form__error').waitFor({ state: 'visible', timeout: 5000 });
        const st = await page.evaluate(() => ({
          url: location.pathname,
          invalid: document.querySelector('#preventivo [name="email"]').getAttribute('aria-invalid'),
          focused: document.activeElement && document.activeElement.name,
          others: [...document.querySelectorAll('#preventivo [aria-invalid="true"]')].map((e) => e.name),
          btnDisabled: document.querySelector('#preventivo button[type="submit"]').disabled,
          msg: document.querySelector('#preventivo .form__error').textContent.trim(),
        }));
        check(`${L.lang}: 400 field=email → messaggio visibile, campo email aria-invalid e con focus`, st.invalid === 'true' && st.focused === 'email' && st.others.length === 1 && st.msg.length > 0 && st.url === L.path, JSON.stringify(st));
        check(`${L.lang}: dopo l'errore il pulsante torna attivo`, !st.btnDisabled, 'pulsante ancora disabilitato');
        const errStyle = await page.evaluate(() => {
          const el = document.querySelector('#preventivo [name="email"]');
          const a = getComputedStyle(el); const s1 = [a.borderColor, a.outlineColor, a.boxShadow].join('|');
          el.removeAttribute('aria-invalid'); const b = getComputedStyle(el); const s2 = [b.borderColor, b.outlineColor, b.boxShadow].join('|');
          el.setAttribute('aria-invalid', 'true');
          return s1 !== s2;
        });
        check(`${L.lang}: il campo non valido è evidenziato anche graficamente`, errStyle, 'nessuno stile per [aria-invalid="true"] (oltre al focus)');
        await shot(page, `form-400-${L.lang}`);
        const errs = unexpectedConsole(log, { allowApiStatus: true });
        check(`${L.lang}: 400 senza errori console inattesi/CSP`, errs.length === 0 && log.pageErrors.length === 0 && log.csp.length === 0, fmtConsole(errs) + log.pageErrors.join('\n') + log.csp.join('\n'));
      });
      await context.close();
    }
    // errore di rete → messaggio
    {
      const { context, page, log } = await openPage({
        locale: `${L.lang}-CH`,
        apiHandler: async (route, req, url) => {
          if (url.pathname !== '/api/richiesta') return false;
          return route.abort('failed');
        },
      });
      await guard(`${L.lang} errore di rete`, async () => {
        await page.goto(BASE + L.path);
        await fillForm(page);
        await page.locator('#preventivo button[type="submit"]').click();
        const visible = await page.locator('#preventivo .form__error').waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
        const st = await page.evaluate(() => ({ url: location.pathname, invalid: document.querySelectorAll('#preventivo [aria-invalid="true"]').length, disabled: document.querySelector('#preventivo button[type="submit"]').disabled, nome: document.querySelector('#preventivo [name="nome"]').value }));
        check(`${L.lang}: errore di rete → messaggio visibile, dati conservati, pulsante attivo`, visible && st.url === L.path && st.invalid === 0 && !st.disabled && st.nome === 'Prova Collaudo', JSON.stringify({ visible, ...st }));
        const errs = unexpectedConsole(log, { allowApiStatus: true });
        check(`${L.lang}: errore di rete senza errori JS/CSP`, errs.length === 0 && log.pageErrors.length === 0 && log.csp.length === 0, fmtConsole(errs) + log.pageErrors.join('\n') + log.csp.join('\n'));
      });
      await context.close();
    }
  }
}

// ------------------------------------------------------------------ 3. area riservata
const EVENTI_ADMIN = [
  { id: 'e1', numero_ordine: '2026-0001', titolo: 'Evento di prova A', tipo: 'Matrimonio', stato: 'confermato', data_inizio: isoIn(5, '18:00'), data_fine: isoIn(6, '02:00'), localita: 'Località X', sala: 'Sala Y', paese: 'CH', ospiti: 120, servizi: ['Luci', 'Audio'], importo_chf: 12500, acconto_pagato: true, saldo_pagato: false, cliente: { nome: 'Cliente Finto', azienda: null } },
  { id: 'e2', numero_ordine: '2026-0002', titolo: 'Evento di prova B', tipo: 'Evento aziendale', stato: 'offerta', data_inizio: isoIn(20), data_fine: null, localita: 'Località Z', sala: null, paese: 'IT', ospiti: 40, servizi: [], importo_chf: 3400.5, acconto_pagato: false, saldo_pagato: false, cliente: null },
];
function isoIn(days, time) {
  const d = new Date(); d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${time ? `T${time}:00` : ''}`;
}
function detail(e, withMoney) {
  const ev = { ...e, programma: 'Riga 1\nRiga 2', note_interne: 'Nota interna di prova' };
  if (!withMoney) { delete ev.importo_chf; delete ev.acconto_pagato; delete ev.saldo_pagato; }
  return {
    evento: ev,
    staff: [{ staff_id: 's1', nome: 'Tecnico Finto', telefono: '+41000000000', ruolo_evento: 'luci' }],
    checklist: [{ id: 'c1', evento_id: e.id, voce: 'Teste mobili', quantita: 8, caricato: false, note: '' }],
  };
}
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(body) });

function apiMock(role, { leakMoney = false, overrides = {} } = {}) {
  const calls = [];
  const handler = async (route, req, url) => {
    const p = url.pathname.replace(/^\/api\//, '');
    const key = `${req.method()} ${p}`;
    calls.push({ key, headers: req.headers(), search: url.search });
    if (overrides[key]) return overrides[key](route, req, url);
    if (role === 'anon') return json(route, 401, { error: 'unauthorized' });
    const me = role === 'admin' ? { id: 'u-admin', nome: 'Admin Prova', ruolo: 'admin' } : { id: 'u-tec', nome: 'Tecnico Prova', ruolo: 'tecnico' };
    if (key === 'GET me') return json(route, 200, me);
    if (key === 'POST auth/logout') return json(route, 200, { ok: true });
    if (key === 'GET eventi') {
      const list = role === 'admin' || leakMoney ? EVENTI_ADMIN : EVENTI_ADMIN.map(({ importo_chf, acconto_pagato, saldo_pagato, ...rest }) => ({ ...rest, cliente: undefined, cliente_nome: rest.cliente && rest.cliente.nome }));
      return json(route, 200, { eventi: list });
    }
    const m = /^eventi\/([^/]+)$/.exec(p);
    if (m && req.method() === 'GET') {
      const e = EVENTI_ADMIN.find((x) => x.id === m[1]);
      if (!e) return json(route, 404, { error: 'not_found' });
      return json(route, 200, detail(e, role === 'admin' || leakMoney));
    }
    if (/^checklist\//.test(p) && req.method() === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      return json(route, 200, { voce: { id: 'c1', voce: 'Teste mobili', quantita: 8, caricato: !!body.caricato, note: body.note || '' } });
    }
    if (role !== 'admin') return json(route, 403, { error: 'forbidden' });
    if (key === 'GET richieste') return json(route, 200, { richieste: [] });
    if (key === 'GET clienti') return json(route, 200, { clienti: [] });
    if (key === 'GET staff') return json(route, 200, { staff: [] });
    return false;
  };
  return { handler, calls };
}

function apiHeaderCheck(label, log) {
  const api = log.requests.filter((r) => r.url.startsWith(`${BASE}/api/`));
  const bad = api.filter((r) => r.headers['x-requested-with'] !== 'meekon').map((r) => `${r.method} ${new URL(r.url).pathname}`);
  check(`${label}: ogni richiesta /api/ ha X-Requested-With: meekon (${api.length} richieste)`, bad.length === 0, bad.join(', '));
  check(`${label}: nessuna richiesta verso domini esterni`, log.external.length === 0, log.external.join(', '));
}

async function areaRiservata() {
  // ---- pagina di accesso
  currentGroup = 'Area riservata: accesso';
  {
    let loginResponse = { status: 401, body: { error: 'invalid_credentials' } };
    let loginBody = null;
    let loggedIn = false;
    const { context, page, log } = await openPage({
      apiHandler: async (route, req, url) => {
        if (url.pathname === '/api/me') return loggedIn ? json(route, 200, { id: 'u-admin', nome: 'Admin Prova', ruolo: 'admin' }) : json(route, 401, { error: 'unauthorized' });
        if (url.pathname === '/api/eventi') return json(route, 200, { eventi: [] });
        if (url.pathname === '/api/auth/login') { if (loginResponse.status === 200) loggedIn = true; loginBody = req.postData(); return json(route, loginResponse.status, loginResponse.body); }
        return false;
      },
    });
    await guard('login', async () => {
      const resp = await page.goto(`${BASE}/area-riservata/`);
      check('login: pagina 200 e resta sul login senza sessione (/api/me 401)', resp.status() === 200 && new URL(page.url()).pathname === '/area-riservata/', page.url());
      const meta = await page.evaluate(() => ({ robots: (document.querySelector('meta[name="robots"]') || {}).content || '', lang: document.documentElement.lang }));
      check('login: meta robots noindex', /noindex/.test(meta.robots), meta.robots);
      check('login: <html lang="it">', meta.lang === 'it', meta.lang);
      await a11yBasics(page, 'login');
      await checkLinks(page, 'login');
      await contrast(page, 'login');
      await focusVisible(page, 'login', 20);

      // campi vuoti → errore senza chiamare l'API
      await page.click('#login-form button[type="submit"]');
      const e1 = await page.evaluate(() => ({ vis: !document.getElementById('login-error').hidden, inv: document.getElementById('email').getAttribute('aria-invalid') }));
      check('login: campi vuoti → messaggio e email marcata, nessuna chiamata', e1.vis && e1.inv === 'true' && loginBody === null, JSON.stringify({ ...e1, loginBody }));

      await page.fill('#email', 'utente@example.com');
      await page.fill('#password', 'password-sbagliata');
      await page.click('#login-form button[type="submit"]');
      await page.waitForFunction(() => !document.getElementById('login-error').hidden && document.getElementById('login-error').textContent.length > 0);
      const e2 = await page.evaluate(() => ({ msg: document.getElementById('login-error').textContent, pw: document.getElementById('password').value, url: location.pathname }));
      check('login: 401 → "E-mail o password non corretti", password svuotata, resta sul login', /non corretti/.test(e2.msg) && e2.pw === '' && e2.url === '/area-riservata/', JSON.stringify(e2));
      check('login: invio JSON con email e password', /utente@example\.com/.test(loginBody || '') && /password-sbagliata/.test(loginBody || ''), loginBody);

      loginResponse = { status: 403, body: { error: 'forbidden' } };
      await page.fill('#password', 'x');
      await page.click('#login-form button[type="submit"]');
      await page.waitForFunction(() => /accesso/.test(document.getElementById('login-error').textContent));
      check('login: 403 forbidden → messaggio "non ha accesso"', /non ha accesso/.test(await page.textContent('#login-error')), await page.textContent('#login-error'));

      loginResponse = { status: 429, body: { error: 'too_many_requests' } };
      await page.fill('#password', 'x');
      await page.click('#login-form button[type="submit"]');
      await page.waitForFunction(() => /Troppi/.test(document.getElementById('login-error').textContent));
      check('login: 429 → messaggio "Troppi tentativi"', true);

      const over = await horizontalOverflow(page);
      check('login: nessuno scorrimento orizzontale (desktop)', !over, over);

      // 200 → gestionale
      loginResponse = { status: 200, body: { id: 'u-admin', nome: 'Admin Prova', ruolo: 'admin' } };
      await page.fill('#password', 'giusta');
      await Promise.all([page.waitForURL(`${BASE}/area-riservata/app.html`, { timeout: 5000 }), page.click('#login-form button[type="submit"]')]);
      check('login: 200 → /area-riservata/app.html', new URL(page.url()).pathname === '/area-riservata/app.html', page.url());
      const errs = unexpectedConsole(log, { allowApiStatus: true });
      check('login: nessun errore console inatteso / CSP', errs.length === 0 && log.pageErrors.length === 0 && log.csp.length === 0, fmtConsole(errs) + log.pageErrors.join('\n') + log.csp.join('\n'));
      apiHeaderCheck('login', log);
    });
    await context.close();
  }
  // login: errore di rete
  {
    const { context, page, log } = await openPage({
      apiHandler: async (route, req, url) => (url.pathname === '/api/me' ? json(route, 401, { error: 'unauthorized' }) : route.abort('failed')),
    });
    await guard('login rete', async () => {
      await page.goto(`${BASE}/area-riservata/`);
      await page.fill('#email', 'utente@example.com');
      await page.fill('#password', 'x');
      await page.click('#login-form button[type="submit"]');
      await page.waitForFunction(() => !document.getElementById('login-error').hidden);
      check('login: errore di rete → messaggio "Connessione non riuscita"', /Connessione non riuscita/.test(await page.textContent('#login-error')), await page.textContent('#login-error'));
      const errs = unexpectedConsole(log, { allowApiStatus: true });
      check('login (rete): nessun errore JS / CSP', errs.length === 0 && log.pageErrors.length === 0 && log.csp.length === 0, fmtConsole(errs) + log.pageErrors.join('\n') + log.csp.join('\n'));
    });
    await context.close();
  }
  // login già autenticato → gestionale
  {
    const { handler } = apiMock('admin');
    const { context, page } = await openPage({ apiHandler: handler });
    await guard('login con sessione', async () => {
      await page.goto(`${BASE}/area-riservata/`);
      await page.waitForURL(`${BASE}/area-riservata/app.html`, { timeout: 5000 });
      check('login: con sessione valida (/api/me 200) va direttamente al gestionale', true);
    });
    await context.close();
  }

  // ---- 401 sul gestionale
  currentGroup = 'Area riservata: accesso negato';
  {
    const { handler, calls } = apiMock('anon');
    const { context, page, log } = await openPage({ apiHandler: handler });
    await guard('app 401', async () => {
      await page.goto(`${BASE}/area-riservata/app.html#/eventi`);
      await page.waitForURL(`${BASE}/area-riservata/`, { timeout: 5000 });
      check('app.html senza sessione (401) → torna al login', new URL(page.url()).pathname === '/area-riservata/', page.url());
      check('app.html 401: nessuna chiamata oltre a /api/me', calls.filter((c) => !/^GET me$/.test(c.key)).length === 0, calls.map((c) => c.key).join(', '));
      const errs = unexpectedConsole(log, { allowApiStatus: true });
      check('app.html 401: nessun errore JS / CSP', errs.length === 0 && log.pageErrors.length === 0 && log.csp.length === 0, fmtConsole(errs) + log.pageErrors.join('\n') + log.csp.join('\n'));
    });
    await context.close();
  }
  // 403 su /api/me (account non dipendente / disattivato)
  {
    const { handler } = apiMock('admin', { overrides: { 'GET me': (route) => json(route, 403, { error: 'forbidden' }) } });
    const { context, page } = await openPage({ apiHandler: handler });
    await guard('app 403', async () => {
      await page.goto(`${BASE}/area-riservata/app.html`);
      await page.waitForURL(`${BASE}/area-riservata/`, { timeout: 5000 });
      check('app.html con /api/me 403 → torna al login', true);
    });
    await context.close();
  }
  // 500 su /api/me → messaggio e "Riprova", nessun dato
  {
    const { handler } = apiMock('admin', { overrides: { 'GET me': (route) => json(route, 500, { error: 'server_error' }) } });
    const { context, page } = await openPage({ apiHandler: handler });
    await guard('app 500', async () => {
      await page.goto(`${BASE}/area-riservata/app.html`);
      await page.locator('#main .alert--error').waitFor({ timeout: 5000 });
      const st = await page.evaluate(() => ({ msg: document.querySelector('#main .alert--error').textContent, nav: document.querySelectorAll('#nav a').length, btn: !!document.querySelector('#main button') }));
      check('app.html con /api/me 500 → messaggio d\'errore, nessun menu, pulsante Riprova', st.nav === 0 && st.btn && /server/.test(st.msg), JSON.stringify(st));
    });
    await context.close();
  }

  // ---- admin
  for (const vp of ['desktop', 'mobile']) {
    currentGroup = `Area riservata: amministratore @ ${vp}`;
    const { handler, calls } = apiMock('admin');
    const { context, page, log } = await openPage({ viewport: vp, apiHandler: handler });
    const L = `admin/${vp}`;
    await guard(L, async () => {
      await page.goto(`${BASE}/area-riservata/app.html`);
      await page.locator('#main table').waitFor({ timeout: 5000 });
      const meta = await page.evaluate(() => (document.querySelector('meta[name="robots"]') || {}).content || '');
      check(`${L}: meta robots noindex`, /noindex/.test(meta), meta);
      const st = await page.evaluate(() => ({
        nav: [...document.querySelectorAll('#nav a')].map((a) => a.textContent),
        user: document.getElementById('user').textContent,
        heads: [...document.querySelectorAll('#main thead th')].map((t) => t.textContent),
        rows: document.querySelectorAll('#main tbody tr').length,
        text: document.getElementById('main').innerText,
        nuovo: !!document.querySelector('a[href="#/eventi/nuovo"]'),
      }));
      check(`${L}: elenco prossimi eventi (2 righe) con colonna Importo CHF`, st.rows === 2 && st.heads.includes('Importo CHF') && /12'500\.00/.test(st.text), JSON.stringify(st.heads) + ` righe=${st.rows}`);
      check(`${L}: menu con Richieste e Clienti, utente mostrato`, st.nav.includes('Richieste dal sito') && st.nav.includes('Clienti') && /Admin Prova/.test(st.user), JSON.stringify(st));
      check(`${L}: pulsante "Nuovo evento" presente`, st.nuovo, 'assente');
      const q = calls.find((c) => c.key === 'GET eventi');
      check(`${L}: elenco richiesto con filtri da/a (AAAA-MM-GG)`, q && /da=\d{4}-\d{2}-\d{2}&a=\d{4}-\d{2}-\d{2}/.test(q.search), q && q.search);
      let over = await horizontalOverflow(page);
      check(`${L}: nessuno scorrimento orizzontale (elenco)`, !over, over);
      await shot(page, `admin-list-${vp}`);

      // dettaglio
      await page.click('#main a[href="#/evento/e1"]');
      await page.locator('#main h1', { hasText: 'Evento di prova A' }).waitFor({ timeout: 5000 });
      await page.locator('#main h2', { hasText: 'Checklist materiale' }).waitFor({ timeout: 5000 });
      const d = await page.evaluate(() => ({
        text: document.getElementById('main').innerText,
        buttons: [...document.querySelectorAll('#main button, #main a.btn')].map((b) => b.textContent.trim()),
        h2: [...document.querySelectorAll('#main h2')].map((h) => h.textContent),
      }));
      check(`${L}: dettaglio con Dati economici (CHF 12'500.00)`, d.h2.includes('Dati economici') && /CHF 12'500\.00/.test(d.text), JSON.stringify(d.h2));
      check(`${L}: dettaglio con pulsanti Modifica, Elimina, Modifica staff, Aggiungi voce`, ['Modifica', 'Elimina', 'Modifica staff', 'Aggiungi voce'].every((b) => d.buttons.includes(b)), JSON.stringify(d.buttons));
      check(`${L}: dettaglio con staff e checklist`, /Tecnico Finto/.test(d.text) && /Teste mobili/.test(d.text), d.text.slice(0, 300));
      over = await horizontalOverflow(page);
      check(`${L}: nessuno scorrimento orizzontale (dettaglio)`, !over, over);
      await a11yBasics(page, `${L} dettaglio`);
      if (vp === 'desktop') {
        await contrast(page, `${L} dettaglio`);
        await focusVisible(page, `${L} dettaglio`, 80);
      }
      await shot(page, `admin-detail-${vp}`);

      // spunta checklist → PATCH
      await page.locator('#main input[type="checkbox"][aria-label^="Caricato"]').first().check();
      await page.waitForTimeout(300);
      const patch = calls.find((c) => c.key === 'PATCH checklist/c1');
      check(`${L}: spunta checklist invia PATCH /api/checklist/c1`, !!patch, calls.map((c) => c.key).join(', '));

      // sezioni admin
      await page.evaluate(() => { location.hash = '#/richieste'; });
      await page.locator('#main h1', { hasText: 'Richieste' }).waitFor({ timeout: 5000 });
      check(`${L}: sezione Richieste accessibile`, true);

      const errs = unexpectedConsole(log, { allowApiStatus: true });
      check(`${L}: 0 errori console / CSP`, errs.length === 0 && log.pageErrors.length === 0 && log.csp.length === 0, fmtConsole(errs) + log.pageErrors.join('\n') + log.csp.join('\n'));
      check(`${L}: nessuna API non prevista dal mock`, log.apiUnhandled.length === 0, log.apiUnhandled.join(', '));
      apiHeaderCheck(L, log);
    });
    await context.close();
  }

  // ---- tecnico (anche se l'API sbagliasse e mandasse gli importi, l'interfaccia non li mostra)
  for (const leak of [false, true]) {
    currentGroup = `Area riservata: tecnico${leak ? ' (API che invia per errore gli importi)' : ''}`;
    const { handler, calls } = apiMock('tecnico', { leakMoney: leak });
    const { context, page, log } = await openPage({ viewport: leak ? 'desktop' : 'mobile', apiHandler: handler });
    const L = `tecnico${leak ? '+importi' : ''}`;
    await guard(L, async () => {
      await page.goto(`${BASE}/area-riservata/app.html#/eventi`);
      await page.locator('#main table').waitFor({ timeout: 5000 });
      const st = await page.evaluate(() => ({
        nav: [...document.querySelectorAll('#nav a')].map((a) => a.textContent),
        heads: [...document.querySelectorAll('#main thead th')].map((t) => t.textContent),
        text: document.getElementById('main').innerText,
        html: document.getElementById('main').innerHTML,
        nuovo: !!document.querySelector('a[href="#/eventi/nuovo"]'),
      }));
      check(`${L}: elenco eventi senza colonna Importo e senza cifre`, !st.heads.some((h) => /Importo/.test(h)) && !/12'500|3'400|CHF/.test(st.text), JSON.stringify(st.heads));
      check(`${L}: menu senza Richieste e Clienti, nessun "Nuovo evento"`, !st.nav.includes('Richieste dal sito') && !st.nav.includes('Clienti') && !st.nuovo, JSON.stringify(st.nav));

      await page.click('#main a[href="#/evento/e1"]');
      await page.locator('#main h2', { hasText: 'Checklist materiale' }).waitFor({ timeout: 5000 });
      const d = await page.evaluate(() => ({
        text: document.getElementById('main').innerText,
        buttons: [...document.querySelectorAll('#main button, #main a.btn')].map((b) => b.textContent.trim()),
        h2: [...document.querySelectorAll('#main h2')].map((h) => h.textContent),
        forms: document.querySelectorAll('#main form').length,
        cb: document.querySelectorAll('#main input[type="checkbox"]').length,
      }));
      check(`${L}: dettaglio senza Dati economici né importi`, !d.h2.includes('Dati economici') && !/12'500|CHF|Acconto|Saldo/.test(d.text), JSON.stringify(d.h2));
      const forbiddenBtns = d.buttons.filter((b) => /^(Modifica|Elimina|Modifica staff|Aggiungi voce|Nuovo evento)$/.test(b));
      check(`${L}: nessun pulsante di modifica (Modifica/Elimina/Modifica staff/Aggiungi voce)`, forbiddenBtns.length === 0 && d.forms === 0, `${forbiddenBtns.join(', ')} form=${d.forms}`);
      check(`${L}: può spuntare la checklist`, d.cb === 1, `checkbox=${d.cb}`);
      const over = await horizontalOverflow(page);
      check(`${L}: nessuno scorrimento orizzontale`, !over, over);
      await shot(page, `tecnico-detail-${leak ? 'leak' : 'ok'}`);

      // sezioni da amministratore → "Accesso non consentito" senza chiamare l'API
      for (const h of ['#/richieste', '#/clienti', '#/eventi/nuovo', '#/evento/e1/modifica']) {
        await page.evaluate((x) => { location.hash = x; }, h);
        await page.locator('#main h1', { hasText: 'Accesso non consentito' }).waitFor({ timeout: 3000 }).catch(() => {});
        const t = await page.textContent('#main h1');
        check(`${L}: ${h} → "Accesso non consentito"`, /Accesso non consentito/.test(t), t);
      }
      const adminCalls = calls.filter((c) => /^(GET|POST|PATCH|PUT|DELETE) (richieste|clienti|staff)/.test(c.key) || /^(POST|PATCH|DELETE|PUT) eventi/.test(c.key));
      check(`${L}: nessuna chiamata ad API da amministratore`, adminCalls.length === 0, adminCalls.map((c) => c.key).join(', '));

      // logout
      await page.evaluate(() => { location.hash = '#/prossimi'; });
      await page.locator('#nav button', { hasText: 'Esci' }).click();
      await page.waitForURL(`${BASE}/area-riservata/`, { timeout: 5000 });
      check(`${L}: "Esci" chiama POST /api/auth/logout e torna al login`, calls.some((c) => c.key === 'POST auth/logout'), calls.map((c) => c.key).join(', '));

      const errs = unexpectedConsole(log, { allowApiStatus: true });
      check(`${L}: 0 errori console / CSP`, errs.length === 0 && log.pageErrors.length === 0 && log.csp.length === 0, fmtConsole(errs) + log.pageErrors.join('\n') + log.csp.join('\n'));
      apiHeaderCheck(L, log);
    });
    await context.close();
  }

  // ---- errori delle API dentro il gestionale
  currentGroup = 'Area riservata: errori API';
  {
    const { handler } = apiMock('admin', {
      overrides: {
        'GET eventi': (route) => json(route, 500, { error: 'server_error' }),
        'GET eventi/e2': (route) => json(route, 403, { error: 'forbidden' }),
        'GET eventi/zz': (route) => json(route, 404, { error: 'not_found' }),
        'PATCH checklist/c1': (route) => json(route, 403, { error: 'forbidden' }),
      },
    });
    const { context, page, log } = await openPage({ apiHandler: handler });
    await guard('errori api', async () => {
      await page.goto(`${BASE}/area-riservata/app.html`);
      await page.locator('#main .alert--error').waitFor({ timeout: 5000 });
      check('elenco con 500 → messaggio d\'errore e pulsante Riprova', /server/.test(await page.textContent('#main .alert--error')) && await page.locator('#main button', { hasText: 'Riprova' }).isVisible(), await page.textContent('#main'));
      await page.evaluate(() => { location.hash = '#/evento/e2'; });
      await page.locator('#main .alert--error', { hasText: 'permessi' }).waitFor({ timeout: 5000 }).catch(() => {});
      check('dettaglio con 403 → "Non avete i permessi"', /permessi/.test(await page.textContent('#main')), await page.textContent('#main'));
      await page.evaluate(() => { location.hash = '#/evento/zz'; });
      await page.locator('#main .alert--error', { hasText: 'non trovato' }).waitFor({ timeout: 5000 }).catch(() => {});
      check('dettaglio con 404 → "Elemento non trovato"', /non trovato/.test(await page.textContent('#main')), await page.textContent('#main'));
      await page.evaluate(() => { location.hash = '#/evento/e1'; });
      await page.locator('#main h2', { hasText: 'Checklist materiale' }).waitFor({ timeout: 5000 });
      const cb = page.locator('#main input[type="checkbox"][aria-label^="Caricato"]').first();
      await cb.check();
      await page.locator('#toast').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(200);
      const st = { checked: await cb.isChecked(), toast: await page.textContent('#toast') };
      check('spunta checklist con 403 → torna non spuntata e notifica d\'errore', !st.checked && /permessi/.test(st.toast || ''), JSON.stringify(st));
      await page.evaluate(() => { location.hash = '#/inesistente'; });
      await page.waitForFunction(() => location.hash === '#/prossimi', null, { timeout: 3000 }).catch(() => {});
      check('route sconosciuta → #/prossimi', (await page.evaluate(() => location.hash)) === '#/prossimi', await page.evaluate(() => location.hash));
      const errs = unexpectedConsole(log, { allowApiStatus: true });
      check('errori API: nessun errore JS / CSP', errs.length === 0 && log.pageErrors.length === 0 && log.csp.length === 0, fmtConsole(errs) + log.pageErrors.join('\n') + log.csp.join('\n'));
      apiHeaderCheck('errori API', log);
    });
    await context.close();
  }
  // ---- rete assente nel gestionale
  {
    const { handler } = apiMock('admin', { overrides: { 'GET eventi': (route) => route.abort('failed') } });
    const { context, page, log } = await openPage({ apiHandler: handler });
    await guard('rete gestionale', async () => {
      await page.goto(`${BASE}/area-riservata/app.html`);
      await page.locator('#main .alert--error').waitFor({ timeout: 5000 });
      check('elenco senza rete → "Connessione non riuscita"', /Connessione non riuscita/.test(await page.textContent('#main .alert--error')), await page.textContent('#main'));
      check('rete assente: nessun errore JS / CSP', log.pageErrors.length === 0 && log.csp.length === 0, log.pageErrors.join('\n') + log.csp.join('\n'));
    });
    await context.close();
  }
}

// ------------------------------------------------------------------ 4. pagine statiche
async function staticPages() {
  currentGroup = 'Pagine 404 e grazie';
  const pages = [
    ['/404.html', 'it'],
    ...LANGS.map((L) => [L.thanks, L.lang]),
  ];
  for (const vp of ['desktop', 'mobile']) {
    for (const [p, lang] of pages) {
      const L = `${p} @ ${vp}`;
      const { context, page, log } = await openPage({ viewport: vp });
      await guard(L, async () => {
        const resp = await page.goto(BASE + p);
        check(`${L}: risponde 200`, resp.status() === 200, resp.status());
        const info = await page.evaluate(() => ({ lang: document.documentElement.lang, html: document.documentElement.outerHTML, robots: (document.querySelector('meta[name="robots"]') || {}).content || '' }));
        check(`${L}: lang="${lang}"`, info.lang === lang, info.lang);
        check(`${L}: nessun segnaposto {{ }}`, !/\{\{|\}\}/.test(info.html), '');
        check(`${L}: meta robots noindex`, /noindex/.test(info.robots), info.robots || 'assente');
        const over = await horizontalOverflow(page);
        check(`${L}: nessuno scorrimento orizzontale`, !over, over);
        if (vp === 'desktop') {
          await a11yBasics(page, L);
          await checkLinks(page, L);
          await contrast(page, L);
          await focusVisible(page, L, 20);
        }
        const errs = unexpectedConsole(log);
        check(`${L}: 0 errori console / CSP / richieste esterne`, errs.length === 0 && log.pageErrors.length === 0 && log.csp.length === 0 && log.external.length === 0, fmtConsole(errs) + log.pageErrors.join('\n') + log.csp.join('\n') + log.external.join('\n'));
      });
      await context.close();
    }
  }
  // 404.html servita da Netlify per un percorso annidato inesistente: le risorse devono avere percorsi assoluti
  {
    const deep = `${BASE}/una/cartella/inesistente`;
    const html = readFileSync(path.join(ROOT, '404.html'), 'utf8');
    const { context, page, log } = await openPage({
      extraRoutes: async (ctx) => {
        await ctx.route(deep, (route) => route.fulfill({ status: 404, contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': CSP }, body: html }));
      },
    });
    await guard('404 annidata', async () => {
      await page.goto(deep);
      const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
      const css = await page.evaluate(() => [...document.styleSheets].filter((s) => { try { return s.cssRules.length > 0; } catch { return false; } }).length);
      check('404 su percorso annidato: CSS e immagini caricati (percorsi assoluti)', broken.length === 0 && css > 0, `img rotte=${broken.join(', ')} css=${css}`);
      const errs = unexpectedConsole(log, { allowUrl: deep });
      check('404 su percorso annidato: 0 errori console / CSP', errs.length === 0 && log.pageErrors.length === 0 && log.csp.length === 0, fmtConsole(errs) + log.csp.join('\n'));
    });
    await context.close();
  }
}

// ------------------------------------------------------------------ 5. file di servizio
async function serviceFiles() {
  currentGroup = 'robots.txt e sitemap';
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  check('robots.txt: Disallow /area-riservata/', /Disallow:\s*\/area-riservata/.test(robots), robots);
  const sm = await fetch(`${BASE}/sitemap.xml`);
  const smText = await sm.text();
  check('sitemap.xml presente', sm.status === 200 && /<urlset/.test(smText), sm.status);
  check('sitemap.xml: le 4 lingue, nessuna area riservata', ['/', '/de/', '/fr/', '/en/'].every((p) => smText.includes(`meekondisplay.ch${p}<`)) && !/area-riservata/.test(smText), smText.slice(0, 600));
}

// ------------------------------------------------------------------ riepilogo
function summary() {
  const groups = [...new Set(results.map((r) => r.group))];
  let pass = 0; let fail = 0;
  console.log('\n================ COLLAUDO E2E — MEEKON DISPLAYS ================');
  for (const g of groups) {
    const rs = results.filter((r) => r.group === g);
    const f = rs.filter((r) => !r.ok);
    pass += rs.length - f.length; fail += f.length;
    console.log(`\n${f.length ? 'FALLITO' : 'OK     '}  ${g}  (${rs.length - f.length}/${rs.length})`);
    for (const r of f) {
      console.log(`   x ${r.name}`);
      if (r.detail) console.log(`       ${r.detail.split('\n').join('\n       ')}`);
    }
    if (process.env.E2E_VERBOSE) for (const r of rs.filter((x) => x.ok)) console.log(`   v ${r.name}`);
  }
  console.log(`\nTotale: ${pass} passati, ${fail} falliti, ${results.length} controlli.`);
  console.log(fail ? 'ESITO: FALLITO' : 'ESITO: TUTTO OK');
  return fail;
}

// ------------------------------------------------------------------ main
let server;
async function main() {
  build();
  server = await startServer();
  BASE = server.base;
  browser = await chromium.launch({ headless: true });
  const only = (process.env.E2E_ONLY || '').split(',').filter(Boolean);
  const suites = { selftest: selfTest, public: publicSite, form: formTests, area: areaRiservata, static: staticPages, service: serviceFiles };
  for (const [name, fn] of Object.entries(suites)) {
    if (only.length && !only.includes(name)) continue;
    currentGroup = `Suite ${name}`;
    await guard(`suite ${name}`, fn);
  }
}

const cleanup = async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) server.proc.kill();
};
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

main()
  .catch((err) => { currentGroup = 'Esecuzione'; check('la suite termina senza eccezioni', false, err && err.stack); })
  .finally(async () => {
    await cleanup();
    const fail = summary();
    process.exit(fail ? 1 : 0);
  });
