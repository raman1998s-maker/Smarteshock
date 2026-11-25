-- =====================================================================
-- Meekon Displays — 0005: dettagli tecnici sul luogo nelle richieste del sito
-- Specifica: docs/architettura.md
--
-- Il modulo pubblico ha un blocco facoltativo "Dettagli tecnici sul luogo"
-- (corrente, spazio, accesso, fumo, schermi, audio...).
--   * Nuova colonna richieste_web.dettagli_tecnici (jsonb, facoltativa):
--     deve essere un oggetto JSON e occupare meno di 8 kB (con tutti i campi
--     compilati al massimo e caratteri non latini si superano i 4 kB). I singoli
--     valori li valida la Netlify Function (enum e lunghezze massime).
--   * Contiene anche nome e contatto di altri fornitori dell'evento (dati di
--     terzi). Pulizia dopo 24 mesi: le richieste senza seguito vengono
--     cancellate come prima (0004); nelle richieste convertite in evento si
--     tolgono solo le chiavi forn_* (nome e contatto dei fornitori), il resto
--     dei dettagli tecnici resta con l'evento. Per questo qui si ridefiniscono
--     pulisci_richieste_vecchie() e pulisci_richieste_vecchie_admin(): stessa
--     firma, stessi permessi e stesso valore di ritorno (righe cancellate).
--   * anon può inserire anche questa colonna (privilegio di colonna);
--     nessuna lettura, RLS e policy invariate.
-- Migrazione rieseguibile.
-- =====================================================================

begin;

alter table public.richieste_web
  add column if not exists dettagli_tecnici jsonb;

alter table public.richieste_web
  drop constraint if exists richieste_web_dettagli_tecnici_check;
alter table public.richieste_web
  add constraint richieste_web_dettagli_tecnici_check
  check (
    dettagli_tecnici is null
    or (jsonb_typeof(dettagli_tecnici) = 'object' and pg_column_size(dettagli_tecnici) < 8192)
  );

-- anon: solo INSERT delle colonne del modulo, ora anche dettagli_tecnici.
grant insert (dettagli_tecnici) on public.richieste_web to anon;

-- Chiavi con i dati dei fornitori (dati di terzi) dentro dettagli_tecnici.
-- Uguali a FORNITORI in netlify/functions/_lib/schemas.js.
create or replace function public.chiavi_fornitori()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'forn_decorazioni_nome', 'forn_decorazioni_contatto',
    'forn_foto_nome', 'forn_foto_contatto',
    'forn_musica_nome', 'forn_musica_contatto',
    'forn_planner_nome', 'forn_planner_contatto',
    'forn_location_nome', 'forn_location_contatto'
  ]::text[];
$$;
revoke all on function public.chiavi_fornitori() from public, anon;
grant execute on function public.chiavi_fornitori() to authenticated;

-- Job pg_cron (vedi 0004). In più: dopo 24 mesi toglie i dati dei fornitori
-- anche dalle richieste convertite in evento.
create or replace function public.pulisci_richieste_vecchie()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancellate integer;
begin
  delete from public.richieste_web
    where evento_id is null
      and created_at < now() - interval '24 months';
  get diagnostics v_cancellate = row_count;
  update public.richieste_web
    set dettagli_tecnici = nullif(dettagli_tecnici - public.chiavi_fornitori(), '{}'::jsonb)
    where created_at < now() - interval '24 months'
      and dettagli_tecnici ?| public.chiavi_fornitori();
  return v_cancellate;
end;
$$;

revoke all on function public.pulisci_richieste_vecchie() from public, anon, authenticated;

-- Pulizia manuale dall'area riservata (vedi 0004): stesso criterio.
create or replace function public.pulisci_richieste_vecchie_admin()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cancellate integer;
begin
  if not public.is_admin() then
    raise exception 'permesso negato' using errcode = '42501';
  end if;
  delete from public.richieste_web
    where evento_id is null
      and created_at < now() - interval '24 months';
  get diagnostics v_cancellate = row_count;
  update public.richieste_web
    set dettagli_tecnici = nullif(dettagli_tecnici - public.chiavi_fornitori(), '{}'::jsonb)
    where created_at < now() - interval '24 months'
      and dettagli_tecnici ?| public.chiavi_fornitori();
  return v_cancellate;
end;
$$;

revoke all on function public.pulisci_richieste_vecchie_admin() from public, anon;
grant execute on function public.pulisci_richieste_vecchie_admin() to authenticated;

commit;
