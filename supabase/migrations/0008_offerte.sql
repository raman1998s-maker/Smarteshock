-- 0008 Offerte: dalla richiesta del cliente all'offerta con righe, sconto e IVA.
--
-- offerte        una o più versioni per evento (versione 1, 2, …), con stato
--                bozza → inviata → accettata / rifiutata / scaduta
-- offerte_righe  righe dal catalogo (articolo_id) o libere: quantità × giorni × prezzo − sconto %
-- Totali calcolati sempre dal database (offerte_totali), mai fidandosi del browser.
-- nuova_offerta(evento, copia_da)   nuova versione (eventualmente copiata da una precedente)
-- imposta_righe_offerta(id, righe)  sostituisce le righe, solo in bozza
-- accetta_offerta(id): segna accettata, conferma l'evento e ne aggiorna l'importo (stessa transazione).
-- Solo gestione (admin + ufficio): i tecnici non vedono le offerte.

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
  articolo_id      uuid references public.articoli (id) on delete set null,
  posizione        integer not null default 0 check (posizione between 0 and 10000),
  descrizione      text not null check (char_length(descrizione) between 1 and 500),
  quantita         numeric(10, 2) not null default 1 check (quantita > 0 and quantita <= 100000),
  giorni           numeric(6, 2) not null default 1 check (giorni > 0 and giorni <= 365),
  prezzo_unitario  numeric(12, 2) not null default 0 check (prezzo_unitario >= 0),
  sconto_percento  numeric(5, 2) not null default 0 check (sconto_percento between 0 and 100),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists offerte_evento_idx on public.offerte (evento_id);
create index if not exists offerte_righe_offerta_idx on public.offerte_righe (offerta_id, posizione);

drop trigger if exists trg_offerte_updated_at on public.offerte;
create trigger trg_offerte_updated_at before update on public.offerte
  for each row execute function public.set_updated_at();
drop trigger if exists trg_offerte_righe_updated_at on public.offerte_righe;
create trigger trg_offerte_righe_updated_at before update on public.offerte_righe
  for each row execute function public.set_updated_at();

-- Totali (arrotondati ai 5 centesimi come d'uso in Svizzera solo sul totale finale).
create or replace view public.offerte_totali
with (security_invoker = true) as
  select o.id as offerta_id,
         coalesce(sum(round(r.quantita * r.giorni * r.prezzo_unitario * (1 - r.sconto_percento / 100), 2)), 0)::numeric(12, 2) as subtotale,
         o.sconto_chf,
         greatest(coalesce(sum(round(r.quantita * r.giorni * r.prezzo_unitario * (1 - r.sconto_percento / 100), 2)), 0) - o.sconto_chf, 0)::numeric(12, 2) as imponibile,
         o.iva_percento
  from public.offerte o
  left join public.offerte_righe r on r.offerta_id = o.id
  group by o.id;

create or replace function public.accetta_offerta(p_offerta uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_evento uuid;
  v_imponibile numeric;
  v_iva numeric;
begin
  if not public.gestione() then
    raise exception 'permesso negato' using errcode = '42501';
  end if;
  select o.evento_id into v_evento from public.offerte o where o.id = p_offerta for update;
  if not found then
    raise exception 'offerta inesistente' using errcode = 'P0002';
  end if;
  select t.imponibile, t.iva_percento into v_imponibile, v_iva
    from public.offerte_totali t where t.offerta_id = p_offerta;

  -- Le altre versioni ancora aperte dello stesso evento decadono.
  update public.offerte set stato = 'scaduta'
    where evento_id = v_evento and id <> p_offerta and stato in ('bozza', 'inviata');
  update public.offerte set stato = 'accettata' where id = p_offerta;
  update public.eventi
    set stato = 'confermato',
        importo_chf = round(round(v_imponibile * (1 + v_iva / 100) * 20) / 20, 2)
    where id = v_evento and stato in ('richiesta', 'offerta', 'confermato');
end;
$$;

-- Nuova offerta (versione successiva) per un evento; con p_copia_da copia testi e righe
-- di una versione precedente. L'evento passa da "richiesta" a "offerta".
create or replace function public.nuova_offerta(p_evento uuid, p_copia_da uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_versione integer;
  src public.offerte;
begin
  if not public.gestione() then
    raise exception 'permesso negato' using errcode = '42501';
  end if;
  perform 1 from public.eventi where id = p_evento for update;
  if not found then
    raise exception 'evento inesistente' using errcode = 'P0002';
  end if;
  select coalesce(max(versione), 0) + 1 into v_versione from public.offerte where evento_id = p_evento;

  if p_copia_da is not null then
    select * into src from public.offerte where id = p_copia_da and evento_id = p_evento;
    if not found then
      raise exception 'offerta da copiare inesistente' using errcode = 'P0002';
    end if;
  end if;

  insert into public.offerte (evento_id, versione, valida_fino, iva_percento, sconto_chf, introduzione, condizioni)
    values (p_evento, v_versione,
            public.oggi_ch() + 30,
            coalesce(src.iva_percento, 8.1), coalesce(src.sconto_chf, 0),
            src.introduzione, src.condizioni)
    returning id into v_id;

  if p_copia_da is not null then
    insert into public.offerte_righe (offerta_id, articolo_id, posizione, descrizione, quantita, giorni, prezzo_unitario, sconto_percento)
      select v_id, articolo_id, posizione, descrizione, quantita, giorni, prezzo_unitario, sconto_percento
      from public.offerte_righe where offerta_id = p_copia_da;
  end if;

  update public.eventi set stato = 'offerta' where id = p_evento and stato = 'richiesta';
  return v_id;
end;
$$;

-- Sostituisce tutte le righe di un'offerta in bozza (una sola transazione).
-- p_righe: [{"articolo_id": null, "descrizione": "...", "quantita": 1, "giorni": 1,
--            "prezzo_unitario": 100, "sconto_percento": 0}]
create or replace function public.imposta_righe_offerta(p_offerta uuid, p_righe jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_stato text;
begin
  if not public.gestione() then
    raise exception 'permesso negato' using errcode = '42501';
  end if;
  if jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) > 200 then
    raise exception 'input non valido' using errcode = '22023';
  end if;
  select stato into v_stato from public.offerte where id = p_offerta for update;
  if not found then
    raise exception 'offerta inesistente' using errcode = 'P0002';
  end if;
  if v_stato <> 'bozza' then
    raise exception 'si modificano solo le offerte in bozza' using errcode = '55000';
  end if;

  delete from public.offerte_righe where offerta_id = p_offerta;
  insert into public.offerte_righe (offerta_id, articolo_id, posizione, descrizione, quantita, giorni, prezzo_unitario, sconto_percento)
    select p_offerta, r.articolo_id, (r.ord - 1)::integer, r.descrizione,
           coalesce(r.quantita, 1), coalesce(r.giorni, 1), coalesce(r.prezzo_unitario, 0), coalesce(r.sconto_percento, 0)
    from rows from (jsonb_to_recordset(p_righe) as (
      articolo_id uuid, descrizione text, quantita numeric, giorni numeric,
      prezzo_unitario numeric, sconto_percento numeric
    )) with ordinality as r(articolo_id, descrizione, quantita, giorni, prezzo_unitario, sconto_percento, ord);
end;
$$;

alter table public.offerte enable row level security;
alter table public.offerte_righe enable row level security;

drop policy if exists offerte_gestione_all on public.offerte;
create policy offerte_gestione_all on public.offerte
  for all to authenticated using (public.gestione()) with check (public.gestione());

drop policy if exists offerte_righe_gestione_all on public.offerte_righe;
create policy offerte_righe_gestione_all on public.offerte_righe
  for all to authenticated using (public.gestione()) with check (public.gestione());

revoke all on public.offerte, public.offerte_righe, public.offerte_totali from public, anon, authenticated;
grant select, insert, update, delete on public.offerte, public.offerte_righe to authenticated;
grant select on public.offerte_totali to authenticated;

revoke all on function public.accetta_offerta(uuid)              from public, anon;
revoke all on function public.nuova_offerta(uuid, uuid)          from public, anon;
revoke all on function public.imposta_righe_offerta(uuid, jsonb) from public, anon;
grant execute on function public.accetta_offerta(uuid)              to authenticated;
grant execute on function public.nuova_offerta(uuid, uuid)          to authenticated;
grant execute on function public.imposta_righe_offerta(uuid, jsonb) to authenticated;
