-- =====================================================================
-- Meekon Displays — 0004: note degli eventi in due campi + pulizia
-- automatica delle richieste del sito senza seguito.
-- Specifica: docs/architettura.md
--
-- 1. eventi.note_squadra (visibili ai tecnici assegnati) accanto a
--    eventi.note_interne (solo admin). La funzione eventi_assegnati() e la
--    vista eventi_tecnico restituiscono note_squadra e NON più note_interne.
--    converti_richiesta (0002) resta invariata: il messaggio del cliente
--    continua a finire in note_interne (solo admin).
-- 2. Le richieste_web con evento_id null e più vecchie di 24 mesi vengono
--    cancellate ogni giorno (job pg_cron "pulisci_richieste_vecchie").
--    Seconda via (se pg_cron non è disponibile o per una pulizia subito):
--    l'admin chiama rpc pulisci_richieste_vecchie_admin() da
--    POST /api/richieste/pulizia.
--
-- Migrazione rieseguibile. Nota: dopo questa migrazione 0001 NON va più
-- rieseguita da sola (la sua eventi_assegnati() ha un'altra firma e
-- fallirebbe senza modificare nulla); se la si riesegue, rieseguire poi
-- 0002, 0003 e 0004 in ordine.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Note per la squadra
-- ---------------------------------------------------------------------
alter table public.eventi
  add column if not exists note_squadra text;

alter table public.eventi
  drop constraint if exists eventi_note_squadra_check;
alter table public.eventi
  add constraint eventi_note_squadra_check
  check (note_squadra is null or char_length(note_squadra) <= 10000);

-- La firma (colonne restituite) cambia: create or replace non basta.
-- La vista dipende dalla funzione, quindi si ricreano entrambe.
drop view if exists public.eventi_tecnico;
drop function if exists public.eventi_assegnati();

-- Solo gli eventi assegnati all'utente corrente, solo colonne non
-- economiche e senza note_interne (+ nome/telefono del cliente).
create function public.eventi_assegnati()
returns table (
  id               uuid,
  numero_ordine    text,
  cliente_id       uuid,
  cliente_nome     text,
  cliente_telefono text,
  titolo           text,
  tipo             text,
  stato            text,
  data_inizio      timestamp,
  data_fine        timestamp,
  localita         text,
  sala             text,
  paese            text,
  ospiti           integer,
  servizi          text[],
  programma        text,
  note_squadra     text,
  created_at       timestamptz,
  updated_at       timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.numero_ordine, e.cliente_id, c.nome, c.telefono,
         e.titolo, e.tipo, e.stato, e.data_inizio, e.data_fine,
         e.localita, e.sala, e.paese, e.ospiti, e.servizi,
         e.programma, e.note_squadra, e.created_at, e.updated_at
  from public.eventi e
  left join public.clienti c on c.id = e.cliente_id
  where public.is_assegnato(e.id);
$$;

create view public.eventi_tecnico
with (security_invoker = true, security_barrier = true) as
  select * from public.eventi_assegnati();

-- Privilegi come in 0001 (la vista e la funzione sono oggetti nuovi).
revoke all on function public.eventi_assegnati() from public, anon;
grant execute on function public.eventi_assegnati() to authenticated;
revoke all on public.eventi_tecnico from public, anon, authenticated;
grant select on public.eventi_tecnico to authenticated;

-- ---------------------------------------------------------------------
-- 2. Pulizia delle richieste senza seguito (24 mesi)
-- ---------------------------------------------------------------------

-- Usata dal job pg_cron. SECURITY DEFINER (il job gira come proprietario),
-- nessun EXECUTE per public/anon/authenticated.
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
  return v_cancellate;
end;
$$;

revoke all on function public.pulisci_richieste_vecchie() from public, anon, authenticated;

-- Seconda via, per l'area riservata (POST /api/richieste/pulizia).
-- SECURITY INVOKER: la RLS dell'admin si applica normalmente; in più
-- controlla is_admin(). Stesso criterio della funzione del job.
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
  return v_cancellate;
end;
$$;

revoke all on function public.pulisci_richieste_vecchie_admin() from public, anon;
grant execute on function public.pulisci_richieste_vecchie_admin() to authenticated;

commit;

-- ---------------------------------------------------------------------
-- Job giornaliero con pg_cron (fuori dalla transazione sopra: se pg_cron
-- non fosse disponibile, le modifiche precedenti restano valide e resta la
-- pulizia manuale dall'area riservata).
-- pg_cron crea i suoi oggetti nello schema "cron"; "with schema pg_catalog"
-- è la forma indicata dalla documentazione Supabase. cron.schedule con un nome già
-- esistente aggiorna il job invece di duplicarlo; per sicurezza il job
-- viene comunque tolto e ricreato. Orario in UTC: 03:17 ogni giorno.
-- ---------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;  -- come da documentazione Supabase (guides/cron/install)
  exception when others then
    raise warning 'pg_cron non disponibile (%): usare la pulizia manuale da POST /api/richieste/pulizia', sqlerrm;
    return;
  end;

  if exists (select 1 from cron.job where jobname = 'pulisci_richieste_vecchie') then
    perform cron.unschedule('pulisci_richieste_vecchie');
  end if;
  perform cron.schedule(
    'pulisci_richieste_vecchie',
    '17 3 * * *',
    'select public.pulisci_richieste_vecchie();'
  );
end;
$$;
