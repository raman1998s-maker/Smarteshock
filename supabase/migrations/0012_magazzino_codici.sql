-- 0012 Magazzino come nel vecchio sistema (magazzino.ods):
--   articoli   codice dell'etichetta (es. E000006623), sottocategoria (es. Cables), pezzi danneggiati
--   checklist  al rientro: pezzi mancanti e danneggiati (il tecnico li può segnare)
-- La disponibilità esclude i pezzi danneggiati.

alter table public.articoli
  add column if not exists codice text unique check (codice is null or char_length(codice) between 1 and 40),
  add column if not exists sottocategoria text check (sottocategoria is null or char_length(sottocategoria) <= 60),
  add column if not exists danneggiati integer not null default 0 check (danneggiati >= 0);

alter table public.articoli drop constraint if exists articoli_danneggiati_max;
alter table public.articoli add constraint articoli_danneggiati_max check (danneggiati <= quantita);

alter table public.checklist
  add column if not exists mancanti integer not null default 0 check (mancanti between 0 and 100000),
  add column if not exists danneggiati integer not null default 0 check (danneggiati between 0 and 100000);

-- La firma cambia (colonna danneggiati): si ricrea.
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
    where c.articolo_id is not null and c.caricato and not c.rientrato
      and e.stato <> 'annullato'
    group by c.articolo_id
  )
  select a.id, a.quantita, a.danneggiati,
         coalesce(sum(p.quantita) filter (where p.stato = 'confermato'), 0)::integer,
         coalesce(sum(p.quantita) filter (where p.stato in ('richiesta', 'offerta')), 0)::integer,
         coalesce(max(u.fuori), 0)::integer,
         (a.quantita - a.danneggiati - coalesce(sum(p.quantita) filter (where p.stato = 'confermato'), 0))::integer
  from public.articoli a
  left join periodo p on p.articolo_id = a.id
  left join uscite u on u.articolo_id = a.id
  where a.attivo
  group by a.id, a.quantita, a.danneggiati;
$$;

revoke all on function public.disponibilita_articoli(date, date, uuid) from public, anon;
grant execute on function public.disponibilita_articoli(date, date, uuid) to authenticated;
