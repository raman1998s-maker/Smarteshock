# Supabase — database dell'area riservata

Lo schema completo (tabelle, indici, trigger, Row Level Security, vista per i tecnici)
è in `migrations/0001_schema.sql`. La specifica è in `docs/architettura.md`.

> Nessuna chiave va mai scritta in questo repository. La chiave `service_role`
> non serve e **non** va impostata su Netlify.

## 1. Creare il progetto
1. Su <https://supabase.com> crea un progetto (regione consigliata: Europa, es. Zurigo/Francoforte).
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

Controllo: in **Database → Tables** ogni tabella deve mostrare "RLS enabled".
In **Advisors → Security Advisor** non devono comparire avvisi su RLS mancante.

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

## Cosa garantisce lo schema (riassunto)
- **admin**: legge e scrive tutto.
- **tecnico**: vede solo gli eventi a cui è assegnato tramite la vista `eventi_tecnico`
  (senza `importo_chf`, `acconto_pagato`, `saldo_pagato`; del cliente solo nome e telefono),
  vede checklist e colleghi di quegli eventi, può modificare **solo** `caricato` e `note`
  della checklist (trigger `checklist_limita_tecnico`). Nessun accesso diretto a `eventi` e `clienti`.
- **anon** (visitatore del sito): solo `INSERT` su `richieste_web`, nessuna lettura.
- `numero_ordine` è generato in automatico (`AAAA-NNNN`, riparte ogni anno) e non è modificabile.
