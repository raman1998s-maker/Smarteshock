# Architettura

## Stack
| Parte | Tecnologia |
|---|---|
| Sito pubblico | HTML/CSS/JS statico, generato da `build.py` (template + `src/i18n/*.json` + `data/*.json`) |
| Hosting | Netlify |
| API | Netlify Functions (Node 18+, ESM, **nessuna dipendenza npm a runtime**: solo `fetch`) in `netlify/functions/` |
| Database e login | Supabase (Postgres + Auth), schema in `supabase/migrations/` |
| Area riservata | `/area-riservata/` — pagine statiche che parlano **solo** con `/api/*` |

Il browser **non parla mai direttamente con Supabase** e non riceve nessuna chiave. Unica eccezione, solo nell'area riservata e solo per l'admin: caricamento e anteprima dei media del CMS tramite URL firmati monouso/brevi generati dalle functions (nessuna chiave nel browser).

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

## Contenuti pubblici modificabili (CMS nell'area riservata)

Il titolare (ruolo `admin`) modifica i contenuti del sito pubblico **dall'area riservata**, senza toccare il codice. Il sito resta statico (veloce, buono per Google, CSP stretta): le modifiche diventano visibili quando l'admin preme **"Pubblica sul sito"**, che fa ricostruire il sito su Netlify.

```
Admin ──> /api/contenuti/* ──> Supabase (tabelle + Storage)        [bozza]
Admin ──> POST /api/pubblica ──> Netlify build hook ──> build.py ──> legge Supabase (solo dati pubblicati) ──> HTML statico + media copiati in /assets/media/
```

### Cosa si può modificare
| Sezione | Tabella | Campi |
|---|---|---|
| Galleria (foto e video) | `media_galleria` | `id`, `file_path` (in Storage), `poster_path` (video), `tipo` (`foto`/`video`), `categoria` (`matrimoni`/`aziende`/`feste`/`palco`), `formato` (`wide`/`tall`/`reel`), `alt_it`, `alt_de`, `alt_fr`, `alt_en`, `ordine`, `pubblicato` |
| Location / sale | `sale` | `id`, `nome`, `luogo`, `paese` (`CH`/`IT`/`DE`/`FR`), `tipo_it/de/fr/en`, `ordine`, `pubblicato` |
| DJ | `dj` | `id`, `nome`, `genere_it/de/fr/en`, `foto_path`, `link` (solo `https://`), `ordine`, `pubblicato` |
| Partner | `partner` | `id`, `nome`, `logo_path`, `link` (solo `https://`), `ordine`, `pubblicato` |
| Testi del sito | `testi` | `chiave` (es. `hero.title`, la stessa dei file `src/i18n/*.json`), `it`, `de`, `fr`, `en`, `updated_at` — sovrascrivono i testi dei file; se un campo è vuoto vale il testo del file |
| Registro pubblicazioni | `pubblicazioni` | `id`, `richiesta_da`, `created_at`, `esito` |

Tutte con `updated_at`, `updated_by`. I contatti (telefono, e-mail, Instagram), il titolare e le regole di privacy **non** sono modificabili dal CMS (restano nel codice, revisionati dal mastino).

### Media (Supabase Storage)
- Bucket privato `media`. Caricamento: l'admin chiede `POST /api/media/upload-url` `{nome_file, tipo_mime, dimensione}` → la function verifica ruolo admin, tipo (`image/jpeg`, `image/png`, `image/webp`, `video/mp4`) e dimensione (immagini ≤ 10 MB, video ≤ 200 MB), genera un percorso casuale e restituisce un **URL di caricamento firmato** di Supabase per quel solo file. Il browser carica il file direttamente su quell'URL (nessuna chiave, solo un token monouso con scadenza).
- La CSP dell'**area riservata** (solo lì) aggiunge l'host di Supabase a `connect-src` (caricamento e lettura delle anteprime), `img-src` e `media-src` (anteprime con URL firmato), più `blob:` in `img-src`/`media-src` per le anteprime locali prima del caricamento. La CSP pubblica resta `'self'`. Vedi "Dettagli d'implementazione del CMS".
- Il sito pubblico **non** carica mai file da Supabase: durante la build `build.py` scarica i media pubblicati e li copia in `/assets/media/` (nomi con hash del contenuto), così la CSP pubblica resta `img-src 'self'; media-src 'self'`.
- Le immagini vanno ridotte prima del caricamento nel browser (canvas, lato lungo max 2000 px, JPEG/WebP qualità 0.82) per non caricare file enormi.

### Pubblicazione
- `POST /api/pubblica` (solo admin, CSRF come le altre scritture, max 1 ogni 2 minuti): registra la richiesta in `pubblicazioni` e chiama il build hook di Netlify (`NETLIFY_BUILD_HOOK`, variabile d'ambiente segreta).
- Su Netlify il comando di build è `python3 build.py`: se ci sono `SUPABASE_URL` e `SUPABASE_ANON_KEY` nell'ambiente di build, legge da Supabase **solo le righe con `pubblicato = true`** (policy di lettura per `anon` solo su quelle righe e solo sulle colonne pubbliche) e scarica **solo i media pubblicati** (policy di Storage, vedi sotto); altrimenti (sviluppo locale) usa i file `data/*.json` come oggi.
- Ogni campo letto da Supabase passa dagli stessi controlli di oggi: `html.escape`, link solo `https://`, percorsi media solo dal bucket, verifica che la build non contenga script inline.

### API del CMS (solo admin)
| Metodo e percorso | Descrizione |
|---|---|
| `GET/POST /api/contenuti/:sezione`, `PATCH/DELETE /api/contenuti/:sezione/:id` | sezione = `galleria` \| `sale` \| `dj` \| `partner` |
| `PUT /api/contenuti/ordine/:sezione` | `{ids:[...]}` nuovo ordine |
| `GET /api/testi`, `PUT /api/testi/:chiave` | testi del sito in 4 lingue (`{it, de, fr, en}`, max 2000 caratteri ciascuno, solo testo; i pochi testi che ammettono `<em>` sono elencati in una lista fissa e il resto viene escapato) |
| `POST /api/media/upload-url` | URL di caricamento firmato (vedi sopra) |
| `GET /api/media/anteprima/:path` | URL firmato breve per vedere un file nell'area riservata |
| `POST /api/pubblica` | ricostruisce il sito |
| `GET /api/pubblicazioni` | ultime pubblicazioni e esito |

### Variabili d'ambiente aggiuntive
| Nome | Uso |
|---|---|
| `NETLIFY_BUILD_HOOK` | URL del build hook (segreto: solo nelle functions), formato `https://api.netlify.com/build_hooks/<id>` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | servono **anche nell'ambiente di build** (scope "Builds" su Netlify) per leggere i contenuti pubblicati |

I file `data/*.json` restano come contenuto iniziale e per lo sviluppo locale; uno script `scripts/importa-dati.mjs` (eseguito una volta dall'admin) li carica in Supabase.

### Dettagli d'implementazione del CMS
Schema: `supabase/migrations/0003_cms.sql`. Functions: `contenuti.js`, `testi.js`, `media.js`, `pubblica.js`. Lettura in build: `scripts/cms_fetch.py`.

**Database e RLS**
- Le 6 tabelle hanno RLS attiva. `admin`: tutto. `tecnico`: nessuna policy → nessun accesso (anche via PostgREST con il proprio JWT).
- `anon`: `SELECT` solo con `pubblicato = true` su `media_galleria`, `sale`, `dj`, `partner` e solo sulle colonne pubbliche (privilegi di colonna: niente `id`, `updated_by`, date); `testi`: tutte le righe, colonne `chiave, it, de, fr, en`. Nessuna scrittura.
- Vincoli nel DB: enum (`tipo`, `categoria`, `formato`, `paese`), lunghezze, `link` solo `^https://` senza spazi/virgolette/`<>`, percorsi media solo `^(galleria|dj|partner)/<uuid>.(jpg|png|webp|mp4)$` (poster/foto/logo solo immagini), foto ↔ file immagine e video ↔ `.mp4`, chiave dei testi `^[a-z0-9_]+(\.[a-z0-9_]+)*$`.
- `updated_at`, `updated_by`, `created_at` e `pubblicazioni.richiesta_da` li imposta il trigger `cms_audit()` (il client non può falsificarli).
- Funzioni: `cms_riordina(sezione, ids)` (invoker, controlla `is_admin()`), `registra_pubblicazione()` (invoker, `is_admin()`, lock transazionale + limite di 2 minuti; le pubblicazioni finite in `errore` non contano), `media_pubblicato(path)` (`SECURITY DEFINER`, `search_path = public`, eseguibile da `anon` perché usata dalla policy Storage `media_anon_pubblicati`: restituisce solo un booleano) e `media_pubblicati()` (`SECURITY DEFINER`, `search_path = public`, eseguibile solo da `authenticated`: elenco dei percorsi pubblicati).

**Media pubblici: meccanismo scelto**
- Bucket **privato** `media` (limiti del bucket: 200 MB e solo i 4 tipi MIME ammessi, validi anche per gli URL firmati). Scrittura (`insert/update/delete`) solo admin; `insert` solo con percorso nel formato previsto.
- `anon` può leggere **solo** gli oggetti per cui `media_pubblicato(name)` è vero, cioè referenziati da una riga pubblicata (galleria, poster, foto DJ, logo partner). Le bozze non sono mai leggibili. La build li scarica con la sola chiave anon da `/storage/v1/object/authenticated/media/<path>`.
- Scelto rispetto alle alternative perché è il più semplice e sempre coerente con `pubblicato`: una funzione SQL non può firmare URL di Storage (servirebbe il segreto JWT del progetto nel DB); un secondo bucket pubblico `media-pubblici` richiederebbe copie e cancellazioni a ogni pubblicazione (file obsoleti se una copia fallisce) e renderebbe i file leggibili da chiunque con un URL fisso. Anche qui, i file leggibili da `anon` sono esattamente quelli già pubblicati sul sito.
- `cms_fetch.py` ricontrolla tutto: righe con `pubblicato = true` (filtro anche nella query), enum, link `https://`, percorsi del bucket, dimensione massima per tipo (immagini 10 MB, video 200 MB), firma dei file (JPEG/PNG/WebP/MP4), nessun redirect (la chiave non va ad altri host), nome di destinazione = `sha256(contenuto).<ext>` dentro `dest_media_dir` (nessun percorso esterno). Una voce non valida viene saltata con un avviso; un errore di rete fa fallire la build (Netlify continua a servire la versione precedente).
- Gli URL di caricamento firmati di Supabase scadono dopo **2 ore** (valore fisso di Supabase, non configurabile) e valgono per un solo percorso casuale, senza sovrascrittura. Le anteprime (`/api/media/anteprima/<path>`) durano 5 minuti.
- Limite noto: il browser potrebbe caricare un file diverso da quello dichiarato (es. un'immagine > 10 MB, entro i 200 MB e i tipi del bucket). La build lo scarta (dimensione e firma del file). I file eliminati dal CMS restano nel bucket privato (non pubblici); pulizia manuale dalla dashboard se serve.

**CSP dell'area riservata** (`netlify.toml`)
- `connect-src 'self' https://*.supabase.co; img-src 'self' data: blob: https://*.supabase.co; media-src 'self' blob: https://*.supabase.co`.
- Il wildcard è temporaneo: appena il progetto è collegato va sostituito con l'host esatto (`https://<id>.supabase.co`, lo stesso di `SUPABASE_URL`), perché `netlify.toml` non può leggere variabili d'ambiente e il wildcard ammetterebbe qualsiasi progetto Supabase.
- La CSP non è più nella regola `/*`: se più regole corrispondono a un percorso Netlify le applica tutte, e due CSP valgono come intersezione (l'area riservata non potrebbe contattare Supabase). La CSP pubblica è quindi assegnata a un elenco esplicito di percorsi pubblici (`/`, pagine `.html` alla radice, `/de/*`, `/fr/*`, `/en/*`, `/assets/*`, `robots.txt`, `sitemap.xml`): **ogni nuova pagina pubblica alla radice va aggiunta all'elenco**.

**API del CMS: corpi e risposte**
| Endpoint | Corpo / risposta |
|---|---|
| `GET /api/contenuti/:sezione` | `{voci:[…]}` ordinate per `ordine` |
| `POST /api/contenuti/:sezione` | campi della tabella (senza `id`, `updated_*`) → `201 {voce}` |
| `PATCH /api/contenuti/:sezione/:id` | campi da cambiare → `{voce}`; in galleria, se cambia `file_path` va inviato anche `tipo` |
| `DELETE /api/contenuti/:sezione/:id` | → `{ok:true}` (il file resta nel bucket privato) |
| `PUT /api/contenuti/ordine/:sezione` | `{ids:[uuid…]}` (max 1000, senza doppioni) → `{ok:true, aggiornate}`; `ordine` = 10, 20, 30… |
| `GET /api/testi` | `{testi:[{chiave,it,de,fr,en,updated_at}], chiavi:[…chiavi modificabili]}` |
| `PUT /api/testi/:chiave` | `{it?, de?, fr?, en?}` (max 2000 caratteri; le lingue assenti o vuote diventano vuote = testo del file) → `{testo}`; tutte vuote → la riga viene eliminata, `{testo:null}`. La chiave deve esistere come testo in `src/i18n/it.json` (incluso nel bundle della function) e non essere esclusa |
| `POST /api/media/upload-url` | `{nome_file, tipo_mime, dimensione, cartella?}` (`cartella` = `galleria` (default) \| `dj` \| `partner`) → `{path, upload_url, metodo:"PUT", headers:{Content-Type, x-upsert}, scadenza_secondi}` |
| `GET /api/media/anteprima/<cartella>/<uuid>.<ext>` | → `{url, scadenza_secondi:300}` |
| `POST /api/pubblica` | nessun corpo → `202 {ok, pubblicazione:{id, created_at, esito}}`; `429 {error:"too_many_requests", attesa_secondi}` + `Retry-After`; `502` se il build hook fallisce (esito `errore`) |
| `GET /api/pubblicazioni` | `{pubblicazioni:[{id, created_at, esito, richiesta_da}]}` (ultime 20; `richiesta_da` = nome) |

Chiavi di testo **non** modificabili (`CHIAVI_ESCLUSE` in `_lib/cms.js`, uguale in `cms_fetch.py`): `locale`, `label`, `hint`, `hint_link`, `privacy.*`, `privacy_page.*`, `form.note`, `contact.phone`, `whatsapp.*`. Le chiavi con elenchi (es. `s1.list`, `faq.items`) non sono modificabili.

**Build (`scripts/cms_fetch.py`)**: `load_cms(dest_media_dir, public_prefix="assets/media")` → `None` senza variabili; altrimenti `{"galleria", "sale", "dj", "partner"}` nel formato di `data/*.json` (con `approvato: true`, percorsi `assets/media/<sha256>.<ext>`, lingue mancanti = testo italiano) e `"testi": {chiave: {lingua: testo}}` (solo lingue non vuote). Solleva `CmsError` se Supabase non risponde. I testi **non** sono escapati: l'escape (e la lista fissa dei testi che ammettono `<em>`) resta compito di `build.py`.

**Importazione iniziale** (`scripts/importa-dati.mjs`): `SUPABASE_URL=… SUPABASE_ANON_KEY=… node scripts/importa-dati.mjs [--prova] [--forza]`. Chiede e-mail e password dell'admin (password non mostrata, mai salvata), verifica il ruolo admin, carica nel bucket i file di `assets/` usati dalle voci con `"approvato": true` e crea le righe già pubblicate; si ferma se le tabelle contengono già dati (salvo `--forza`). Le voci di esempio e le bozze non vengono importate.

## Pagine
- `/`, `/de/`, `/fr/`, `/en/` — sito pubblico
- `/{lingua}/grazie.html` — conferma richiesta
- `/area-riservata/` — login · `/area-riservata/app.html` — gestionale (noindex)

## Pubblicazione (`netlify.toml`)
- `publish = "."`: per questo le cartelle interne (`/netlify/`, `/supabase/`, `/tests/`, `/docs/`, `/src/`, `/data/`, `/scripts/`, `/.claude/`) e i file di progetto (`CLAUDE.md`, `README.md`, `build.py`, `package.json`, `netlify.toml`, …) sono bloccati con un redirect forzato `404` verso `/404.html` (pagina da creare a cura del frontend). `/data/` contiene anche voci non approvate e non deve mai essere servita.
- CSP senza `'unsafe-inline'` per script e stili: nessuno script inline (JSON-LD `type="application/ld+json"` è ammesso perché non viene eseguito), nessun attributo `style=`. Caratteri ospitati in locale (`/assets/fonts/`): `style-src 'self'; font-src 'self'`, nessun dominio esterno.
- Cache: immagini/video 1 anno; CSS/JS 1 giorno (i nomi dei file non hanno hash); `/api/*` e `/area-riservata/*` `no-store` + `noindex`.
- Test: `npm test` = `node --test tests/*/*.test.js` (da Node 21 `node --test` non accetta più una cartella come argomento).
