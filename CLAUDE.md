# Meekon Displays — regole del progetto

Sito pubblico + area riservata (gestione eventi/ordini per i dipendenti) di **Meekon Displays**, ditta di tecnica per eventi.
Questo file vale per **tutti** gli agenti e le persone che lavorano sul progetto. In caso di dubbio decide l'agente **sicurezza** (`.claude/agents/sicurezza.md`), che coordina il lavoro.

## Regole non negoziabili (le fa rispettare l'agente sicurezza)

1. **Nessun segreto nel repository o nel browser.** Nessuna chiave API, token, password, IBAN, `.env` committato. Le chiavi esistono solo come variabili d'ambiente di Netlify, lette dalle Netlify Functions. Il codice nel browser non contiene nessuna chiave, nemmeno la "publishable/anon" di Supabase.
2. **Nessuna ubicazione della ditta sul sito pubblico**: niente indirizzo, città, CAP, mappa, P. IVA o coordinate bancarie. Si comunica solo l'area di lavoro: *tutta la Svizzera, e su richiesta Italia, Germania e Francia*.
3. **Nessun dato di clienti reali** (nomi, aziende, offerte) nel sito pubblico o nel repository. Sale/location, DJ e partner si pubblicano solo se il titolare li ha approvati (`"approvato": true` nei file `data/*.json`).
4. **Area riservata**: autenticazione obbligatoria lato server, cookie `HttpOnly; Secure; SameSite=Strict`, Row Level Security attiva su **tutte** le tabelle, `noindex` e `Disallow` in `robots.txt`.
5. **Header di sicurezza** (CSP stretta, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy) definiti in `netlify.toml`.
6. Nessuna dipendenza esterna senza motivo; versioni sempre fissate.

## Lingue
Sito pubblico in **IT (principale, `/`)**, **DE (`/de/`)**, **FR (`/fr/`)**, **EN (`/en/`)**. Tedesco svizzero: niente `ß` (si scrive `ss`). Area riservata: italiano.
I testi stanno solo in `src/i18n/*.json`; le pagine si generano con `python3 build.py`.

## Design
Le linee guida sono in `docs/design-guidelines.md` (colori, caratteri, componenti, tono). I colori derivano dal logo ufficiale (brand kit Canva "MeekonDisplay"). Non inventare nuovi colori o caratteri fuori dalle linee guida.

## Architettura
Vedi `docs/architettura.md` (stack, modello dati, API, flusso di autenticazione).

## Flusso di lavoro
- Ogni agente lavora solo nei file della sua area (vedi la sua definizione in `.claude/agents/`).
- Prima di ogni commit: `python3 build.py`, test (`npm test`), e revisione dell'agente **sicurezza**.
- Comandi utili: `python3 build.py` · `python3 -m http.server 8000` · `npm test`
