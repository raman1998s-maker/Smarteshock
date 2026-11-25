-- 0007 Magazzino: catalogo degli articoli e materiale per evento.
--
-- articoli         il catalogo (quantità in magazzino, prezzi di noleggio e vendita,
--                  "in vendita" per il materiale usato da vendere)
-- checklist        diventa anche la lista del materiale dell'evento: una voce può
--                  essere collegata a un articolo (articolo_id); "caricato" = uscito
--                  dal magazzino, "rientrato" = tornato.
-- disponibilita_articoli(da, a)  quanti pezzi sono impegnati in quelle date e quanti sono fuori ora.

create table if not exists public.articoli (
  id                      uuid primary key default gen_random_uuid(),
  categoria               text not null check (char_length(categoria) between 1 and 60),
  marca                   text check (marca is null or char_length(marca) <= 80),
  descrizione             text not null check (char_length(descrizione) between 1 and 300),
  accessori               text check (accessori is null or char_length(accessori) <= 1000),
  note                    text check (note is null or char_length(note) <= 1000),
  quantita                integer not null default 0 check (quantita between 0 and 100000),
  prezzo_noleggio_giorno  numeric(12, 2) check (prezzo_noleggio_giorno is null or prezzo_noleggio_giorno >= 0),
  prezzo_vendita          numeric(12, 2) check (prezzo_vendita is null or prezzo_vendita >= 0),
  in_vendita              boolean not null default false,
  attivo                  boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists articoli_categoria_idx on public.articoli (categoria, descrizione);

drop trigger if exists trg_articoli_updated_at on public.articoli;
create trigger trg_articoli_updated_at before update on public.articoli
  for each row execute function public.set_updated_at();

alter table public.checklist
  add column if not exists articolo_id uuid references public.articoli (id) on delete set null,
  add column if not exists rientrato boolean not null default false;

create index if not exists checklist_articolo_idx on public.checklist (articolo_id);

-- Il tecnico può cambiare solo caricato, rientrato e note (non voce, quantità, articolo).
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
       or new.created_at is distinct from old.created_at then
      raise exception 'permesso negato: il tecnico può modificare solo caricato, rientrato e note'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS: il catalogo (con i prezzi) lo vede solo la gestione; cancella solo l'admin.
-- Il tecnico vede il materiale dei propri eventi tramite la checklist.
-- ---------------------------------------------------------------------
alter table public.articoli enable row level security;

drop policy if exists articoli_gestione_select on public.articoli;
drop policy if exists articoli_gestione_insert on public.articoli;
drop policy if exists articoli_gestione_update on public.articoli;
drop policy if exists articoli_admin_delete on public.articoli;
create policy articoli_gestione_select on public.articoli
  for select to authenticated using (public.gestione());
create policy articoli_gestione_insert on public.articoli
  for insert to authenticated with check (public.gestione());
create policy articoli_gestione_update on public.articoli
  for update to authenticated using (public.gestione()) with check (public.gestione());
create policy articoli_admin_delete on public.articoli
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- Disponibilità nel periodo [p_da, p_a]:
--   impegnati   pezzi nelle checklist di eventi CONFERMATI che si sovrappongono al periodo
--   in_offerta  pezzi in eventi in stato richiesta/offerta nello stesso periodo (non ancora sicuri)
--   fuori       pezzi caricati e non ancora rientrati, adesso (qualsiasi evento)
--   disponibili quantita - impegnati
-- p_escludi: evento da non contare (quello che si sta preparando).
-- SECURITY INVOKER: la RLS di articoli/eventi/checklist si applica (solo gestione).
-- ---------------------------------------------------------------------
create or replace function public.disponibilita_articoli(p_da date, p_a date, p_escludi uuid default null)
returns table (
  articolo_id  uuid,
  quantita     integer,
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
    where c.articolo_id is not null and c.caricato and not c.rientrato
      and e.stato <> 'annullato'
    group by c.articolo_id
  )
  select a.id, a.quantita,
         coalesce(sum(p.quantita) filter (where p.stato = 'confermato'), 0)::integer,
         coalesce(sum(p.quantita) filter (where p.stato in ('richiesta', 'offerta')), 0)::integer,
         coalesce(max(u.fuori), 0)::integer,
         (a.quantita - coalesce(sum(p.quantita) filter (where p.stato = 'confermato'), 0))::integer
  from public.articoli a
  left join periodo p on p.articolo_id = a.id
  left join uscite u on u.articolo_id = a.id
  where a.attivo
  group by a.id, a.quantita;
$$;

-- ---------------------------------------------------------------------
-- Privilegi
-- ---------------------------------------------------------------------
revoke all on public.articoli from public, anon, authenticated;
grant select, insert, update, delete on public.articoli to authenticated;

revoke all on function public.disponibilita_articoli(date, date, uuid) from public, anon;
grant execute on function public.disponibilita_articoli(date, date, uuid) to authenticated;
