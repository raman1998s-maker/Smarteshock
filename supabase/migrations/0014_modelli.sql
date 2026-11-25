-- 0014 Modelli di allestimento: pacchetti di materiale pronti (es. "Struttura con schermo davanti e dietro,
-- luci e audio ai lati", "Solo schermo davanti + luci", "Welcome board"). Scelti in un'offerta (Meekon o
-- partner) o nella lista materiale di un evento, aggiungono le loro voci, poi modificabili.
-- Li crea e modifica la gestione; i partner vedono solo quelli segnati "per i partner".

create table if not exists public.modelli (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null check (char_length(nome) between 1 and 120),
  descrizione  text check (descrizione is null or char_length(descrizione) <= 500),
  per_partner  boolean not null default true,
  attivo       boolean not null default true,
  posizione    integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.modelli_voci (
  id           uuid primary key default gen_random_uuid(),
  modello_id   uuid not null references public.modelli (id) on delete cascade,
  articolo_id  uuid not null references public.articoli (id) on delete cascade,
  quantita     integer not null default 1 check (quantita between 1 and 100000),
  posizione    integer not null default 0
);
create index if not exists modelli_voci_modello_idx on public.modelli_voci (modello_id, posizione);

drop trigger if exists trg_modelli_updated_at on public.modelli;
create trigger trg_modelli_updated_at before update on public.modelli
  for each row execute function public.set_updated_at();

alter table public.modelli enable row level security;
alter table public.modelli_voci enable row level security;

drop policy if exists modelli_select on public.modelli;
drop policy if exists modelli_gestione on public.modelli;
create policy modelli_select on public.modelli
  for select to authenticated using (public.gestione() or (public.is_partner() and per_partner and attivo));
create policy modelli_gestione on public.modelli
  for all to authenticated using (public.gestione()) with check (public.gestione());

drop policy if exists modelli_voci_select on public.modelli_voci;
drop policy if exists modelli_voci_gestione on public.modelli_voci;
create policy modelli_voci_select on public.modelli_voci
  for select to authenticated
  using (exists (select 1 from public.modelli m where m.id = modello_id
                 and (public.gestione() or (public.is_partner() and m.per_partner and m.attivo))));
create policy modelli_voci_gestione on public.modelli_voci
  for all to authenticated using (public.gestione()) with check (public.gestione());

-- Crea o aggiorna un modello con tutte le sue voci in una transazione.
-- p_dati: {"nome": "...", "descrizione": "...", "per_partner": true, "attivo": true,
--          "voci": [{"articolo_id": "...", "quantita": 2}]}
create or replace function public.salva_modello(p_id uuid, p_dati jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid := p_id;
begin
  if not public.gestione() then
    raise exception 'permesso negato' using errcode = '42501';
  end if;
  if jsonb_typeof(p_dati -> 'voci') <> 'array' or jsonb_array_length(p_dati -> 'voci') > 200 then
    raise exception 'input non valido' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.modelli (nome, descrizione, per_partner, attivo)
      values (p_dati ->> 'nome', nullif(p_dati ->> 'descrizione', ''), coalesce((p_dati ->> 'per_partner')::boolean, true), coalesce((p_dati ->> 'attivo')::boolean, true))
      returning id into v_id;
  else
    update public.modelli
      set nome = p_dati ->> 'nome', descrizione = nullif(p_dati ->> 'descrizione', ''),
          per_partner = coalesce((p_dati ->> 'per_partner')::boolean, true), attivo = coalesce((p_dati ->> 'attivo')::boolean, true)
      where id = v_id;
    if not found then
      raise exception 'modello inesistente' using errcode = 'P0002';
    end if;
    delete from public.modelli_voci where modello_id = v_id;
  end if;
  insert into public.modelli_voci (modello_id, articolo_id, quantita, posizione)
    select v_id, v.articolo_id, v.quantita, (v.ord - 1)::integer
    from rows from (jsonb_to_recordset(p_dati -> 'voci') as (articolo_id uuid, quantita integer))
      with ordinality as v(articolo_id, quantita, ord);
  return v_id;
end;
$$;

revoke all on public.modelli, public.modelli_voci from public, anon, authenticated;
grant select, insert, update, delete on public.modelli, public.modelli_voci to authenticated;
revoke all on function public.salva_modello(uuid, jsonb) from public, anon;
grant execute on function public.salva_modello(uuid, jsonb) to authenticated;
