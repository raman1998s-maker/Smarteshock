// Supabase Edge Function "invita-utente": un amministratore aggiunge una persona al gestionale.
// - Chi chiama deve essere un admin attivo (controllato con il SUO token, quindi con la RLS).
// - Crea l'account con un link di invito (generate_link, nessuna e-mail inviata da Supabase:
//   l'admin manda il link via WhatsApp o e-mail) e la riga in public.staff con nome e ruolo.
//   Se l'e-mail ha già un account (es. link precedente scaduto o aperto da altri), genera un link
//   per scegliere una nuova password (recovery) e completa la riga staff se manca.
// - Il link porta direttamente alla nostra pagina con il "token hash" (?th=…&t=…): il token si consuma
//   solo quando la persona salva la password, non quando un'app di chat apre il link per l'anteprima.
// - La chiave service_role è quella che Supabase mette da sé nelle Edge Functions:
//   non sta nel repository, non sta su Netlify, non arriva mai al browser.
// Chiamata solo dalla Netlify Function /api/utenti-invito (Authorization: Bearer <JWT dell'admin>).

const RUOLI = ['admin', 'ufficio', 'tecnico', 'base', 'partner'];
const LINGUE = ['it', 'de', 'en']; // come staff.lingua
// Pagine a cui può puntare il link (la stessa lista va in Authentication → URL Configuration → Redirect URLs).
const REDIRECT_OK = /^https:\/\/(meekondisplay\.netlify\.app|(www\.)?meekondisplay\.ch)\/area-riservata\/password\.html$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const URL_SB = Deno.env.get('SUPABASE_URL') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const risposta = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function sb(path: string, init: RequestInit & { key: string; token?: string }) {
  const headers: Record<string, string> = { apikey: init.key, Authorization: `Bearer ${init.token ?? init.key}`, 'Content-Type': 'application/json' };
  const res = await fetch(`${URL_SB}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) } });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return risposta(405, { error: 'method_not_allowed' });
  if (!URL_SB || !ANON || !SERVICE) return risposta(500, { error: 'server_misconfigured' });
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return risposta(401, { error: 'unauthorized' });

  // 1. chi chiama è un admin attivo? (con il suo token: vale la RLS)
  const me = await sb('/auth/v1/user', { method: 'GET', key: ANON, token });
  const myId = me.ok && me.data && typeof me.data.id === 'string' ? me.data.id : null;
  if (!myId) return risposta(401, { error: 'unauthorized' });
  const prof = await sb(`/rest/v1/staff?id=eq.${myId}&select=ruolo,attivo`, { method: 'GET', key: ANON, token });
  const io = Array.isArray(prof.data) && prof.data.length === 1 ? prof.data[0] : null;
  if (!io || io.ruolo !== 'admin' || io.attivo !== true) return risposta(403, { error: 'forbidden' });

  // 2. dati
  let body: any;
  try { body = await req.json(); } catch { return risposta(400, { error: 'invalid_input' }); }
  const nome = typeof body?.nome === 'string' ? body.nome.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const ruolo = body?.ruolo;
  const lingua = body?.lingua ?? 'it';
  const redirectTo = body?.redirect_to;
  if (!nome || nome.length > 120) return risposta(400, { error: 'invalid_input', field: 'nome' });
  if (!EMAIL_RE.test(email) || email.length > 254) return risposta(400, { error: 'invalid_input', field: 'email' });
  if (!RUOLI.includes(ruolo)) return risposta(400, { error: 'invalid_input', field: 'ruolo' });
  if (!LINGUE.includes(lingua)) return risposta(400, { error: 'invalid_input', field: 'lingua' });
  if (typeof redirectTo !== 'string' || !REDIRECT_OK.test(redirectTo)) return risposta(400, { error: 'invalid_input', field: 'redirect_to' });

  // 3. account + link di invito; se l'e-mail ha già un account → link per una nuova password
  const genera = (type: string) => sb('/auth/v1/admin/generate_link', {
    method: 'POST', key: SERVICE,
    body: JSON.stringify({ type, email, redirect_to: redirectTo, ...(type === 'invite' ? { data: { nome } } : {}) }),
  });
  let tipo = 'invite';
  let link = await genera(tipo);
  if (!link.ok) {
    const msg = JSON.stringify(link.data ?? '').toLowerCase();
    if (!(link.status === 422 || msg.includes('already') || msg.includes('exists'))) return risposta(502, { error: 'upstream_error' });
    tipo = 'recovery';
    link = await genera(tipo);
    if (!link.ok) return risposta(502, { error: 'upstream_error' });
  }
  const user = link.data?.user ?? link.data;
  const userId = typeof user?.id === 'string' ? user.id : null;
  const hash = link.data?.properties?.hashed_token ?? link.data?.hashed_token ?? null;
  if (!userId || typeof hash !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(hash)) return risposta(502, { error: 'upstream_error' });
  const nuovoLink = `${redirectTo}?th=${encodeURIComponent(hash)}&t=${tipo}`;

  // 4. riga in staff (con la chiave di servizio: la RLS non permette insert agli utenti)
  const esiste = await sb(`/rest/v1/staff?id=eq.${userId}&select=id`, { method: 'GET', key: SERVICE });
  if (!(Array.isArray(esiste.data) && esiste.data.length === 1)) {
    const staff = await sb('/rest/v1/staff', {
      method: 'POST', key: SERVICE, headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ id: userId, nome, ruolo, lingua, attivo: true }),
    });
    if (!staff.ok) {
      // niente account nuovo senza riga staff: si annulla l'invito
      if (tipo === 'invite') await sb(`/auth/v1/admin/users/${userId}`, { method: 'DELETE', key: SERVICE });
      return risposta(502, { error: 'upstream_error' });
    }
  }
  return risposta(201, { id: userId, link: nuovoLink, gia_registrato: tipo === 'recovery' });
});
