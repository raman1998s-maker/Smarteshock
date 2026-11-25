-- 0006 Ruoli e permessi del gestionale.
--
-- Ruoli (public.staff.ruolo):
--   admin    tutto, compresi utenti, contenuti del sito e cancellazioni
--   ufficio  vendite e organizzazione: richieste, clienti, eventi, offerte, magazzino, agenda
--   tecnico  solo gli eventi a cui è assegnato, senza prezzi; spunta la checklist
--   base     solo i propri eventi di OGGI (agenda del giorno), senza checklist né prezzi
-- Ogni utente si attiva/disattiva con staff.attivo (solo admin).
--
-- In più: indirizzo e contatto sul posto dell'evento (visibili anche a tecnico e base).

-- ---------------------------------------------------------------------
-- Ruoli
-- ---------------------------------------------------------------------
alter table public.staff drop constraint if exists staff_ruolo_check;
alter table public.staff add constraint staff_ruolo_check
  check (ruolo in ('admin', 'ufficio', 'tecnico', 'base'));

-- Ruolo dell'utente corrente, null se non è un dipendente attivo.
create or replace function public.ruolo_corrente()
returns text
language sql stable security definer
set search_path = public
as $$
  select s.ruolo from public.staff s where s.id = auth.uid() and s.attivo;
$$;

-- true per admin e ufficio: chi gestisce richieste, clienti, eventi, offerte e magazzino.
create or replace function public.gestione()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.ruolo_corrente() in ('admin', 'ufficio'), false);
$$;

-- Data di oggi in Svizzera (il server lavora in UTC).
create or replace function public.oggi_ch()
returns date
language sql stable
set search_path = public
as $$ select (now() at time zone 'Europe/Zurich')::date; $$;

-- Deve restare sempre almeno un admin attivo (niente "chiusi fuori").
create or replace function public.staff_protegge_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE' or new.ruolo <> 'admin' or not new.attivo)
     and old.ruolo = 'admin' and old.attivo
     and not exists (
       select 1 from public.staff s
       where s.id <> old.id and s.ruolo = 'admin' and s.attivo
     ) then
    raise exception 'serve almeno un amministratore attivo' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_staff_protegge_admin on public.staff;
create trigger trg_staff_protegge_admin
  before update or delete on public.staff
  for each row execute function public.staff_protegge_admin();

-- ---------------------------------------------------------------------
-- Evento: indirizzo e contatto sul posto (per la squadra e la mappa)
-- ---------------------------------------------------------------------
alter table public.eventi
  add column if not exists indirizzo text
    check (indirizzo is null or char_length(indirizzo) <= 300),
  add column if not exists contatto_luogo_nome text
    check (contatto_luogo_nome is null or char_length(contatto_luogo_nome) <= 120),
  add column if not exists contatto_luogo_telefono text
    check (contatto_luogo_telefono is null or char_length(contatto_luogo_telefono) <= 40);

-- ---------------------------------------------------------------------
-- Policy: ciò che era "solo admin" diventa "gestione" (admin + ufficio),
-- tranne utenti (staff) e contenuti del sito, che restano solo admin.
-- La cancellazione degli eventi resta solo admin.
-- ---------------------------------------------------------------------
drop policy if exists clienti_admin_all on public.clienti;
drop policy if exists clienti_gestione_all on public.clienti;
create policy clienti_gestione_all on public.clienti
  for all to authenticated using (public.gestione()) with check (public.gestione());

drop policy if exists eventi_admin_all on public.eventi;
drop policy if exists eventi_gestione_select on public.eventi;
drop policy if exists eventi_gestione_insert on public.eventi;
drop policy if exists eventi_gestione_update on public.eventi;
drop policy if exists eventi_admin_delete on public.eventi;
create policy eventi_gestione_select on public.eventi
  for select to authenticated using (public.gestione());
create policy eventi_gestione_insert on public.eventi
  for insert to authenticated with check (public.gestione());
create policy eventi_gestione_update on public.eventi
  for update to authenticated using (public.gestione()) with check (public.gestione());
create policy eventi_admin_delete on public.eventi
  for delete to authenticated using (public.is_admin());

drop policy if exists eventi_staff_select on public.eventi_staff;
drop policy if exists eventi_staff_admin_insert on public.eventi_staff;
drop policy if exists eventi_staff_admin_update on public.eventi_staff;
drop policy if exists eventi_staff_admin_delete on public.eventi_staff;
drop policy if exists eventi_staff_gestione_insert on public.eventi_staff;
drop policy if exists eventi_staff_gestione_update on public.eventi_staff;
drop policy if exists eventi_staff_gestione_delete on public.eventi_staff;
create policy eventi_staff_select on public.eventi_staff
  for select to authenticated using (public.gestione() or public.is_assegnato(evento_id));
create policy eventi_staff_gestione_insert on public.eventi_staff
  for insert to authenticated with check (public.gestione());
create policy eventi_staff_gestione_update on public.eventi_staff
  for update to authenticated using (public.gestione()) with check (public.gestione());
create policy eventi_staff_gestione_delete on public.eventi_staff
  for delete to authenticated using (public.gestione());

-- checklist: gestione tutto; il tecnico (non il ruolo base) legge e spunta i propri eventi.
drop policy if exists checklist_select on public.checklist;
drop policy if exists checklist_update on public.checklist;
drop policy if exists checklist_admin_insert on public.checklist;
drop policy if exists checklist_admin_delete on public.checklist;
drop policy if exists checklist_gestione_insert on public.checklist;
drop policy if exists checklist_gestione_delete on public.checklist;
create policy checklist_select on public.checklist
  for select to authenticated
  using (public.gestione() or (public.ruolo_corrente() = 'tecnico' and public.is_assegnato(evento_id)));
create policy checklist_update on public.checklist
  for update to authenticated
  using (public.gestione() or (public.ruolo_corrente() = 'tecnico' and public.is_assegnato(evento_id)))
  with check (public.gestione() or (public.ruolo_corrente() = 'tecnico' and public.is_assegnato(evento_id)));
create policy checklist_gestione_insert on public.checklist
  for insert to authenticated with check (public.gestione());
create policy checklist_gestione_delete on public.checklist
  for delete to authenticated using (public.gestione());

drop policy if exists richieste_admin_all on public.richieste_web;
drop policy if exists richieste_gestione_all on public.richieste_web;
create policy richieste_gestione_all on public.richieste_web
  for all to authenticated using (public.gestione()) with check (public.gestione());

-- staff: anche l'ufficio legge l'elenco (serve per assegnare la squadra); scrive solo l'admin.
drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff
  for select to authenticated
  using (id = auth.uid() or public.gestione() or public.condivide_evento(id));

-- ---------------------------------------------------------------------
-- Funzioni esistenti: il controllo "solo admin" diventa "gestione".
-- Si riscrive la definizione attuale sostituendo solo la chiamata, così
-- non si duplica (e non si rischia di far divergere) il loro corpo.
-- ---------------------------------------------------------------------
do $$
declare
  f text;
  def text;
begin
  foreach f in array array[
    'public.imposta_staff_evento(uuid, jsonb)',
    'public.converti_richiesta(uuid, text)',
    'public.checklist_limita_tecnico()'
  ] loop
    def := pg_get_functiondef(f::regprocedure);
    if position('public.is_admin()' in def) = 0 then
      raise exception 'funzione % senza is_admin(): controllare a mano', f;
    end if;
    execute replace(def, 'public.is_admin()', 'public.gestione()');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Vista per tecnico e base: + indirizzo e contatto sul posto;
-- il ruolo base vede solo gli eventi in corso oggi.
-- ---------------------------------------------------------------------
drop view if exists public.eventi_tecnico;
drop function if exists public.eventi_assegnati();

create function public.eventi_assegnati()
returns table (
  id                      uuid,
  numero_ordine           text,
  cliente_id              uuid,
  cliente_nome            text,
  cliente_telefono        text,
  titolo                  text,
  tipo                    text,
  stato                   text,
  data_inizio             timestamp,
  data_fine               timestamp,
  localita                text,
  sala                    text,
  indirizzo               text,
  contatto_luogo_nome     text,
  contatto_luogo_telefono text,
  paese                   text,
  ospiti                  integer,
  servizi                 text[],
  programma               text,
  note_squadra            text,
  created_at              timestamptz,
  updated_at              timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.numero_ordine, e.cliente_id, c.nome, c.telefono,
         e.titolo, e.tipo, e.stato, e.data_inizio, e.data_fine,
         e.localita, e.sala, e.indirizzo, e.contatto_luogo_nome, e.contatto_luogo_telefono,
         e.paese, e.ospiti, e.servizi,
         e.programma, e.note_squadra, e.created_at, e.updated_at
  from public.eventi e
  left join public.clienti c on c.id = e.cliente_id
  where public.is_assegnato(e.id)
    and (
      public.ruolo_corrente() <> 'base'
      or public.oggi_ch() between e.data_inizio::date and coalesce(e.data_fine, e.data_inizio)::date
    );
$$;

create view public.eventi_tecnico
with (security_invoker = true, security_barrier = true) as
  select * from public.eventi_assegnati();

-- ---------------------------------------------------------------------
-- Privilegi
-- ---------------------------------------------------------------------
revoke all on public.eventi_tecnico from public, anon, authenticated;
grant select on public.eventi_tecnico to authenticated;

revoke all on function public.ruolo_corrente()       from public, anon;
revoke all on function public.gestione()             from public, anon;
revoke all on function public.oggi_ch()              from public, anon;
revoke all on function public.eventi_assegnati()     from public, anon;
revoke all on function public.staff_protegge_admin() from public, anon, authenticated;
grant execute on function public.ruolo_corrente()   to authenticated;
grant execute on function public.gestione()         to authenticated;
grant execute on function public.oggi_ch()          to authenticated;
grant execute on function public.eventi_assegnati() to authenticated;
