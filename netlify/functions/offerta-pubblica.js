// Offerta vista e accettata dal cliente online (pubblico, senza login).
// GET  /api/offerta-pubblica?t=<token>   riepilogo dell'offerta (nessun dato interno)
// POST /api/offerta-pubblica              { t, nome, agb: true, annullamento: true, foto?: bool }
// L'accesso è solo il token segreto (48 caratteri esadecimali) del link inviato al cliente.
// Supabase si chiama con il ruolo anon (chiave solo sul server): le due funzioni SQL
// offerta_pubblica() e accetta_offerta_online() sono le sole cose che anon può fare qui.
// Si registrano nome, data/ora, IP e versione delle AGB.
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { t, validate } from './_lib/validate.js';

export const config = { path: '/api/offerta-pubblica' };

const TOKEN_RE = /^[0-9a-f]{48}$/;
const accettaSchema = {
  t: t.string({ max: 48, required: true, pattern: TOKEN_RE }),
  nome: t.string({ min: 2, max: 120, required: true }),
  agb: t.bool({ required: true }),
  annullamento: t.bool({ required: true }),
  foto: t.bool({ default: false, empty: false }),
};

function ipCliente(req) {
  const ip = req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0];
  return (ip || '').trim().slice(0, 64) || null;
}

export default createHandler(
  {
    GET: {
      auth: 'public',
      async fn({ url, sb }) {
        const tok = url.searchParams.get('t') || '';
        if (!TOKEN_RE.test(tok)) throw new HttpError(404, 'not_found');
        const dati = await sb.rest('rpc/offerta_pubblica', { method: 'POST', body: { p_token: tok } });
        if (!dati) throw new HttpError(404, 'not_found');
        return json(200, { offerta: dati });
      },
    },
    POST: {
      auth: 'public',
      async fn({ req, sb }) {
        const d = validate(await readJson(req), accettaSchema);
        // le due caselle obbligatorie devono essere spuntate
        if (d.agb !== true) throw new HttpError(400, 'invalid_input', { field: 'agb' });
        if (d.annullamento !== true) throw new HttpError(400, 'invalid_input', { field: 'annullamento' });
        const r = await sb.rest('rpc/accetta_offerta_online', {
          method: 'POST',
          body: { p_token: d.t, p_nome: d.nome, p_foto: d.foto, p_ip: ipCliente(req) },
        });
        return json(200, { ok: true, accettata_il: r?.accettata_il ?? null });
      },
    },
  },
  { pattern: /^\/api\/offerta-pubblica\/?$/ },
);
