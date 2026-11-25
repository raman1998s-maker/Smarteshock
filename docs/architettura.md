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
| `staff` | `id` (= `auth.users.id`), `nome`, `ruolo` (`admin` \| `ufficio` \| `tecnico` \| `base`, migrazione `0006`), `telefono`, `attivo` |
| `clienti` | `id`, `nome`, `azienda`, `email`, `telefono`, `lingua`, `note`, `created_at` |
| `eventi` | `id`, `numero_ordine` (unico), `cliente_id`, `titolo`, `tipo`, `stato` (`richiesta` → `offerta` → `confermato` → `completato` / `annullato`), `data_inizio`, `data_fine`, `localita`, `sala`, `paese` (`CH`,`IT`,`DE`,`FR`), `ospiti`, `servizi` (text[]), `programma`, `note_squadra` (visibili ai tecnici assegnati; migrazione `0004`), `note_interne` (solo admin), `importo_chf`, `acconto_pagato`, `saldo_pagato`, `created_at`, `updated_at` |
| `eventi_staff` | `evento_id`, `staff_id`, `ruolo_evento` (es. tecnico audio, luci, video) |
| `checklist` | `id`, `evento_id`, `voce`, `quantita`, `caricato` (bool), `note` |
| `richieste_web` | `id`, `nome`, `email`, `telefono`, `tipo`, `data`, `localita`, `ospiti`, `servizi`, `messaggio`, `lingua`, `paese` (`CH`,`IT`,`DE`,`FR`, facoltativo; migrazione `0002`), `dettagli_tecnici` (jsonb facoltativo, oggetto < 8 kB; migrazione `0005`, vedi "Dettagli tecnici sul luogo"), `stato` (`nuova`/`gestita`/`scartata`), `evento_id` (evento creato con "converti"), `created_at` — le righe senza `evento_id` più vecchie di 24 mesi vengono cancellate automaticamente (vedi "Conservazione delle richieste") |

Note sul modello (schema reale in `supabase/migrations/0001_schema.sql`):
- Tutte le tabelle modificabili hanno anche `updated_at` (trigger). `numero_ordine` è generato dal DB (`AAAA-NNNN`, contatore annuale in `contatori_ordine`) e non è modificabile.
- `data_inizio`/`data_fine` sono `timestamp` **senza fuso orario** = ora locale dell'evento (CH/IT/DE/FR stesso fuso). Formato API: `AAAA-MM-GG` o `AAAA-MM-GGTHH:MM[:SS]`.
- `richieste_web.tipo` e `servizi` sono testi tradotti (le opzioni del modulo cambiano con la lingua): si controllano lunghezza e numero, non un elenco fisso. `lingua` invece è un enum (`it`,`de`,`fr`,`en`).

### Row Level Security (attiva su tutte le tabelle)
- **admin**: lettura e scrittura su tutto.
- **tecnico**: legge solo gli eventi a cui è assegnato (via `eventi_staff`) e i relativi clienti (solo nome/telefono), può aggiornare solo `checklist.caricato` e `checklist.note` di quegli eventi (trigger `checklist_limita_tecnico`). Non vede `importo_chf`, `acconto_pagato`, `saldo_pagato` né `note_interne` (vista `eventi_tecnico` senza campi economici e senza note interne; vede invece `note_squadra`). Vede nome/telefono dei colleghi assegnati agli stessi eventi.
  - Implementazione: il tecnico **non ha nessuna policy** su `eventi` e `clienti` (nemmeno in lettura). La vista `eventi_tecnico` (`security_invoker = true`) legge da `public.eventi_assegnati()`, funzione `SECURITY DEFINER` che restituisce solo gli eventi assegnati all'utente corrente e solo colonne non economiche, con `note_squadra` ma senza `note_interne` (+ `cliente_nome`, `cliente_telefono`; migrazione `0004`). Così anche chi usasse direttamente il proprio JWT su PostgREST non potrebbe leggere gli importi né le note interne. Seconda difesa in `eventi.js`: per il tecnico si chiedono colonne esplicite e si tolgono comunque importi e `note_interne` dalla risposta (`perTecnico()` in `_lib/schemas.js`).
- **anon**: solo `INSERT` su `richieste_web` (nessuna lettura; privilegio di colonna solo sui campi del modulo, policy con `stato = 'nuova'`).
- Funzioni helper `SECURITY DEFINER` con `search_path = public`: `is_admin()`, `is_staff()`, `is_assegnato(evento)`, `condivide_evento(staff)`.
- Operazioni in più passi come funzioni SQL transazionali (`SECURITY INVOKER`, controllano `is_admin()`): `imposta_staff_evento(evento, jsonb)`, `converti_richiesta(richiesta, titolo)` (copia il messaggio del cliente in `note_interne`, solo admin), `pulisci_richieste_vecchie_admin()`.

### Conservazione delle richieste (migrazione `0004`)
- Le righe di `richieste_web` con `evento_id is null` e `created_at` più vecchio di **24 mesi** vengono cancellate (impegno dell'informativa privacy). Le richieste convertite in evento restano finché esiste l'evento; se l'evento viene eliminato, `evento_id` diventa nullo e la richiesta rientra nella pulizia.
- Via principale: job `pg_cron` giornaliero `pulisci_richieste_vecchie` (03:17 UTC) che esegue `public.pulisci_richieste_vecchie()` — `SECURITY DEFINER`, `search_path = public`, nessun `EXECUTE` per `public`/`anon`/`authenticated` (solo il proprietario, che è anche l'utente del job).
- Seconda via (pg_cron non disponibile o pulizia immediata): `POST /api/richieste/pulizia` (solo admin) → `rpc/pulisci_richieste_vecchie_admin()`, `SECURITY INVOKER`, controlla `is_admin()`, stesso criterio, la RLS dell'admin si applica normalmente.
- Verifica del job: vedi `supabase/README.md` (`select * from cron.job`).
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
| `POST /api/richieste/pulizia` | admin | cancella subito le richieste senza seguito più vecchie di 24 mesi |
| `POST /api/richiesta` | pubblico | modulo del sito (honeypot, limiti di lunghezza, validazione) |

### Dettagli delle API (file in `netlify/functions/`)
| Endpoint | File | Corpo / risposta |
|---|---|---|
| `POST /api/auth/login` | `auth-login.js` | `{email, password}` → `{id, nome, ruolo}` + cookie; `401 invalid_credentials`, `403 forbidden` (non dipendente) |
| `POST /api/auth/logout` | `auth-logout.js` | → `{ok:true}`, cookie cancellati |
| `GET /api/me` | `me.js` | → `{id, nome, ruolo}` |
| `GET/POST /api/eventi`, `GET/PATCH/DELETE /api/eventi/:id` | `eventi.js` | elenco `{eventi:[…]}` (filtri `da`, `a` = `AAAA-MM-GG`, `stato`); dettaglio `{evento, staff:[{staff_id, nome, telefono, ruolo_evento}], checklist:[…]}`; crea/modifica `{evento}`. Note: admin legge e scrive `note_squadra` e `note_interne` (testo multiriga, max 10000 caratteri ciascuna); il tecnico riceve solo `note_squadra` (nel dettaglio, non nell'elenco) |
| `PUT /api/eventi/:id/staff` | `eventi-staff.js` | `{assegnazioni:[{staff_id, ruolo_evento}]}` (sostituisce tutto) |
| `POST /api/eventi/:id/checklist` | `eventi-checklist.js` | `{voce, quantita?, note?}` → `{voce}` |
| `PATCH /api/checklist/:id` | `checklist.js` | `{caricato?, note?}` → `{voce}` |
| `GET/POST /api/clienti`, `PATCH /api/clienti/:id` | `clienti.js` | ricerca `?q=`; `{nome, azienda, email, telefono, lingua, note}` |
| `GET /api/staff` | `staff.js` | `{staff:[{id, nome, ruolo, telefono, attivo}]}` |
| `GET /api/richieste`, `PATCH /api/richieste/:id` | `richieste.js` | filtro `?stato=`; PATCH `{stato}`; le righe includono `dettagli_tecnici` |
| `POST /api/richieste/:id/converti` | `richieste-converti.js` | `{titolo?}` → `201 {cliente_id, evento_id, numero_ordine}` (riusa il cliente con la stessa e-mail; passa all'evento anche il `paese`, `CH` se assente) |
| `POST /api/richieste/pulizia` | `richieste-pulizia.js` | nessun corpo → `{ok:true, cancellate}` (numero di righe cancellate); `richieste.js` esclude questo percorso con `excludedPath` |
| `POST /api/richiesta` | `richiesta.js` | vedi sotto |

Codici d'errore: `invalid_input` (400, con `field`), `invalid_json` (400), `unauthorized` (401), `invalid_credentials` (401), `forbidden` (403), `forbidden_origin` (403, controllo CSRF), `not_found` (404), `method_not_allowed` (405), `conflict` (409), `payload_too_large` (413), `unsupported_media_type` (415), `too_many_requests` (429), `server_error`/`server_misconfigured` (500), `upstream_error`/`upstream_unavailable` (502).

**Modulo pubblico `POST /api/richiesta`**: campi `nome`, `email` (obbligatori), `telefono`, `tipo`, `data`, `localita`, `ospiti`, `servizi` (ripetibile), `messaggio`, `lingua`, `paese` (facoltativo, `CH`/`IT`/`DE`/`FR`), honeypot `bot-field`; altri campi (es. `form-name`) ignorati. Campi facoltativi `dt_*` del blocco "Dettagli tecnici sul luogo" (vedi sotto). Accetta JSON oppure un normale `<form method="POST" action="/api/richiesta">` (urlencoded o multipart): senza `X-Requested-With: meekon` risponde `303` verso `/grazie.html` (it) o `/{lingua}/grazie.html`, in caso di errore una piccola pagina HTML 400 con link al modulo. Con JSON/`X-Requested-With` risponde `{ok:true}`. `Origin` obbligatorio e uguale ad `ALLOWED_ORIGIN`; `X-Requested-With` non è richiesto qui (un form HTML non può inviarlo) — l'endpoint non usa cookie e scrive solo con il ruolo `anon`. Limite 24 KB.

**Dettagli tecnici sul luogo** (migrazione `0005`): blocco facoltativo del modulo, mostrato da `main.js` solo quando si scelgono schermi/digital banner, luci/strutture, audio, DJ o effetti (senza JavaScript è sempre visibile). I campi si chiamano `dt_<chiave>` e sono validati da `dettagliTecniciSchema` in `netlify/functions/_lib/schemas.js`: ogni valore è un enum fisso, un numero con limiti (`superficie_m2` 1–10000, `altezza_m` 1–40 con un decimale, `decibel_max` 60–120, `musica_fino` `HH:MM`) o un testo breve su una riga (max 80/120 caratteri); `dt_prese` è ripetibile. Le chiavi sconosciute vengono ignorate, i valori vuoti scartati; un valore non valido dà `400 {error:"invalid_input", field:"dt_<chiave>"}`. Il risultato (senza prefisso, solo i campi compilati) va in `richieste_web.dettagli_tecnici`; se è vuoto la colonna non viene inviata. Il database controlla solo che sia un oggetto JSON sotto 8 kB. Contiene anche nome e contatto facoltativi di altri fornitori dell'evento (`forn_<ruolo>_nome`/`_contatto`, ruoli `decorazioni`, `foto`, `musica`, `planner`, `location`): dati di terzi, citati nell'informativa privacy. Dopo 24 mesi la pulizia (`pulisci_richieste_vecchie()` e `_admin()`, ridefinite in `0005`) cancella le richieste senza seguito come prima e, nelle richieste convertite in evento, toglie le chiavi `forn_*` da `dettagli_tecnici`. L'admin li vede in italiano nel dettaglio della richiesta; `converti_richiesta` non li copia nell'evento.

## Gestionale (migrazioni `0006`–`0009`)

Dal 25.11.2026 l'area riservata è il gestionale dell'azienda. **Dove sopra c'è scritto "admin" per richieste, clienti, eventi (creare/modificare), squadra, checklist e staff (lettura), ora vale "gestione" = admin + ufficio.** Restano solo admin: cancellare eventi e articoli, utenti e ruoli, contenuti del sito, pulizia delle richieste.

### Ruoli (`0006_ruoli.sql`)
| Cosa | admin | ufficio | tecnico | base |
|---|---|---|---|---|
| Richieste, clienti, offerte, prezzi, note interne | sì | sì | no | no |
| Eventi: creare, modificare, assegnare la squadra | sì | sì | no | no |
| Cancellare eventi e articoli | sì | no | no | no |
| Eventi visibili | tutti | tutti | i propri | i propri **di oggi** |
| Indirizzo, Maps, contatto sul posto, squadra | sì | sì | sui propri | sui propri di oggi |
| Magazzino (catalogo con prezzi, disponibilità) | sì | sì | no | no |
| Lista materiale/checklist dell'evento | sì | sì | spunta caricato/rientrato/note | no |
| Proprie assenze | sì | sì (anche per gli altri) | sì | sì |
| Utenti e ruoli, contenuti del sito | sì | no | no | no |

- Helper SQL: `ruolo_corrente()`, `gestione()` (admin o ufficio, attivo), `oggi_ch()` (data a Zurigo). Le funzioni esistenti `imposta_staff_evento`, `converti_richiesta`, `checklist_limita_tecnico` sono state riscritte con `gestione()` al posto di `is_admin()` (sostituzione sul corpo attuale, vedi la migrazione).
- Trigger `staff_protegge_admin`: impossibile disattivare/declassare/cancellare l'ultimo admin attivo (errore `55000` → API `409`).
- `eventi`: nuove colonne `indirizzo`, `contatto_luogo_nome`, `contatto_luogo_telefono`; la vista `eventi_tecnico` le restituisce e per il ruolo `base` mostra solo gli eventi in corso oggi.
- In `_lib/auth.js`: `RUOLI` (i quattro valori ammessi, altri → 403) e `isGestione()`; in `handler.js` il livello `auth: 'gestione'`.

### Magazzino (`0007_magazzino.sql`)
- `articoli`: `categoria`, `marca`, `descrizione`, `accessori`, `note`, `quantita`, `prezzo_noleggio_giorno`, `prezzo_vendita`, `in_vendita` (materiale usato da vendere, es. la "Abverkaufsliste"), `attivo`. RLS: gestione legge/scrive, solo admin cancella.
- La lista del materiale di un evento è la `checklist`, con in più `articolo_id` (collegamento facoltativo al catalogo) e `rientrato`; `caricato` = uscito dal magazzino.
- `disponibilita_articoli(da, a, escludi)`: per articolo `impegnati` (eventi **confermati** nel periodo), `in_offerta` (eventi richiesta/offerta), `fuori` (caricati e non rientrati, adesso), `disponibili` = quantità − impegnati.

### Offerte (`0008_offerte.sql`)
- Impostate come le offerte Meekon già in uso (esempi del 25.11.2026): prezzi **IVA inclusa** ("Total inkl. MwSt.", IVA 8,1 % per tutti), sconto sul totale in % ("Rabatt 15%") e/o in CHF, colonne Pos · Artikel · Bezeichnung · Anzahl · Einzelpreis · Preis CHF, validità 14 giorni, AGB a pagina 2.
- `offerte` (versioni 1, 2, … per evento; stato `bozza` → `inviata` → `accettata`/`rifiutata`/`scaduta`; `lingua` del PDF (quella del cliente), `valida_fino`, `iva_percento`, `prezzi_iva_inclusa` (default sì), `sconto_percento`, `sconto_chf`, `introduzione`, `condizioni`, `inviata_il`) e `offerte_righe` (`articolo_id` facoltativo, `titolo` = "Artikel", `descrizione` = "Bezeichnung", `quantita` × `giorni` × `prezzo_unitario` − `sconto_percento`).
- Totali sempre dal DB: vista `offerte_totali` (subtotale, sconti, imponibile, IVA, totale ai 5 centesimi; con IVA inclusa l'IVA è solo informativa). `gestionale.js` ha la stessa formula per l'anteprima mentre si scrive.
- RPC: `nuova_offerta(evento, copia_da)` (versione successiva, evento richiesta → offerta), `imposta_righe_offerta(offerta, righe)` (solo in bozza, altrimenti `55000` → `409`), `accetta_offerta(offerta)` (accettata + altre versioni aperte scadute + evento confermato con `importo_chf` = totale, una transazione).
- `impostazioni` (riga unica, `dati` jsonb < 64 kB): intestazione della ditta (`nome`, `persona`, `slogan`, `indirizzo`, `telefono`, `email`, `piede` con i dati bancari) e testi per lingua (`introduzione`, `condizioni`, `saluti`, `agb`; `{cliente}` diventa il nome del cliente). Lettura gestione, scrittura solo admin. **Indirizzo, coordinate bancarie e AGB stanno solo qui, mai nel repository** (regola 1 e 2 di CLAUDE.md).
- Il PDF lo fa il browser: "PDF / Stampa" prepara un documento nascosto (`.stampa`, etichette in DE/IT/FR/EN) e chiama `window.print()`; il CSS `@media print` stampa solo quello (A4, AGB su una seconda pagina). L'invio al cliente per ora è manuale.

### Assenze (`0009_assenze.sql`)
- `assenze` (`staff_id`, `dal`, `al`, `motivo`): ognuno gestisce le proprie, la gestione vede e segna quelle di tutti. Quando si assegna la squadra l'interfaccia mostra chi è assente e chiede conferma.

### Paga e spese (`0010_paga_spese.sql`)
- `compensi` (paga per evento: `staff_id`, `ruolo`, `quantita` × `tariffa_chf`): gestione legge e scrive (RPC `imposta_compensi_evento`, una transazione); ognuno legge solo i propri, anche con titolo e data dell'evento tramite `miei_compensi(da, a)` (SECURITY DEFINER). Le tariffe proposte (es. Autista 150, Magazzino 150 al giorno) stanno in `impostazioni.dati.tariffe`.
- `spese` (`tipo` cibo/diesel/materiale/altro, `importo_chf`, `data`, `evento_id` facoltativo, `stato` inviata/approvata/rifiutata): l'operaio inserisce solo spese proprie, sempre "inviate" e solo su eventi a cui è assegnato, e può ritirarle finché non sono decise; approvare/rifiutare è della gestione.
- "Aggiungi a Google Calendar": link `calendar.google.com/calendar/render?action=TEMPLATE…` su evento e agenda (titolo, orario, luogo, link al gestionale; nessun prezzo).
- Numero d'ordine: resta `AAAA-NNNN`, l'offerta è `AAAA-NNNN/versione` (deciso con il referente il 25.11.2026).

### Offerta v2 (`0011_offerta_v2.sql`, specifica approvata a dicembre 2026)
- Cliente: `indirizzo` (obbligatorio prima dell'invio: `PATCH stato=inviata` → `409 {field:"indirizzo_cliente"}`) e `anrede`. Evento: `montaggio_da`, `smontaggio_da` (anche nella vista della squadra). Righe: `opzionale` (nel PDF, non sommate).
- Con prezzi IVA inclusa la quota "davon MWST" = totale × 8,1 / 108,1 arrotondata ai 5 centesimi. La riga IVA del PDF dipende dalle Impostazioni: con numero IVA "Total inkl. 8,1 % MWST" + "davon MWST"; con `mwst_pflichtig = false` "Total" + "Nicht mehrwertsteuerpflichtig"; se non deciso solo "Total" e un avviso nell'editor.
- La conferma dall'ufficio (`accetta_offerta`) richiede la location dell'evento (località o indirizzo), altrimenti `55000` → `409`.
- Accettazione online: all'invio l'API crea `offerte.token` (48 caratteri esadecimali casuali). Il cliente apre `/offerta/?t=…` (pagina pubblica, noindex, no-store, no-referrer) → `GET/POST /api/offerta-pubblica` (`offerta-pubblica.js`, ruolo anon solo lato server) → funzioni `offerta_pubblica(token)` e `accetta_offerta_online(token, nome, foto, ip)` (SECURITY DEFINER, eseguibili solo da anon). Due caselle obbligatorie (AGB, indennità/annullamento) e una facoltativa (foto); si registrano nome, data/ora, IP, versione AGB, consenso foto. Solo offerte "inviate" e non scadute.
- PDF: `area-riservata/offerta-doc.js` (offerta e conferma d'ordine, etichette DE/IT/FR/EN, regole e scaglioni dalle Impostazioni con i valori della specifica come predefiniti); footer con indirizzo, IBAN a gruppi di 4, "Seite x/y" e versione AGB nelle margin box di `@page` (testo passato con variabili CSS). AGB nell'ultima pagina su due colonne; nelle lingue diverse dal tedesco con la nota che fa fede la versione tedesca. Non ancora: QR per l'accettazione e QR-fattura dell'acconto (servirebbe una libreria per i QR).

### Magazzino come il vecchio sistema (`0012_magazzino_codici.sql`)
- `articoli`: `codice` dell'etichetta (unico, es. E000006623), `sottocategoria`, `danneggiati` (≤ quantità, esclusi dai disponibili). `checklist`: `mancanti` e `danneggiati` al rientro (li segna anche il tecnico). `disponibilita_articoli` restituisce anche `danneggiati`.
- Importazione: riconosce anche le colonne del vecchio `magazzino.ods` (Code, Item, Sub Category, Category, Total Quantity, Damaged Quantity, Notes); salta gli articoli con codice già presente (o, senza codice, con la stessa descrizione); una lista senza colonna prezzo si importa senza prezzi e senza "in vendita". I dati del vecchio file non sono nel repository: si importano incollandoli nella pagina "Importa una lista".

### Area partner DJ (`0013_partner.sql`)
- Ruolo `partner` (account creato dall'admin): vede solo la propria area (`#/partner`), mai eventi, clienti, catalogo interno o altri partner; l'interfaccia lo rimanda sempre lì, la RLS lo garantisce.
- `partner_profili` (ragione sociale, logo come data URL PNG/JPEG/WebP ≤ 400 kB, indirizzo, IBAN, IVA, AGB proprie o di Meekon; `sconto_partner_percento` modificabile solo dalla gestione, trigger `partner_profili_protegge`).
- `partner_offerte` + `partner_righe` (righe `servizio` del DJ o `materiale` con `articolo_id`): numero progressivo per partner (es. 2026-P001), stato gestito dal partner (bozza → inviata → accettata/rifiutata/scaduta; da inviata può tornare in bozza), `materiale_stato` automatico (in_attesa all'invio, da_confermare all'accettazione) e deciso dall'ufficio (confermato/rifiutato con nota). Trigger: dopo la bozza righe e dati bloccati; il partner non tocca i campi dell'ufficio.
- `catalogo_partner(da, a)`: articoli con prezzo di noleggio, prezzo partner (noleggio − sconto del partner) e pezzi liberi nelle date; `costo_materiale_partner(offerta)`; `agb_meekon()` (regole, scaglioni, testi AGB, senza dati della ditta); `imposta_righe_partner`; `conferma_materiale_partner(offerta, nota)` crea l'evento Meekon (confermato, importo = costo materiale, note interne con partner e cliente finale) con la lista materiale.
- PDF del partner: stesso `offerta-doc.js` con i dati, il logo e la banca del partner; con AGB proprie non si stampa il riquadro di annullamento di Meekon. Fattura del partner: tipo `fattura` ("Rechnung"), dopo l'accettazione.
- API: `GET/PATCH /api/partner` (gestione: elenco e sconto), `GET/PUT /api/partner/profilo` (partner), `GET /api/partner/catalogo`, `GET/POST/PATCH/DELETE /api/partner-offerte`, `PUT /api/partner-offerte/:id/righe`, `POST /api/partner-offerte/:id/materiale` `{azione: conferma|rifiuta, nota}` (gestione). Interfaccia: `area-riservata/partner.js`.

### Modelli di allestimento (`0014_modelli.sql`)
- `modelli` + `modelli_voci` (articolo, quantità): pacchetti di materiale (es. "Schermo dietro con luci sopra lo schermo", "Struttura con schermo davanti e dietro, luci e audio ai lati", "Welcome board"). Li gestisce l'ufficio nella pagina Magazzino (`salva_modello`, una transazione); i partner vedono solo quelli "per i partner" attivi.
- Si aggiungono con un clic nell'offerta Meekon (prezzo di noleggio × giorni dell'evento), nell'offerta del partner (prezzo partner come proposta) e nella lista materiale dell'evento; poi si modificano. API: `GET/POST /api/modelli`, `PUT/DELETE /api/modelli/:id`.

### Lingua dell'interfaccia (`0015_lingua_utente.sql`)
- `staff.lingua` (it/de/en; il titolare usa il tedesco), cambiata con `PATCH /api/me {lingua}` → `imposta_mia_lingua()`. `area-riservata/i18n.js` traduce a schermo i testi italiani con `i18n-de.js` / `i18n-en.js` (chiave = testo italiano esatto, `{0}` per le parti variabili); i testi già tradotti non si ritraducono; il documento `.stampa` e i campi compilati sono esclusi. **Ogni testo nuovo dell'interfaccia va aggiunto ai due dizionari.**

### Materiale difettoso, peso e veicoli (`0016_difettoso_veicoli.sql`)
- `guasti` (articolo, pezzi, stato da_riparare / in_riparazione / riparato / da_buttare, guasto, costo): i pezzi non riparati non sono disponibili. I danneggiati segnati al rientro su una voce collegata al magazzino creano da soli un guasto (trigger `checklist_crea_guasto`).
- `articoli.peso_kg`; `veicoli` (targa, portata utile kg, volume, scadenze MFK e assicurazione, avviso a 30 giorni); `eventi_veicoli`; `checklist.veicolo_id` (solo la gestione la cambia); `carico_veicoli(evento)`.
- Interfaccia: Magazzino con schede Articoli / Modelli / Difettoso / Veicoli; sull'evento il riquadro "Carico veicoli" (barre di carico, sovrappeso in rosso, "Distribuisci automaticamente": voci più pesanti prima, sul veicolo con più spazio, dividendo la voce se non ci sta intera).
- API: `GET/POST /api/guasti`, `PATCH/DELETE /api/guasti/:id`, `GET/POST /api/veicoli`, `PATCH/DELETE /api/veicoli/:id`, `GET/PUT /api/eventi/:id/veicoli`; `PATCH /api/checklist/:id` accetta anche `veicolo_id` e `quantita` (gestione).
- Etichette del magazzino: oggi sono **codici a barre** (non QR) con i codici tipo E000006623.

### Pacchetti e PDF per categorie (`0017_pacchetti.sql`)
- Di solito Meekon fa un prezzo per pacchetto, non per pezzo: un modello di allestimento (`modelli.prezzo_giorno`, `categoria`, `immagine` = disegno dello schema) entra nell'offerta come **una riga** con prezzo unico e testo "cosa comprende"; i singoli articoli restano nella riga (`modello_id`, `componenti`) per magazzino, peso e disponibilità. Opzione "Come singoli articoli" per il vecchio comportamento.
- Partner: righe `pacchetto` con prezzo partner = prezzo del pacchetto − sconto del partner; la conferma del materiale espande i componenti nella lista materiale. Il partner sceglie anche cliccando sul disegno dell'allestimento (configuratore visivo, `.modelli-visivi`).
- Offerta Meekon accettata: pulsante "Lista materiale dall'offerta" (articoli + componenti dei pacchetti → lista materiale dell'evento).
- PDF: righe raggruppate per categoria (Bild & LED-Screens, Licht, Ton, Video, Rigging & Bühne, Strom & Kabel, Effekte, altre, Leistungen) con subtotale; intestazione con titolo, numero/data/validità, Für/Von e riquadro evento; AGB in Markdown (titoli `##`, `**grassetto**`) nella lingua del PDF; fattura senza testo d'offerta né annullamento.

### Configuratore visivo dell'allestimento (`area-riservata/configuratore.js`)
- Disegno SVG (ridisegnato dallo schizzo di Raman, DJ al centro dietro la console) con le parti: truss con luci, schermo dietro, schermo davanti (DJ booth), mixer/console, live stream, microfono, audio sinistra/destra, monitor DJ, luci su stativo, nebbia/fumo, effetti speciali, dance floor. Ogni parte è collegata a un pacchetto tramite `modelli.parte` (scelta in Magazzino → Modelli).
- Il partner clicca le parti richieste dal cliente e le aggiunge come pacchetti; i modelli con disegno ma senza parte compaiono come "installazioni particolari".
- Nel PDF (offerte Meekon e dei partner) il riquadro "Ihr Setup" mostra il disegno con solo le parti scelte, con le etichette nella lingua dell'offerta.

### API del gestionale
| Metodo e percorso | Chi | File |
|---|---|---|
| `GET /api/staff` · `PATCH /api/staff/:id` `{nome?, telefono?, ruolo?, attivo?}` | gestione · admin (non su sé stesso per ruolo/attivo → 409) | `staff.js` |
| `GET/POST /api/articoli` (`?q=`, `?in_vendita=1`, `?tutti=1`) · `PATCH /api/articoli/:id` · `DELETE` (admin) | gestione | `articoli.js` |
| `POST /api/articoli/importa` `{articoli:[…]}` (max 500, 512 KB; errore con `riga`) | gestione | `articoli-importa.js` |
| `GET /api/articoli/disponibilita?da=&a=&escludi=` | gestione | `articoli-disponibilita.js` |
| `GET /api/offerte?evento=` · `GET /api/offerte/:id` · `POST /api/offerte` `{evento_id, copia_da?}` · `PATCH /api/offerte/:id` · `DELETE` (solo bozza) | gestione | `offerte.js` |
| `PUT /api/offerte/:id/righe` `{righe:[…]}` (max 200) | gestione | `offerte-righe.js` |
| `GET /api/assenze?da=&a=` · `POST /api/assenze` · `DELETE /api/assenze/:id` | tutti (RLS) | `assenze.js` |
| `GET /api/impostazioni` · `PUT /api/impostazioni` `{ditta, regole, scaglioni, testi:{de,it,fr,en}, tariffe:[…]}` | gestione · admin | `impostazioni.js` |
| `GET /api/offerta-pubblica?t=` · `POST /api/offerta-pubblica` `{t, nome, agb:true, annullamento:true, foto?}` | pubblico (token) | `offerta-pubblica.js` |
| `GET/PUT /api/eventi/:id/compensi` `{compensi:[{staff_id, ruolo, quantita, tariffa_chf}]}` | gestione | `eventi-compensi.js` |
| `GET /api/compensi?da=&a=` (i propri) | tutti | `compensi.js` |
| `GET /api/spese?da=&a=&stato=&tutte=1` · `POST /api/spese` · `PATCH /api/spese/:id` `{stato}` (gestione) · `DELETE` | tutti (RLS) | `spese.js` |
| `DELETE /api/checklist/:id`; `PATCH` accetta anche `rientrato`; `POST /api/eventi/:id/checklist` accetta `articolo_id` | gestione / assegnati | `checklist.js`, `eventi-checklist.js` |

Interfaccia: `area-riservata/gestionale.js` (agenda settimanale o di oggi per il ruolo base, assenze, magazzino con importazione da Excel, offerte, utenti e ruoli, impostazioni delle offerte), caricato da `app.html` e creato da `app.js` (`MeekonGestionale.create`). Le rotte in `app.js` hanno un livello di accesso `tutti` / `gestione` / `admin`.

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
- Questa CSP è assegnata a `/*` (sicura per default): nessun percorso esce mai senza CSP (404 per URL sconosciuti, rewrite 404 delle cartelle interne, pagine future dimenticate). `/area-riservata` e `/area-riservata/*` non hanno una CSP propria: ricevono quella di `/*` (più `X-Robots-Tag: noindex, nofollow` e `Cache-Control: no-store`). Vedi "Pubblicazione (`netlify.toml`)" per la CSP pubblica.

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
- CSP in due livelli. Se più regole `[[headers]]` corrispondono a un percorso Netlify le applica tutte, e più CSP valgono come **intersezione**:
  - `/*`: CSP dell'area riservata (`'self'` + host Supabase in `connect-src`/`img-src`/`media-src`, `blob:` in `img-src`/`media-src`), insieme agli altri header di sicurezza (HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP). Così ogni percorso ha sempre una CSP.
  - percorsi pubblici elencati (`/`, pagine `.html` alla radice, `/de/*`, `/fr/*`, `/en/*`, `/assets/*`, `robots.txt`, `sitemap.xml`): in più la CSP pubblica stretta (solo `'self'`); l'intersezione con quella di `/*` è esattamente la CSP pubblica. Una nuova pagina pubblica alla radice non elencata ha comunque la CSP di `/*`, ma va aggiunta all'elenco per avere quella stretta. L'area riservata non va mai elencata (non potrebbe contattare Supabase).
  - Il wildcard `https://*.supabase.co` va sostituito con l'host esatto del progetto appena collegato.
  - Il collaudo `tests/e2e/run.mjs` calcola per ogni documento la CSP effettiva (intersezione delle regole che si applicano al percorso) e verifica che nessun percorso resti senza CSP.
- CSP senza `'unsafe-inline'` per script e stili: nessuno script inline (JSON-LD `type="application/ld+json"` è ammesso perché non viene eseguito), nessun attributo `style=`. Caratteri ospitati in locale (`/assets/fonts/`): `style-src 'self'; font-src 'self'`, nessun dominio esterno.
- Cache: immagini/video 1 anno; CSS/JS 1 giorno (i nomi dei file non hanno hash); `/api/*` e `/area-riservata/*` `no-store` + `noindex`.
- Test: `npm test` = `node --test tests/*/*.test.js` (da Node 21 `node --test` non accetta più una cartella come argomento).
