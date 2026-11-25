-- 0016 Materiale difettoso, peso degli articoli, flotta veicoli e carico per evento.
--
-- guasti            pezzi guasti di un articolo: stato da_riparare → in_riparazione → riparato / da_buttare,
--                   descrizione del guasto, costo; finché non è "riparato" il pezzo non è disponibile.
--                   Se al rientro di un evento si segnano pezzi danneggiati, il guasto si crea da solo.
-- articoli.peso_kg  peso di un pezzo
-- veicoli           furgoni: targa, portata utile (kg), volume, scadenze collaudo (MFK) e assicurazione
-- eventi_veicoli    veicoli usati da un evento; checklist.veicolo_id = su quale furgone va la voce
-- carico_veicoli(evento)  peso caricato per veicolo, con la portata

-- ---------------------------------------------------------------------
-- Peso e guasti
-- ---------------------------------------------------------------------
alter table public.articoli
  add column if not exists peso_kg numeric(8, 2) check (peso_kg is null or (peso_kg >= 0 and peso_kg <= 100000));

create table if not exists public.guasti (
  id            uuid primary key default gen_random_uuid(),
  articolo_id   uuid not null references public.articoli (id) on delete cascade,
  quantita      integer not null default 1 check (quantita between 1 and 100000),
  stato         text not null default 'da_riparare' check (stato in ('da_riparare', 'in_riparazione', 'riparato', 'da_buttare')),
  descrizione   text check (descrizione is null or char_length(descrizione) <= 1000),
  costo_chf     numeric(10, 2) check (costo_chf is null or costo_chf >= 0),
  evento_id     uuid references public.eventi (id) on delete set null,
  segnalato_da  uuid default auth.uid() references public.staff (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists guasti_articolo_idx on public.guasti (articolo_id, stato);

drop trigger if exists trg_guasti_updated_at on public.guasti;
create trigger trg_guasti_updated_at before update on public.guasti
  for each row execute function public.set_updated_at();

-- Al rientro: se i pezzi danneggiati di una voce collegata al magazzino aumentano, nasce un guasto.
create or replace function public.checklist_crea_guasto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nuovi integer := coalesce(new.danneggiati, 0) - coalesce(case when tg_op = 'UPDATE' then old.danneggiati end, 0);
begin
  if new.articolo_id is not null and v_nuovi > 0 then
    insert into public.guasti (articolo_id, quantita, descrizione, evento_id, segnalato_da)
      values (new.articolo_id, v_nuovi, left(coalesce('Danneggiato al rientro: ' || nullif(btrim(new.note), ''), 'Danneggiato al rientro dall''evento'), 1000),
              new.evento_id, auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists trg_checklist_crea_guasto on public.checklist;
create trigger trg_checklist_crea_guasto after insert or update of danneggiati on public.checklist
  for each row execute function public.checklist_crea_guasto();

-- ---------------------------------------------------------------------
-- Veicoli
-- ---------------------------------------------------------------------
create table if not exists public.veicoli (
  id                     uuid primary key default gen_random_uuid(),
  nome                   text not null check (char_length(nome) between 1 and 80),
  targa                  text check (targa is null or char_length(targa) <= 20),
  portata_kg             integer not null check (portata_kg between 1 and 100000),
  volume_m3              numeric(6, 2) check (volume_m3 is null or volume_m3 >= 0),
  scadenza_collaudo      date,
  scadenza_assicurazione date,
  note                   text check (note is null or char_length(note) <= 1000),
  attivo                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
drop trigger if exists trg_veicoli_updated_at on public.veicoli;
create trigger trg_veicoli_updated_at before update on public.veicoli
  for each row execute function public.set_updated_at();

create table if not exists public.eventi_veicoli (
  evento_id  uuid not null references public.eventi (id) on delete cascade,
  veicolo_id uuid not null references public.veicoli (id) on delete cascade,
  primary key (evento_id, veicolo_id)
);

alter table public.checklist
  add column if not exists veicolo_id uuid references public.veicoli (id) on delete set null;

-- Il tecnico non sposta le voci tra i veicoli (lo decide l'ufficio).
create or replace function public.checklist_limita_tecnico()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.gestione() then
    if new.id is distinct from old.id
       or new.evento_id is distinct from old.evento_id
       or new.voce is distinct from old.voce
       or new.quantita is distinct from old.quantita
       or new.articolo_id is distinct from old.articolo_id
       or new.veicolo_id is distinct from old.veicolo_id
       or new.created_at is distinct from old.created_at then
      raise exception 'permesso negato: il tecnico può modificare solo caricato, rientrato, mancanti, danneggiati e note'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Peso caricato per ogni veicolo dell'evento (e quello non ancora assegnato, veicolo_id null).
create or replace function public.carico_veicoli(p_evento uuid)
returns table (veicolo_id uuid, nome text, targa text, portata_kg integer, peso_kg numeric, voci integer, senza_peso integer)
language sql stable security definer
set search_path = public
as $$
  with voci as (
    select c.veicolo_id, c.quantita * coalesce(a.peso_kg, 0) as peso, (c.articolo_id is null or a.peso_kg is null) as senza_peso
    from public.checklist c left join public.articoli a on a.id = c.articolo_id
    where c.evento_id = p_evento
  ),
  veic as (
    select v.id, v.nome, v.targa, v.portata_kg from public.eventi_veicoli ev join public.veicoli v on v.id = ev.veicolo_id
    where ev.evento_id = p_evento
    union
    select v.id, v.nome, v.targa, v.portata_kg from public.veicoli v where v.id in (select veicolo_id from voci where veicolo_id is not null)
  )
  select x.id, x.nome, x.targa, x.portata_kg, coalesce(sum(vo.peso), 0)::numeric(10, 2), count(vo.*)::integer, count(*) filter (where vo.senza_peso)::integer
  from veic x left join voci vo on vo.veicolo_id = x.id
  where public.gestione() or public.is_assegnato(p_evento)
  group by x.id, x.nome, x.targa, x.portata_kg
  union all
  select null, null, null, null, coalesce(sum(peso), 0)::numeric(10, 2), count(*)::integer, count(*) filter (where senza_peso)::integer
  from voci where veicolo_id is null and (public.gestione() or public.is_assegnato(p_evento));
$$;

-- ---------------------------------------------------------------------
-- Disponibilità: esclusi anche i pezzi guasti non ancora riparati
-- ---------------------------------------------------------------------
drop function if exists public.disponibilita_articoli(date, date, uuid);
create function public.disponibilita_articoli(p_da date, p_a date, p_escludi uuid default null)
returns table (
  articolo_id  uuid,
  quantita     integer,
  danneggiati  integer,
  impegnati    integer,
  in_offerta   integer,
  fuori        integer,
  disponibili  integer
)
language sql stable security invoker
set search_path = public
as $$
  with periodo as (
    select c.articolo_id, e.stato, c.quantita
    from public.checklist c
    join public.eventi e on e.id = c.evento_id
    where c.articolo_id is not null
      and (p_escludi is null or e.id <> p_escludi)
      and e.data_inizio is not null
      and e.data_inizio::date <= p_a
      and coalesce(e.data_fine, e.data_inizio)::date >= p_da
  ),
  uscite as (
    select c.articolo_id, sum(c.quantita)::integer as fuori
    from public.checklist c
    join public.eventi e on e.id = c.evento_id
    where c.articolo_id is not null and c.caricato and not c.rientrato and e.stato <> 'annullato'
    group by c.articolo_id
  ),
  rotti as (
    select g.articolo_id, sum(g.quantita)::integer as n
    from public.guasti g where g.stato <> 'riparato'
    group by g.articolo_id
  )
  select a.id, a.quantita, (a.danneggiati + coalesce(max(r.n), 0))::integer,
         coalesce(sum(p.quantita) filter (where p.stato = 'confermato'), 0)::integer,
         coalesce(sum(p.quantita) filter (where p.stato in ('richiesta', 'offerta')), 0)::integer,
         coalesce(max(u.fuori), 0)::integer,
         (a.quantita - a.danneggiati - coalesce(max(r.n), 0) - coalesce(sum(p.quantita) filter (where p.stato = 'confermato'), 0))::integer
  from public.articoli a
  left join periodo p on p.articolo_id = a.id
  left join uscite u on u.articolo_id = a.id
  left join rotti r on r.articolo_id = a.id
  where a.attivo
  group by a.id, a.quantita, a.danneggiati;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.guasti enable row level security;
alter table public.veicoli enable row level security;
alter table public.eventi_veicoli enable row level security;

drop policy if exists guasti_gestione on public.guasti;
create policy guasti_gestione on public.guasti
  for all to authenticated using (public.gestione()) with check (public.gestione());

drop policy if exists veicoli_select on public.veicoli;
drop policy if exists veicoli_gestione on public.veicoli;
-- la squadra vede i veicoli (nome e targa servono il giorno dell'evento); li gestisce l'ufficio
create policy veicoli_select on public.veicoli
  for select to authenticated using (public.gestione() or (public.is_staff() and not public.is_partner()));
create policy veicoli_gestione on public.veicoli
  for all to authenticated using (public.gestione()) with check (public.gestione());

drop policy if exists eventi_veicoli_select on public.eventi_veicoli;
drop policy if exists eventi_veicoli_gestione on public.eventi_veicoli;
create policy eventi_veicoli_select on public.eventi_veicoli
  for select to authenticated using (public.gestione() or public.is_assegnato(evento_id));
create policy eventi_veicoli_gestione on public.eventi_veicoli
  for all to authenticated using (public.gestione()) with check (public.gestione());

revoke all on public.guasti, public.veicoli, public.eventi_veicoli from public, anon, authenticated;
grant select, insert, update, delete on public.guasti, public.veicoli, public.eventi_veicoli to authenticated;

revoke all on function public.carico_veicoli(uuid)                   from public, anon;
revoke all on function public.disponibilita_articoli(date, date, uuid) from public, anon;
revoke all on function public.checklist_crea_guasto()               from public, anon, authenticated;
grant execute on function public.carico_veicoli(uuid)                   to authenticated;
grant execute on function public.disponibilita_articoli(date, date, uuid) to authenticated;
