// Pubblicazione del sito (solo admin).
//   POST /api/pubblica       → registra la richiesta (max 1 ogni 2 minuti) e chiama il build hook di Netlify
//   GET  /api/pubblicazioni  → ultime 20 pubblicazioni con esito
// L'URL del build hook (NETLIFY_BUILD_HOOK) è segreto: mai restituito né loggato.
import { getBuildHook } from './_lib/env.js';
import { createHandler } from './_lib/handler.js';
import { HttpError, json } from './_lib/http.js';

export const config = { path: ['/api/pubblica', '/api/pubblicazioni'] };

const HOOK_TIMEOUT_MS = 8000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function chiamaBuildHook(hookUrl) {
  const url = `${hookUrl}?trigger_title=${encodeURIComponent('Pubblicazione dall\'area riservata')}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
    });
    await res.text().catch(() => '');
    return res.ok;
  } catch {
    return false;
  }
}

const pubblica = createHandler(
  {
    POST: {
      auth: 'admin',
      async fn({ sb, token }) {
        // Prima la configurazione: se manca il build hook non si registra nulla.
        const hook = getBuildHook();

        const reg = await sb.rest('rpc/registra_pubblicazione', { method: 'POST', token, body: {} });
        if (!reg || typeof reg !== 'object') throw new HttpError(502, 'upstream_error');
        if (reg.limite === true) {
          const attesa = Number.isInteger(reg.attesa_secondi) ? Math.min(Math.max(reg.attesa_secondi, 1), 120) : 120;
          return json(429, { error: 'too_many_requests', attesa_secondi: attesa }, { headers: { 'Retry-After': String(attesa) } });
        }
        if (typeof reg.id !== 'string' || !UUID_RE.test(reg.id)) throw new HttpError(502, 'upstream_error');

        const ok = await chiamaBuildHook(hook);
        const esito = ok ? 'avviata' : 'errore';
        try {
          await sb.rest(`pubblicazioni?id=eq.${reg.id}`, { method: 'PATCH', token, body: { esito } });
        } catch {
          // L'esito non registrato non cambia la risposta (la riga resta "in_corso").
          console.error('[api] pubblica: esito non registrato');
        }
        if (!ok) throw new HttpError(502, 'upstream_error');
        return json(202, { ok: true, pubblicazione: { id: reg.id, created_at: reg.created_at ?? null, esito } });
      },
    },
  },
  { pattern: /^\/api\/pubblica\/?$/ },
);

const elenco = createHandler(
  {
    GET: {
      auth: 'admin',
      async fn({ sb, token }) {
        const rows = await sb.rest(
          'pubblicazioni?select=id,created_at,esito,staff(nome)&order=created_at.desc&limit=20',
          { token },
        );
        const pubblicazioni = (Array.isArray(rows) ? rows : []).map((r) => ({
          id: r.id,
          created_at: r.created_at,
          esito: r.esito,
          richiesta_da: r.staff && typeof r.staff.nome === 'string' ? r.staff.nome : null,
        }));
        return json(200, { pubblicazioni });
      },
    },
  },
  { pattern: /^\/api\/pubblicazioni\/?$/ },
);

export default function handler(req) {
  let pathname = '';
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    /* il gestore risponde 404 */
  }
  return /^\/api\/pubblicazioni\/?$/.test(pathname) ? elenco(req) : pubblica(req);
}
