#!/usr/bin/env node
// Importa una volta i contenuti di data/*.json (e i relativi file in assets/) nel CMS su Supabase.
// Zero dipendenze. Lo esegue l'amministratore dal proprio computer:
//
//   SUPABASE_URL=https://<progetto>.supabase.co SUPABASE_ANON_KEY=<anon> node scripts/importa-dati.mjs [--prova] [--forza]
//
//   --prova   mostra cosa verrebbe importato, senza login e senza scrivere nulla
//   --forza   importa anche se le tabelle contengono già dati
//
// E-mail e password dell'admin vengono chieste dal terminale (la password non
// viene mostrata), usate solo per il login e mai salvate né stampate.
// Si importano solo le voci con "approvato": true (pubblicate); le voci di
// esempio "— da inserire" e le altre bozze vanno inserite dall'area riservata.

import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = new Set(process.argv.slice(2));
const PROVA = ARGS.has('--prova');
const FORZA = ARGS.has('--forza');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4' };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' };
const MAX = { 'image/jpeg': 10 << 20, 'image/png': 10 << 20, 'image/webp': 10 << 20, 'video/mp4': 200 << 20 };
const LINGUE = ['it', 'de', 'fr', 'en'];
const LINK_RE = /^https:\/\/[^\s"'<>\\]+$/;

function esci(msg) {
  console.error(`Errore: ${msg}`);
  process.exit(1);
}

function config() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) esci('imposta SUPABASE_URL e SUPABASE_ANON_KEY nell\'ambiente (non nel codice).');
  let u;
  try {
    u = new URL(url);
  } catch {
    esci('SUPABASE_URL non valida.');
  }
  if (u.protocol !== 'https:') esci('SUPABASE_URL deve iniziare con https://');
  return { base: u.origin, key };
}

function chiedi(domanda, { nascosto = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (nascosto) {
      // Non ripete sullo schermo i caratteri digitati.
      rl._writeToOutput = (s) => {
        if (s.startsWith(domanda)) rl.output.write(domanda);
      };
    }
    rl.question(domanda, (risposta) => {
      rl.close();
      if (nascosto) process.stdout.write('\n');
      resolve(risposta);
    });
  });
}

async function leggiJson(nome) {
  const rows = JSON.parse(await readFile(path.join(ROOT, 'data', `${nome}.json`), 'utf8'));
  if (!Array.isArray(rows)) esci(`data/${nome}.json deve essere un elenco.`);
  return rows.filter((r) => r && typeof r === 'object' && r.approvato === true && !/da inserire/i.test(String(r.nome || '')));
}

/** File locale del sito: solo sotto assets/, nessun "..", tipo e dimensione ammessi. */
async function fileLocale(rel) {
  if (typeof rel !== 'string' || !/^assets\/[A-Za-z0-9._/-]+$/.test(rel) || rel.includes('..')) {
    throw new Error(`percorso non ammesso: ${rel}`);
  }
  const abs = path.resolve(ROOT, rel);
  if (!abs.startsWith(path.join(ROOT, 'assets') + path.sep)) throw new Error(`percorso non ammesso: ${rel}`);
  const mime = MIME[path.extname(abs).toLowerCase()];
  if (!mime) throw new Error(`tipo di file non ammesso: ${rel}`);
  const st = await stat(abs);
  if (!st.isFile() || st.size > MAX[mime]) throw new Error(`file mancante o troppo grande: ${rel}`);
  return { abs, mime, size: st.size };
}

function testo(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function link(v) {
  if (v == null) return null;
  if (typeof v !== 'string' || !LINK_RE.test(v) || v.length > 500) throw new Error('link non valido (solo https://)');
  return v;
}

function createClient({ base, key }) {
  let token = null;
  const headers = (extra = {}) => ({ apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra });

  async function call(url, init) {
    const res = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(120_000) });
    const text = await res.text();
    if (!res.ok) {
      // Solo lo stato HTTP e il codice d'errore: mai token o corpo completo.
      let code = '';
      try {
        code = JSON.parse(text).code || JSON.parse(text).statusCode || '';
      } catch { /* ignora */ }
      throw new Error(`richiesta rifiutata (HTTP ${res.status}${code ? `, ${code}` : ''})`);
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    async login(email, password) {
      const data = await call(`${base}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email, password }),
      }).catch(() => null);
      if (!data || typeof data.access_token !== 'string') esci('login non riuscito.');
      token = data.access_token;
      return data.user && data.user.id;
    },
    async logout() {
      if (!token) return;
      await fetch(`${base}/auth/v1/logout?scope=local`, { method: 'POST', headers: headers() }).catch(() => {});
      token = null;
    },
    rest: (p, { method = 'GET', body } = {}) =>
      call(`${base}/rest/v1/${p}`, {
        method,
        headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    async upload(file, cartella) {
      const dest = `${cartella}/${randomUUID()}.${EXT[file.mime]}`;
      const body = await readFile(file.abs);
      await call(`${base}/storage/v1/object/media/${dest}`, {
        method: 'POST',
        headers: headers({ 'Content-Type': file.mime, 'x-upsert': 'false' }),
        body,
      });
      return dest;
    },
  };
}

async function main() {
  const cfg = config();
  const galleria = await leggiJson('galleria');
  const sale = await leggiJson('sale');
  const dj = await leggiJson('dj');
  const partner = await leggiJson('partner');
  console.log(`Da importare (solo voci approvate): galleria ${galleria.length}, sale ${sale.length}, DJ ${dj.length}, partner ${partner.length}.`);

  // Controllo preliminare di tutti i file, prima di scrivere qualsiasi cosa.
  for (const r of galleria) {
    await fileLocale(r.file);
    if (r.poster) await fileLocale(r.poster);
  }
  for (const r of dj) if (r.foto) await fileLocale(r.foto);
  for (const r of partner) if (r.logo) await fileLocale(r.logo);
  if (PROVA) {
    console.log('Modalità prova: nessun login, nessuna scrittura.');
    return;
  }

  const sb = createClient(cfg);
  const email = (await chiedi('E-mail amministratore: ')).trim();
  const password = await chiedi('Password: ', { nascosto: true });
  const uid = await sb.login(email, password);
  try {
    const me = await sb.rest(`staff?id=eq.${encodeURIComponent(uid)}&select=ruolo,attivo`);
    if (!Array.isArray(me) || me[0]?.ruolo !== 'admin' || me[0]?.attivo !== true) throw new Error('l\'utente non è un amministratore attivo.');

    if (!FORZA) {
      for (const t of ['media_galleria', 'sale', 'dj', 'partner']) {
        const rows = await sb.rest(`${t}?select=id&limit=1`);
        if (rows.length) throw new Error(`la tabella ${t} contiene già dati: importazione annullata (usa --forza per continuare).`);
      }
    }

    let ordine = 10;
    for (const r of galleria) {
      const file_path = await sb.upload(await fileLocale(r.file), 'galleria');
      const poster_path = r.tipo === 'video' && r.poster ? await sb.upload(await fileLocale(r.poster), 'galleria') : null;
      const alt = r.alt || {};
      await sb.rest('media_galleria', {
        method: 'POST',
        body: {
          file_path, poster_path, tipo: r.tipo, categoria: r.categoria, formato: r.formato || 'wide',
          ...Object.fromEntries(LINGUE.map((l) => [`alt_${l}`, testo(alt[l], 300)])),
          ordine, pubblicato: true,
        },
      });
      ordine += 10;
      console.log(`  galleria: ${r.file} importato`);
    }
    ordine = 10;
    for (const r of sale) {
      const tipo = r.tipo || {};
      await sb.rest('sale', {
        method: 'POST',
        body: {
          nome: testo(r.nome, 160), luogo: testo(r.luogo, 160), paese: r.paese || 'CH',
          ...Object.fromEntries(LINGUE.map((l) => [`tipo_${l}`, testo(tipo[l], 120)])),
          ordine, pubblicato: true,
        },
      });
      ordine += 10;
    }
    ordine = 10;
    for (const r of dj) {
      const genere = r.genere || {};
      const foto_path = r.foto ? await sb.upload(await fileLocale(r.foto), 'dj') : null;
      await sb.rest('dj', {
        method: 'POST',
        body: {
          nome: testo(r.nome, 120), foto_path, link: link(r.link),
          ...Object.fromEntries(LINGUE.map((l) => [`genere_${l}`, testo(genere[l], 120)])),
          ordine, pubblicato: true,
        },
      });
      ordine += 10;
    }
    ordine = 10;
    for (const r of partner) {
      const logo_path = r.logo ? await sb.upload(await fileLocale(r.logo), 'partner') : null;
      await sb.rest('partner', {
        method: 'POST',
        body: { nome: testo(r.nome, 120), logo_path, link: link(r.link), ordine, pubblicato: true },
      });
      ordine += 10;
    }
    console.log('Importazione completata. Controllate i contenuti nell\'area riservata e premete "Pubblica sul sito".');
  } finally {
    await sb.logout();
  }
}

main().catch((err) => esci(err && err.message ? err.message : 'errore inatteso'));
