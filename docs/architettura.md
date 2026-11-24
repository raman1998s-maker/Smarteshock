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
| `ALLOWED_ORIGIN` | Es. `https://meekondisplay.ch` — le richieste con `Origin` diverso vengono rifiutate (più origin separati da virgola, es. con `www.`) |

La `service_role` key **non si usa** in nessuna function.
`.env.example` elenca i nomi delle variabili senza valori.

## Autenticazione
1. `POST /api/auth/login` `{email, password}` → la function chiama Supabase Auth (`/auth/v1/token?grant_type=password`).
2. La risposta imposta due cookie: `mk_at` (access token) e `mk_rt` (refresh token), entrambi `HttpOnly; Secure; SameSite=Strict; Path=/api`.
3. Ogni chiamata successiva: la function legge il cookie, inoltra a Supabase `Authorization: Bearer <jwt utente>` + `apikey: <anon>`. Se l'access token è scaduto usa il refresh token e rinnova i cookie.
4. Protezione CSRF: `SameSite=Strict` + controllo dell'header `Origin` (deve essere `ALLOWED_ORIGIN`) su ogni richiesta che modifica dati + header obbligatorio `X-Requested-With: meekon`.
5. `POST /api/auth/logout` cancella i cookie e revoca la sessione (funziona anche con sessione già scaduta).
6. Gli account dei dipendenti li crea l'amministratore dalla dashboard Supabase (nessuna registrazione pubblica).
7. Dettagli d'implementazione: la function legge `exp`/`sub` dal JWT solo per sapere se rinnovarlo; la firma la verifica Supabase a ogni chiamata (un token falso → 401). Il ruolo si legge da `public.staff` (riga mancante o `attivo = false` → 403). Cookie: `mk_at` dura quanto il token (≈1 h), `mk_rt` 7 giorni.
8. Le richieste con corpo devono avere `Content-Type: application/json` (altrimenti 415); limite 16 KB.

## Modello dati (Postgres, schema `public`)
| Tabella | Campi principali |
|---|---|
| `staff` | `id` (= `auth.users.id`), `nome`, `ruolo` (`admin` \| `tecnico`), `telefono`, `attivo` |
| `clienti` | `id`, `nome`, `azienda`, `email`, `telefono`, `lingua`, `note`, `created_at` |
| `eventi` | `id`, `numero_ordine` (unico), `cliente_id`, `titolo`, `tipo`, `stato` (`richiesta` → `offerta` → `confermato` → `completato` / `annullato`), `data_inizio`, `data_fine`, `localita`, `sala`, `paese` (`CH`,`IT`,`DE`,`FR`), `ospiti`, `servizi` (text[]), `programma`, `note_interne`, `importo_chf`, `acconto_pagato`, `saldo_pagato`, `created_at`, `updated_at` |
| `eventi_staff` | `evento_id`, `staff_id`, `ruolo_evento` (es. tecnico audio, luci, video) |
| `checklist` | `id`, `evento_id`, `voce`, `quantita`, `caricato` (bool), `note` |
| `richieste_web` | `id`, `nome`, `email`, `telefono`, `tipo`, `data`, `localita`, `ospiti`, `servizi`, `messaggio`, `lingua`, `paese` (`CH`,`IT`,`DE`,`FR`, facoltativo; migrazione `0002`), `stato` (`nuova`/`gestita`/`scartata`), `evento_id` (evento creato con "converti"), `created_at` |

Note sul modello (schema reale in `supabase/migrations/0001_schema.sql`):
- Tutte le tabelle modificabili hanno anche `updated_at` (trigger). `numero_ordine` è generato dal DB (`AAAA-NNNN`, contatore annuale in `contatori_ordine`) e non è modificabile.
- `data_inizio`/`data_fine` sono `timestamp` **senza fuso orario** = ora locale dell'evento (CH/IT/DE/FR stesso fuso). Formato API: `AAAA-MM-GG` o `AAAA-MM-GGTHH:MM[:SS]`.
- `richieste_web.tipo` e `servizi` sono testi tradotti (le opzioni del modulo cambiano con la lingua): si controllano lunghezza e numero, non un elenco fisso. `lingua` invece è un enum (`it`,`de`,`fr`,`en`).

### Row Level Security (attiva su tutte le tabelle)
- **admin**: lettura e scrittura su tutto.
- **tecnico**: legge solo gli eventi a cui è assegnato (via `eventi_staff`) e i relativi clienti (solo nome/telefono), può aggiornare solo `checklist.caricato` e `checklist.note` di quegli eventi (trigger `checklist_limita_tecnico`). Non vede `importo_chf`, `acconto_pagato`, `saldo_pagato` (vista `eventi_tecnico` senza campi economici). Vede nome/telefono dei colleghi assegnati agli stessi eventi.
  - Implementazione: il tecnico **non ha nessuna policy** su `eventi` e `clienti` (nemmeno in lettura). La vista `eventi_tecnico` (`security_invoker = true`) legge da `public.eventi_assegnati()`, funzione `SECURITY DEFINER` che restituisce solo gli eventi assegnati all'utente corrente e solo colonne non economiche (+ `cliente_nome`, `cliente_telefono`). Così anche chi usasse direttamente il proprio JWT su PostgREST non potrebbe leggere gli importi.
- **anon**: solo `INSERT` su `richieste_web` (nessuna lettura; privilegio di colonna solo sui campi del modulo, policy con `stato = 'nuova'`).
- Funzioni helper `SECURITY DEFINER` con `search_path = public`: `is_admin()`, `is_staff()`, `is_assegnato(evento)`, `condivide_evento(staff)`.
- Operazioni in più passi come funzioni SQL transazionali (`SECURITY INVOKER`, controllano `is_admin()`): `imposta_staff_evento(evento, jsonb)`, `converti_richiesta(richiesta, titolo)`.
- I privilegi di default di Supabase (ALL per `anon`/`authenticated`) vengono revocati e riassegnati al minimo.

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

### Dettagli delle API (file in `netlify/functions/`)
| Endpoint | File | Corpo / risposta |
|---|---|---|
| `POST /api/auth/login` | `auth-login.js` | `{email, password}` → `{id, nome, ruolo}` + cookie; `401 invalid_credentials`, `403 forbidden` (non dipendente) |
| `POST /api/auth/logout` | `auth-logout.js` | → `{ok:true}`, cookie cancellati |
| `GET /api/me` | `me.js` | → `{id, nome, ruolo}` |
| `GET/POST /api/eventi`, `GET/PATCH/DELETE /api/eventi/:id` | `eventi.js` | elenco `{eventi:[…]}` (filtri `da`, `a` = `AAAA-MM-GG`, `stato`); dettaglio `{evento, staff:[{staff_id, nome, telefono, ruolo_evento}], checklist:[…]}`; crea/modifica `{evento}` |
| `PUT /api/eventi/:id/staff` | `eventi-staff.js` | `{assegnazioni:[{staff_id, ruolo_evento}]}` (sostituisce tutto) |
| `POST /api/eventi/:id/checklist` | `eventi-checklist.js` | `{voce, quantita?, note?}` → `{voce}` |
| `PATCH /api/checklist/:id` | `checklist.js` | `{caricato?, note?}` → `{voce}` |
| `GET/POST /api/clienti`, `PATCH /api/clienti/:id` | `clienti.js` | ricerca `?q=`; `{nome, azienda, email, telefono, lingua, note}` |
| `GET /api/staff` | `staff.js` | `{staff:[{id, nome, ruolo, telefono, attivo}]}` |
| `GET /api/richieste`, `PATCH /api/richieste/:id` | `richieste.js` | filtro `?stato=`; PATCH `{stato}` |
| `POST /api/richieste/:id/converti` | `richieste-converti.js` | `{titolo?}` → `201 {cliente_id, evento_id, numero_ordine}` (riusa il cliente con la stessa e-mail; passa all'evento anche il `paese`, `CH` se assente) |
| `POST /api/richiesta` | `richiesta.js` | vedi sotto |

Codici d'errore: `invalid_input` (400, con `field`), `invalid_json` (400), `unauthorized` (401), `invalid_credentials` (401), `forbidden` (403), `forbidden_origin` (403, controllo CSRF), `not_found` (404), `method_not_allowed` (405), `conflict` (409), `payload_too_large` (413), `unsupported_media_type` (415), `too_many_requests` (429), `server_error`/`server_misconfigured` (500), `upstream_error`/`upstream_unavailable` (502).

**Modulo pubblico `POST /api/richiesta`**: campi `nome`, `email` (obbligatori), `telefono`, `tipo`, `data`, `localita`, `ospiti`, `servizi` (ripetibile), `messaggio`, `lingua`, `paese` (facoltativo, `CH`/`IT`/`DE`/`FR`), honeypot `bot-field`; altri campi (es. `form-name`) ignorati. Accetta JSON oppure un normale `<form method="POST" action="/api/richiesta">` (urlencoded o multipart): senza `X-Requested-With: meekon` risponde `303` verso `/grazie.html` (it) o `/{lingua}/grazie.html`, in caso di errore una piccola pagina HTML 400 con link al modulo. Con JSON/`X-Requested-With` risponde `{ok:true}`. `Origin` obbligatorio e uguale ad `ALLOWED_ORIGIN`; `X-Requested-With` non è richiesto qui (un form HTML non può inviarlo) — l'endpoint non usa cookie e scrive solo con il ruolo `anon`. Limite 24 KB.

## Contenuti pubblici gestiti da file
`data/sale.json` (location dove abbiamo lavorato), `data/dj.json` (DJ con cui collaboriamo), `data/partner.json` (partner), `data/galleria.json` (foto e video). Ogni voce ha `"approvato": true|false`; `build.py` pubblica solo le voci approvate.

## Pagine
- `/`, `/de/`, `/fr/`, `/en/` — sito pubblico
- `/{lingua}/grazie.html` — conferma richiesta
- `/area-riservata/` — login · `/area-riservata/app.html` — gestionale (noindex)

## Pubblicazione (`netlify.toml`)
- `publish = "."`: per questo le cartelle interne (`/netlify/`, `/supabase/`, `/tests/`, `/docs/`, `/src/`, `/data/`, `/.claude/`) e i file di progetto (`CLAUDE.md`, `README.md`, `build.py`, `package.json`, `netlify.toml`, …) sono bloccati con un redirect forzato `404` verso `/404.html` (pagina da creare a cura del frontend). `/data/` contiene anche voci non approvate e non deve mai essere servita.
- CSP senza `'unsafe-inline'` per script e stili: nessuno script inline (JSON-LD `type="application/ld+json"` è ammesso perché non viene eseguito), nessun attributo `style=`. Caratteri ospitati in locale (`/assets/fonts/`): `style-src 'self'; font-src 'self'`, nessun dominio esterno.
- Cache: immagini/video 1 anno; CSS/JS 1 giorno (i nomi dei file non hanno hash); `/api/*` e `/area-riservata/*` `no-store` + `noindex`.
- Test: `npm test` = `node --test tests/*/*.test.js` (da Node 21 `node --test` non accetta più una cartella come argomento).
