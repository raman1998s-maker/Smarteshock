# Architettura

## Stack
| Parte | Tecnologia |
|---|---|
| Sito pubblico | HTML/CSS/JS statico, generato da `build.py` (template + `src/i18n/*.json` + `data/*.json`) |
| Hosting | Netlify |
| API | Netlify Functions (Node 18+, ESM, **nessuna dipendenza npm a runtime**: solo `fetch`) in `netlify/functions/` |
| Database e login | Supabase (Postgres + Auth), schema in `supabase/migrations/` |
| Area riservata | `/area-riservata/` — pagine statiche che parlano **solo** con `/api/*` |

Il browser **non parla mai direttamente con Supabase** e non riceve nessuna chiave.

```
Browser ──(cookie HttpOnly)──> /api/* (Netlify Functions) ──(chiave da env + JWT utente)──> Supabase
```

## Variabili d'ambiente (solo su Netlify, mai nel repo)
| Nome | Uso |
|---|---|
| `SUPABASE_URL` | URL del progetto Supabase |
| `SUPABASE_ANON_KEY` | Chiave anon, usata **solo lato server** insieme al JWT dell'utente (così la RLS si applica sempre) |
| `ALLOWED_ORIGIN` | Es. `https://meekondisplay.ch` — le richieste con `Origin` diverso vengono rifiutate |

La `service_role` key **non si usa** in nessuna function.
`.env.example` elenca i nomi delle variabili senza valori.

## Autenticazione
1. `POST /api/auth/login` `{email, password}` → la function chiama Supabase Auth (`/auth/v1/token?grant_type=password`).
2. La risposta imposta due cookie: `mk_at` (access token) e `mk_rt` (refresh token), entrambi `HttpOnly; Secure; SameSite=Strict; Path=/api`.
3. Ogni chiamata successiva: la function legge il cookie, inoltra a Supabase `Authorization: Bearer <jwt utente>` + `apikey: <anon>`. Se l'access token è scaduto usa il refresh token e rinnova i cookie.
4. Protezione CSRF: `SameSite=Strict` + controllo dell'header `Origin` (deve essere `ALLOWED_ORIGIN`) su ogni richiesta che modifica dati + header obbligatorio `X-Requested-With: meekon`.
5. `POST /api/auth/logout` cancella i cookie e revoca la sessione.
6. Gli account dei dipendenti li crea l'amministratore dalla dashboard Supabase (nessuna registrazione pubblica).

## Modello dati (Postgres, schema `public`)
| Tabella | Campi principali |
|---|---|
| `staff` | `id` (= `auth.users.id`), `nome`, `ruolo` (`admin` \| `tecnico`), `telefono`, `attivo` |
| `clienti` | `id`, `nome`, `azienda`, `email`, `telefono`, `lingua`, `note`, `created_at` |
| `eventi` | `id`, `numero_ordine` (unico), `cliente_id`, `titolo`, `tipo`, `stato` (`richiesta` → `offerta` → `confermato` → `completato` / `annullato`), `data_inizio`, `data_fine`, `localita`, `sala`, `paese` (`CH`,`IT`,`DE`,`FR`), `ospiti`, `servizi` (text[]), `programma`, `note_interne`, `importo_chf`, `acconto_pagato`, `saldo_pagato`, `created_at`, `updated_at` |
| `eventi_staff` | `evento_id`, `staff_id`, `ruolo_evento` (es. tecnico audio, luci, video) |
| `checklist` | `id`, `evento_id`, `voce`, `quantita`, `caricato` (bool), `note` |
| `richieste_web` | `id`, `nome`, `email`, `telefono`, `tipo`, `data`, `localita`, `ospiti`, `servizi`, `messaggio`, `lingua`, `stato` (`nuova`/`gestita`/`scartata`), `created_at` |

### Row Level Security (attiva su tutte le tabelle)
- **admin**: lettura e scrittura su tutto.
- **tecnico**: legge solo gli eventi a cui è assegnato (via `eventi_staff`) e i relativi clienti (solo nome/telefono), può aggiornare solo `checklist.caricato` e `checklist.note` di quegli eventi. Non vede `importo_chf`, `acconto_pagato`, `saldo_pagato` (vista `eventi_tecnico` senza campi economici).
- **anon**: solo `INSERT` su `richieste_web` (nessuna lettura).
- Funzione helper `public.is_admin()` `SECURITY DEFINER` con `search_path` fissato.

## API (`/api/*` → `netlify/functions/*`)
Tutte rispondono JSON. Errori: `{ "error": "codice" }` con status HTTP corretto, mai stack trace.

| Metodo e percorso | Chi | Descrizione |
|---|---|---|
| `POST /api/auth/login` | pubblico | login, imposta i cookie |
| `POST /api/auth/logout` | utente | logout |
| `GET /api/me` | utente | profilo `{id, nome, ruolo}` |
| `GET /api/eventi?da=&a=&stato=` | utente | elenco (admin: tutti; tecnico: assegnati, senza importi) |
| `POST /api/eventi` | admin | crea evento |
| `GET /api/eventi/:id` | utente | dettaglio + staff + checklist |
| `PATCH /api/eventi/:id` | admin | modifica |
| `DELETE /api/eventi/:id` | admin | elimina |
| `PUT /api/eventi/:id/staff` | admin | assegna dipendenti |
| `POST /api/eventi/:id/checklist` | admin | aggiunge voce |
| `PATCH /api/checklist/:id` | utente assegnato | spunta caricato / note |
| `GET /api/clienti`, `POST /api/clienti`, `PATCH /api/clienti/:id` | admin | clienti |
| `GET /api/staff` | admin | elenco dipendenti |
| `GET /api/richieste`, `PATCH /api/richieste/:id` | admin | richieste dal sito |
| `POST /api/richieste/:id/converti` | admin | crea cliente + evento da una richiesta |
| `POST /api/richiesta` | pubblico | modulo del sito (honeypot, limiti di lunghezza, validazione) |

## Contenuti pubblici gestiti da file
`data/sale.json` (location dove abbiamo lavorato), `data/dj.json` (DJ con cui collaboriamo), `data/partner.json` (partner), `data/galleria.json` (foto e video). Ogni voce ha `"approvato": true|false`; `build.py` pubblica solo le voci approvate.

## Pagine
- `/`, `/de/`, `/fr/`, `/en/` — sito pubblico
- `/{lingua}/grazie.html` — conferma richiesta
- `/area-riservata/` — login · `/area-riservata/app.html` — gestionale (noindex)
