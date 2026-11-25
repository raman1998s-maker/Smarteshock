-- 0006 Offerte: dalla richiesta del cliente all'offerta con righe, sconto e IVA.
-- Bozza: i permessi passano da public.puo_vendere(), che per ora vale solo per
-- gli admin e verrà estesa al ruolo "ufficio" nella PR dei ruoli.

create or replace function public.puo_vendere()
returns boolean
language sql stable security definer
set search_path = public
as $$ select public.is_admin(); $$;

create table if not exists public.offerte (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references public.eventi (id) on delete cascade,
  versione      integer not null default 1 check (versione between 1 and 99),
  stato         text not null default 'bozza'
                check (stato in ('bozza', 'inviata', 'accettata', 'rifiutata', 'scaduta')),
  valida_fino   date,
  iva_percento  numeric(5, 2) not null default 8.1 check (iva_percento between 0 and 30),
  sconto_chf    numeric(12, 2) not null default 0 check (sconto_chf >= 0),
  introduzione  text check (introduzione is null or char_length(introduzione) <= 4000),
  condizioni    text check (condizioni is null or char_length(condizioni) <= 4000),
  inviata_il    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (evento_id, versione)
);

create table if not exists public.offerte_righe (
  id               uuid primary key default gen_random_uuid(),
  offerta_id       uuid not null references public.offerte (id) on delete cascade,
  posizione        integer not null default 0,
  descrizione      text not null check (char_length(descrizione) between 1 and 500),
  quantita         numeric(10, 2) not null default 1 check (quantita > 0),
  giorni           numeric(6, 2) not null default 1 check (giorni > 0),
  prezzo_unitario  numeric(12, 2) not null default 0 check (prezzo_unitario >= 0),
  sconto_percento  numeric(5, 2) not null default 0 check (sconto_percento between 0 and 100),
  created_at       timestamptz not null default now()
);

create index if not exists offerte_evento_idx on public.offerte (evento_id);
create index if not exists offerte_righe_offerta_idx on public.offerte_righe (offerta_id, posizione);

drop trigger if exists trg_offerte_updated_at on public.offerte;
create trigger trg_offerte_updated_at before update on public.offerte
  for each row execute function public.set_updated_at();

alter table public.offerte enable row level security;
alter table public.offerte_righe enable row level security;

-- I tecnici non vedono le offerte (contengono i prezzi).
drop policy if exists offerte_vendita_all on public.offerte;
create policy offerte_vendita_all on public.offerte
  for all to authenticated using (public.puo_vendere()) with check (public.puo_vendere());

drop policy if exists offerte_righe_vendita_all on public.offerte_righe;
create policy offerte_righe_vendita_all on public.offerte_righe
  for all to authenticated using (public.puo_vendere()) with check (public.puo_vendere());

revoke all on public.offerte, public.offerte_righe from anon;
