// POST /api/utenti-invito — un amministratore aggiunge una persona al gestionale (nome, e-mail, ruolo, lingua).
// Il lavoro con la chiave di servizio lo fa la Supabase Edge Function "invita-utente" (la chiave resta in Supabase):
// qui si valida, si passa il token dell'admin e si restituisce il link di invito da mandare alla persona.
// La persona apre il link, sceglie la password su /area-riservata/password.html e poi entra normalmente.
import { RUOLI } from './_lib/auth.js';
import { createHandler } from './_lib/handler.js';
import { HttpError, json, readJson } from './_lib/http.js';
import { t, validate } from './_lib/validate.js';

export const config = { path: '/api/utenti-invito' };

const invitoSchema = {
  nome: t.string({ max: 120, required: true }),
  email: t.email({ required: true }),
  ruolo: t.enumOf(RUOLI, { required: true }),
  lingua: t.enumOf(['it', 'de', 'en'], { default: 'it', empty: 'it' }),
};

export default createHandler(
  {
    POST: {
      auth: 'admin',
      async fn({ req, env, sb, token }) {
        const d = validate(await readJson(req, { maxBytes: 4 * 1024 }), invitoSchema);
        // il link porta alla pagina per scegliere la password sullo stesso sito da cui si invita
        const origin = (req.headers.get('origin') || '').replace(/\/+$/, '');
        if (!env.allowedOrigins.includes(origin)) throw new HttpError(403, 'forbidden');
        const { status, data } = await sb.edge('invita-utente', {
          token,
          body: { ...d, email: d.email.toLowerCase(), redirect_to: `${origin}/area-riservata/password.html` },
        });
        if (status === 201 && data && typeof data.link === 'string') return json(201, { id: data.id, link: data.link });
        if (status === 409) throw new HttpError(409, 'conflict', { field: 'email' });
        if (status === 400) throw new HttpError(400, 'invalid_input', data && data.field ? { field: data.field } : undefined);
        if (status === 401 || status === 403) throw new HttpError(403, 'forbidden');
        throw new HttpError(502, 'upstream_error');
      },
    },
  },
  { pattern: /^\/api\/utenti-invito\/?$/ },
);
