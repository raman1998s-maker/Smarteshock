-- 0010 Paga della squadra per evento e spese degli operai.
--
-- compensi  quanto si paga a ogni persona per un evento: ruolo (es. "Autista + Installatore"),
--           quantità (1, o i giorni di magazzino) × tariffa. Le tariffe proposte stanno in
--           impostazioni.dati.tariffe (modificabili dall'admin). Ognuno vede solo i propri compensi,
--           la gestione (admin + ufficio) tutti.
-- spese     spese anticipate dagli operai (cibo, diesel, materiale, altro): ognuno inserisce le
--           proprie (stato "inviata", anche legate a un proprio evento), la gestione le approva o rifiuta.

create table if not exists public.compensi (
  id           uuid primary key default gen_random_uuid(),
  evento_id    uuid not null references public.eventi (id) on delete cascade,
  staff_id     uuid not null references public.staff (id) on delete cascade,
  ruolo        text not null check (char_length(ruolo) between 1 and 80),
  quantita     numeric(6, 2) not null default 1 check (quantita > 0 and quantita <= 365),
  tariffa_chf  numeric(10, 2) not null check (tariffa_chf >= 0 and tariffa_chf <= 100000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists compensi_evento_idx on public.compensi (evento_id);
create index if not exists compensi_staff_idx on public.compensi (staff_id);

create table if not exists public.spese (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null default auth.uid() references public.staff (id) on delete cascade,
  evento_id    uuid references public.eventi (id) on delete set null,
  data         date not null default public.oggi_ch(),
  tipo         text not null check (tipo in ('cibo', 'diesel', 'materiale', 'altro')),
  importo_chf  numeric(10, 2) not null check (importo_chf > 0 and importo_chf <= 10000),
  descrizione  text check (descrizione is null or char_length(descrizione) <= 300),
  stato        text not null default 'inviata' check (stato in ('inviata', 'approvata', 'rifiutata')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists spese_staff_idx on public.spese (staff_id, data desc);
create index if not exists spese_stato_idx on public.spese (stato, data desc);

drop trigger if exists trg_compensi_updated_at on public.compensi;
create trigger trg_compensi_updated_at before update on public.compensi
  for each row execute function public.set_updated_at();
drop trigger if exists trg_spese_updated_at on public.spese;
create trigger trg_spese_updated_at before update on public.spese
  for each row execute function public.set_updated_at();

alter table public.compensi enable row level security;
alter table public.spese enable row level security;

drop policy if exists compensi_select on public.compensi;
drop policy if exists compensi_gestione_insert on public.compensi;
drop policy if exists compensi_gestione_update on public.compensi;
drop policy if exists compensi_gestione_delete on public.compensi;
create policy compensi_select on public.compensi
  for select to authenticated using (public.gestione() or (staff_id = auth.uid() and public.is_staff()));
create policy compensi_gestione_insert on public.compensi
  for insert to authenticated with check (public.gestione());
create policy compensi_gestione_update on public.compensi
  for update to authenticated using (public.gestione()) with check (public.gestione());
create policy compensi_gestione_delete on public.compensi
  for delete to authenticated using (public.gestione());

drop policy if exists spese_select on public.spese;
drop policy if exists spese_insert on public.spese;
drop policy if exists spese_gestione_update on public.spese;
drop policy if exists spese_delete on public.spese;
create policy spese_select on public.spese
  for select to authenticated using (public.gestione() or (staff_id = auth.uid() and public.is_staff()));
-- l'operaio inserisce solo spese proprie, "inviate", e solo su eventi a cui è assegnato
create policy spese_insert on public.spese
  for insert to authenticated
  with check (
    public.gestione()
    or (staff_id = auth.uid() and public.is_staff() and stato = 'inviata'
        and (evento_id is null or public.is_assegnato(evento_id)))
  );
-- approvare/rifiutare (e correggere) è della gestione
create policy spese_gestione_update on public.spese
  for update to authenticated using (public.gestione()) with check (public.gestione());
-- l'operaio può ritirare una spesa finché non è stata decisa
create policy spese_delete on public.spese
  for delete to authenticated
  using (public.gestione() or (staff_id = auth.uid() and public.is_staff() and stato = 'inviata'));

-- Sostituisce i compensi di un evento (una transazione).
-- p_compensi: [{"staff_id": "...", "ruolo": "Autista", "quantita": 1, "tariffa_chf": 150}]
create or replace function public.imposta_compensi_evento(p_evento uuid, p_compensi jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.gestione() then
    raise exception 'permesso negato' using errcode = '42501';
  end if;
  if jsonb_typeof(p_compensi) <> 'array' or jsonb_array_length(p_compensi) > 100 then
    raise exception 'input non valido' using errcode = '22023';
  end if;
  if not exists (select 1 from public.eventi where id = p_evento) then
    raise exception 'evento inesistente' using errcode = 'P0002';
  end if;
  delete from public.compensi where evento_id = p_evento;
  insert into public.compensi (evento_id, staff_id, ruolo, quantita, tariffa_chf)
    select p_evento, c.staff_id, c.ruolo, coalesce(c.quantita, 1), c.tariffa_chf
    from jsonb_to_recordset(p_compensi) as c(staff_id uuid, ruolo text, quantita numeric, tariffa_chf numeric);
end;
$$;

-- I miei compensi con titolo e data dell'evento (anche per chi non legge la tabella eventi).
create or replace function public.miei_compensi(p_da date default null, p_a date default null)
returns table (id uuid, evento_id uuid, titolo text, numero_ordine text, data_inizio timestamp,
               ruolo text, quantita numeric, tariffa_chf numeric)
language sql stable security definer
set search_path = public
as $$
  select c.id, c.evento_id, e.titolo, e.numero_ordine, e.data_inizio, c.ruolo, c.quantita, c.tariffa_chf
  from public.compensi c
  join public.eventi e on e.id = c.evento_id
  where c.staff_id = auth.uid() and public.is_staff()
    and (p_da is null or e.data_inizio::date >= p_da)
    and (p_a is null or e.data_inizio::date <= p_a)
  order by e.data_inizio;
$$;

revoke all on public.compensi, public.spese from public, anon, authenticated;
grant select, insert, update, delete on public.compensi, public.spese to authenticated;

revoke all on function public.imposta_compensi_evento(uuid, jsonb) from public, anon;
revoke all on function public.miei_compensi(date, date)          from public, anon;
grant execute on function public.imposta_compensi_evento(uuid, jsonb) to authenticated;
grant execute on function public.miei_compensi(date, date)          to authenticated;
