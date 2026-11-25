# Supabase — database dell'area riservata

Lo schema completo (tabelle, indici, trigger, Row Level Security, vista per i tecnici)
è in `migrations/0001_schema.sql`. La specifica è in `docs/architettura.md`.

> Nessuna chiave va mai scritta in questo repository. La chiave `service_role`
> non serve e **non** va impostata su Netlify.

## 1. Creare il progetto
1. Su <https://supabase.com> crea un progetto con l'account di Meekon Displays, regione **UE, Francoforte (eu-central-1)** (coerente con l'informativa privacy: "server nell'UE").
2. **Authentication → Sign In / Providers → Email**: lascia attivo il login con e-mail e
   **disattiva "Allow new users to sign up"** (gli account li crea solo l'amministratore).
3. **Authentication → URL Configuration**: imposta *Site URL* su `https://meekondisplay.ch`.

## 2. Applicare la migrazione
Scegli uno dei due modi.

**A. Dalla dashboard (più semplice)**
1. Apri **SQL Editor → New query**.
2. Incolla tutto il contenuto di `migrations/0001_schema.sql` e premi **Run**.
3. La migrazione è rieseguibile: in caso di dubbio puoi lanciarla di nuovo
   (le policy vengono ricreate, i dati restano).

**B. Con la Supabase CLI**
```bash
supabase link --project-ref <id-progetto>
supabase db push
```

Le migrazioni vanno applicate **in ordine**: `0001_schema.sql`, `0002_richieste_paese.sql`,
`0003_cms.sql` (contenuti del sito: tabelle del CMS, bucket Storage privato `media` e relative policy),
`0004_note_pulizia.sql` (note per la squadra `eventi.note_squadra`, vista dei tecnici senza `note_interne`,
pulizia automatica delle richieste vecchie con pg_cron),
`0005_richieste_dettagli_tecnici.sql` (colonna `richieste_web.dettagli_tecnici` jsonb per il blocco
facoltativo "Dettagli tecnici sul luogo" del modulo; anon può solo inserirla).
Anche 0002, 0003, 0004 e 0005 sono rieseguibili. Dopo la 0004, la 0001 non va rieseguita da sola
(fallirebbe senza modificare nulla, perché `eventi_assegnati()` ha cambiato colonne): se serve,
rieseguire 0001, 0002, 0003, 0004 e 0005 in ordine. La 0005 ridefinisce anche le funzioni di pulizia della 0004
(in più toglie dopo 24 mesi i contatti dei fornitori dalle richieste convertite in evento): se si riesegue la 0004, rieseguire poi la 0005.

Controllo: in **Database → Tables** ogni tabella deve mostrare "RLS enabled".
In **Advisors → Security Advisor** non devono comparire avvisi su RLS mancante.

## 2b. Pulizia automatica delle richieste (pg_cron)
La 0004 attiva l'estensione `pg_cron` (disponibile anche nel piano gratuito; in alternativa
**Database → Extensions → pg_cron**, oppure **Integrations → Cron**) e crea il job giornaliero
`pulisci_richieste_vecchie` (03:17 UTC) che cancella le richieste del sito **senza evento**
più vecchie di 24 mesi.

Controllo (SQL Editor):
```sql
select jobid, jobname, schedule, command, active from cron.job
  where jobname = 'pulisci_richieste_vecchie';
-- ultime esecuzioni ed esito
select status, return_message, start_time from cron.job_run_details
  where jobid = (select jobid from cron.job where jobname = 'pulisci_richieste_vecchie')
  order by start_time desc limit 10;
```
Deve comparire una riga con `schedule = '17 3 * * *'` e `active = true`.

Se `pg_cron` non è disponibile, la migrazione termina comunque (con un avviso
"pg_cron non disponibile") e il job non esiste: in quel caso la pulizia si fa dall'area
riservata (pulsante dell'admin → `POST /api/richieste/pulizia`), per esempio una volta al mese.
Per attivare il job in seguito: abilitare pg_cron e rieseguire `0004_note_pulizia.sql`.

## 3. Creare il primo amministratore
1. **Authentication → Users → Add user → Create new user**: inserisci e-mail e una
   password robusta, spunta *Auto Confirm User*.
2. Copia l'**UID** dell'utente appena creato.
3. In **SQL Editor** esegui (sostituisci UID e nome):
   ```sql
   insert into public.staff (id, nome, ruolo, telefono)
   values ('UID-DELL-UTENTE', 'Nome Cognome', 'admin', null);
   ```

## 4. Aggiungere dipendenti (tecnici)
Come al punto 3, ma con `ruolo = 'tecnico'`:
```sql
insert into public.staff (id, nome, ruolo, telefono)
values ('UID-DELL-UTENTE', 'Nome Cognome', 'tecnico', '+41 ...');
```
Per bloccare un dipendente senza cancellarlo: `update public.staff set attivo = false where id = '...';`
(può ancora fare login su Supabase Auth, ma le API e la RLS gli negano tutto).

## 5. Variabili su Netlify
In **Project Settings → API** (o **API Keys**) trovi i valori da copiare in
Netlify → *Site configuration → Environment variables*:

| Variabile | Dove trovarla |
|---|---|
| `SUPABASE_URL` | Project URL (`https://<id>.supabase.co`) |
| `SUPABASE_ANON_KEY` | chiave `anon` (legacy) oppure *publishable key* |
| `ALLOWED_ORIGIN` | `https://meekondisplay.ch` (più origin separati da virgola) |
| `NETLIFY_BUILD_HOOK` | Netlify → *Site configuration → Build & deploy → Build hooks → Add build hook* (segreto) |

`SUPABASE_URL` e `SUPABASE_ANON_KEY` devono essere disponibili sia alle **Functions** sia alle
**Builds** (scope delle variabili su Netlify): la build legge i contenuti pubblicati del CMS.

## 6. Contenuti del sito (CMS)
- Dopo `0003_cms.sql`, in **Storage** deve comparire il bucket `media` **non pubblico**.
- Importazione iniziale dei contenuti di `data/*.json` (una sola volta, dal proprio computer):
  ```bash
  SUPABASE_URL=https://<id>.supabase.co SUPABASE_ANON_KEY=<chiave anon> node scripts/importa-dati.mjs --prova
  SUPABASE_URL=https://<id>.supabase.co SUPABASE_ANON_KEY=<chiave anon> node scripts/importa-dati.mjs
  ```
  Lo script chiede e-mail e password dell'amministratore (non le salva).
- In `netlify.toml` sostituire `https://*.supabase.co` nella CSP dell'area riservata con l'host esatto del progetto.

## Cosa garantisce lo schema (riassunto)
- **admin**: legge e scrive tutto.
- **tecnico**: vede solo gli eventi a cui è assegnato tramite la vista `eventi_tecnico`
  (senza `importo_chf`, `acconto_pagato`, `saldo_pagato`; del cliente solo nome e telefono),
  vede checklist e colleghi di quegli eventi, può modificare **solo** `caricato` e `note`
  della checklist (trigger `checklist_limita_tecnico`). Nessun accesso diretto a `eventi` e `clienti`.
  Vede `note_squadra`, mai `note_interne` (solo admin).
- **richieste_web** senza evento più vecchie di 24 mesi: cancellate ogni giorno (pg_cron) o dall'admin.
- **anon** (visitatore del sito / build): solo `INSERT` su `richieste_web`; lettura delle sole righe
  pubblicate del CMS (colonne pubbliche), dei testi e dei soli file pubblicati del bucket `media`.
- `numero_ordine` è generato in automatico (`AAAA-NNNN`, riparte ogni anno) e non è modificabile.
