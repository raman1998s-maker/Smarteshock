-- 0013 Area partner (DJ): offerte redatte dal partner a nome proprio, con il materiale di Meekon.
--
-- staff.ruolo 'partner'   account del DJ (creato dall'admin); vede solo la propria area
-- partner_profili         dati del partner per il PDF: ragione sociale, logo, banca, IVA, AGB (proprie o di Meekon);
--                         sconto_partner_percento lo decide solo la gestione
-- partner_offerte         offerta del partner al suo cliente (cliente ed evento scritti nell'offerta)
--                         stato: bozza → inviata → accettata / rifiutata / scaduta (lo gestisce il partner)
--                         materiale_stato: nessuno → in_attesa (offerta inviata) → da_confermare (accettata dal
--                         cliente) → confermato / rifiutato (dall'ufficio Meekon)
-- partner_righe           righe "servizio" (prestazioni del DJ) e "materiale" (articolo del catalogo Meekon)
-- conferma_materiale_partner(offerta)  l'ufficio conferma: nasce l'evento Meekon con la lista del materiale
-- Isolamento: il partner vede e modifica solo le proprie righe (RLS); la gestione vede tutto.

-- ---------------------------------------------------------------------
-- Ruolo
-- ---------------------------------------------------------------------
alter table public.staff drop constraint if exists staff_ruolo_check;
alter table public.staff add constraint staff_ruolo_check
  check (ruolo in ('admin', 'ufficio', 'tecnico', 'base', 'partner'));

create or replace function public.is_partner()
returns boolean
language sql stable security definer
set search_path = public
as $$ select coalesce(public.ruolo_corrente() = 'partner', false); $$;

-- ---------------------------------------------------------------------
-- Profilo del partner
-- ---------------------------------------------------------------------
create table if not exists public.partner_profili (
  staff_id         uuid primary key references public.staff (id) on delete cascade,
  ragione_sociale  text check (ragione_sociale is null or char_length(ragione_sociale) <= 160),
  persona          text check (persona is null or char_length(persona) <= 120),
  slogan           text check (slogan is null or char_length(slogan) <= 160),
  indirizzo        text check (indirizzo is null or char_length(indirizzo) <= 300),
  telefono         text check (telefono is null or char_length(telefono) <= 40),
  email            text check (email is null or char_length(email) <= 254),
  iban             text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  twint            text check (twint is null or char_length(twint) <= 40),
  mwst_pflichtig   boolean,
  mwst_nr          text check (mwst_nr is null or char_length(mwst_nr) <= 40),
  logo             text check (logo is null or (char_length(logo) <= 400000 and logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$')),
  usa_agb_meekon   boolean not null default true,
  agb              text check (agb is null or char_length(agb) <= 30000),
  sconto_partner_percento numeric(5, 2) not null default 0 check (sconto_partner_percento between 0 and 100),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists trg_partner_profili_updated_at on public.partner_profili;
create trigger trg_partner_profili_updated_at before update on public.partner_profili
  for each row execute function public.set_updated_at();

-- Lo sconto sul materiale lo decide solo la gestione.
create or replace function public.partner_profili_protegge()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.gestione() then
    if tg_op = 'INSERT' then
      new.sconto_partner_percento := 0;
    elsif new.sconto_partner_percento is distinct from old.sconto_partner_percento
       or new.staff_id is distinct from old.staff_id then
      raise exception 'permesso negato' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_partner_profili_protegge on public.partner_profili;
create trigger trg_partner_profili_protegge before insert or update on public.partner_profili
  for each row execute function public.partner_profili_protegge();

-- ---------------------------------------------------------------------
-- Offerte del partner
-- ---------------------------------------------------------------------
create table if not exists public.partner_offerte (
  id                 uuid primary key default gen_random_uuid(),
  partner_id         uuid not null default auth.uid() references public.staff (id) on delete cascade,
  numero             integer not null default 0,
  stato              text not null default 'bozza' check (stato in ('bozza', 'inviata', 'accettata', 'rifiutata', 'scaduta')),
  materiale_stato    text not null default 'nessuno'
                     check (materiale_stato in ('nessuno', 'in_attesa', 'da_confermare', 'confermato', 'rifiutato')),
  lingua             text not null default 'de' check (lingua in ('it', 'de', 'fr', 'en')),
  cliente_nome       text check (cliente_nome is null or char_length(cliente_nome) <= 120),
  cliente_azienda    text check (cliente_azienda is null or char_length(cliente_azienda) <= 160),
  cliente_indirizzo  text check (cliente_indirizzo is null or char_length(cliente_indirizzo) <= 300),
  cliente_email      text check (cliente_email is null or char_length(cliente_email) <= 254),
  cliente_telefono   text check (cliente_telefono is null or char_length(cliente_telefono) <= 40),
  anrede             text check (anrede is null or char_length(anrede) <= 200),
  evento_titolo      text check (evento_titolo is null or char_length(evento_titolo) <= 200),
  data_inizio        timestamp,
  data_fine          timestamp,
  montaggio_da       timestamp,
  luogo              text check (luogo is null or char_length(luogo) <= 300),
  valida_fino        date,
  iva_percento       numeric(5, 2) not null default 8.1 check (iva_percento between 0 and 30),
  prezzi_iva_inclusa boolean not null default true,
  sconto_percento    numeric(5, 2) not null default 0 check (sconto_percento between 0 and 100),
  sconto_chf         numeric(12, 2) not null default 0 check (sconto_chf >= 0),
  introduzione       text check (introduzione is null or char_length(introduzione) <= 4000),
  condizioni         text check (condizioni is null or char_length(condizioni) <= 4000),
  inviata_il         timestamptz,
  accettata_il       timestamptz,
  nota_meekon        text check (nota_meekon is null or char_length(nota_meekon) <= 2000),
  evento_id          uuid references public.eventi (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint partner_offerte_date check (data_fine is null or data_inizio is null or data_fine >= data_inizio)
);
create index if not exists partner_offerte_partner_idx on public.partner_offerte (partner_id, created_at desc);
create index if not exists partner_offerte_materiale_idx on public.partner_offerte (materiale_stato);

create table if not exists public.partner_righe (
  id               uuid primary key default gen_random_uuid(),
  offerta_id       uuid not null references public.partner_offerte (id) on delete cascade,
  posizione        integer not null default 0 check (posizione between 0 and 10000),
  tipo             text not null default 'servizio' check (tipo in ('servizio', 'materiale')),
  articolo_id      uuid references public.articoli (id) on delete set null,
  titolo           text check (titolo is null or char_length(titolo) <= 120),
  descrizione      text not null check (char_length(descrizione) between 1 and 500),
  quantita         numeric(10, 2) not null default 1 check (quantita > 0 and quantita <= 100000),
  giorni           numeric(6, 2) not null default 1 check (giorni > 0 and giorni <= 365),
  prezzo_unitario  numeric(12, 2) not null default 0 check (prezzo_unitario >= 0),
  sconto_percento  numeric(5, 2) not null default 0 check (sconto_percento between 0 and 100),
  opzionale        boolean not null default false,
  constraint partner_righe_materiale check (tipo = 'servizio' or articolo_id is not null)
);
create index if not exists partner_righe_offerta_idx on public.partner_righe (offerta_id, posizione);

drop trigger if exists trg_partner_offerte_updated_at on public.partner_offerte;
create trigger trg_partner_offerte_updated_at before update on public.partner_offerte
  for each row execute function public.set_updated_at();

-- Regole automatiche: numero progressivo per partner; stato del materiale che segue l'offerta;
-- il partner non può decidere lui il materiale né collegare eventi; modifiche solo in bozza.
create or replace function public.partner_offerte_regole()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_materiale boolean;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('partner_offerte:' || new.partner_id::text));
    select coalesce(max(numero), 0) + 1 into new.numero from public.partner_offerte where partner_id = new.partner_id;
    new.materiale_stato := 'nessuno';
    new.evento_id := null;
    if not public.gestione() then new.nota_meekon := null; end if;
    return new;
  end if;

  if not public.gestione() then
    -- campi dell'ufficio
    if new.materiale_stato is distinct from old.materiale_stato or new.evento_id is distinct from old.evento_id
       or new.nota_meekon is distinct from old.nota_meekon or new.partner_id is distinct from old.partner_id
       or new.numero is distinct from old.numero then
      raise exception 'permesso negato' using errcode = '42501';
    end if;
    -- dopo la bozza si cambia solo lo stato (inviata → accettata/rifiutata/scaduta)
    if old.stato <> 'bozza' and (row(new.cliente_nome, new.cliente_azienda, new.cliente_indirizzo, new.data_inizio, new.data_fine, new.luogo,
          new.iva_percento, new.prezzi_iva_inclusa, new.sconto_percento, new.sconto_chf)
        is distinct from row(old.cliente_nome, old.cliente_azienda, old.cliente_indirizzo, old.data_inizio, old.data_fine, old.luogo,
          old.iva_percento, old.prezzi_iva_inclusa, old.sconto_percento, old.sconto_chf)) then
      raise exception 'offerta non più modificabile' using errcode = '55000';
    end if;
    if new.stato is distinct from old.stato and not (
         (old.stato = 'bozza' and new.stato = 'inviata')
      or (old.stato = 'inviata' and new.stato in ('accettata', 'rifiutata', 'scaduta', 'bozza'))) then
      raise exception 'passaggio di stato non ammesso' using errcode = '55000';
    end if;
  end if;

  if new.stato is distinct from old.stato then
    select exists (select 1 from public.partner_righe r where r.offerta_id = new.id and r.tipo = 'materiale' and not r.opzionale)
      into v_materiale;
    if new.stato = 'inviata' then
      new.inviata_il := now();
      if v_materiale and old.materiale_stato in ('nessuno', 'rifiutato') then new.materiale_stato := 'in_attesa'; end if;
    elsif new.stato = 'accettata' then
      new.accettata_il := now();
      if v_materiale and old.materiale_stato in ('nessuno', 'in_attesa') then new.materiale_stato := 'da_confermare'; end if;
    elsif new.stato in ('rifiutata', 'scaduta', 'bozza') and old.materiale_stato in ('in_attesa', 'da_confermare') then
      new.materiale_stato := 'nessuno';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_partner_offerte_regole on public.partner_offerte;
create trigger trg_partner_offerte_regole before insert or update on public.partner_offerte
  for each row execute function public.partner_offerte_regole();

-- Righe: il partner le cambia solo finché l'offerta è in bozza.
create or replace function public.partner_righe_solo_bozza()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stato text;
begin
  -- (SECURITY DEFINER: current_user è il proprietario, quindi si guarda l'utente di Supabase)
  if auth.uid() is not null and not public.gestione() then
    select stato into v_stato from public.partner_offerte where id = coalesce(new.offerta_id, old.offerta_id);
    if v_stato is distinct from 'bozza' then
      raise exception 'offerta non più modificabile' using errcode = '55000';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_partner_righe_solo_bozza on public.partner_righe;
create trigger trg_partner_righe_solo_bozza before insert or update or delete on public.partner_righe
  for each row execute function public.partner_righe_solo_bozza();

-- ---------------------------------------------------------------------
-- Totali: per il cliente del partner e costo del materiale Meekon per il partner
-- ---------------------------------------------------------------------
create or replace view public.partner_offerte_totali
with (security_invoker = true) as
  with base as (
    select o.id, o.iva_percento, o.prezzi_iva_inclusa, o.sconto_percento, o.sconto_chf,
           coalesce(sum(round(r.quantita * r.giorni * r.prezzo_unitario * (1 - r.sconto_percento / 100), 2))
                    filter (where not r.opzionale), 0) as subtotale
    from public.partner_offerte o
    left join public.partner_righe r on r.offerta_id = o.id
    group by o.id
  ),
  finale as (
    select b.*,
           round(b.subtotale * b.sconto_percento / 100, 2) as sconto_percento_chf,
           greatest(b.subtotale - round(b.subtotale * b.sconto_percento / 100, 2) - b.sconto_chf, 0) as imponibile
    from base b
  ),
  tot as (
    select f.*,
           case when f.prezzi_iva_inclusa then round(f.imponibile * 20) / 20
                else round((f.imponibile + round(f.imponibile * f.iva_percento / 100, 2)) * 20) / 20 end as totale
    from finale f
  )
  select t.id as offerta_id, t.subtotale::numeric(12, 2) as subtotale, t.sconto_percento,
         t.sconto_percento_chf::numeric(12, 2) as sconto_percento_chf, t.sconto_chf, t.imponibile::numeric(12, 2) as imponibile,
         t.iva_percento, t.prezzi_iva_inclusa,
         (case when t.prezzi_iva_inclusa then round(t.totale * t.iva_percento / (100 + t.iva_percento) * 20) / 20
               else round(t.imponibile * t.iva_percento / 100, 2) end)::numeric(12, 2) as iva,
         t.totale::numeric(12, 2) as totale
  from tot t;

-- Costo del materiale per il partner: prezzo di noleggio Meekon meno lo sconto del partner.
create or replace function public.costo_materiale_partner(p_offerta uuid)
returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce(sum(round(r.quantita * r.giorni * coalesce(a.prezzo_noleggio_giorno, 0)
                            * (1 - coalesce(p.sconto_partner_percento, 0) / 100), 2)), 0)
  from public.partner_offerte o
  join public.partner_righe r on r.offerta_id = o.id and r.tipo = 'materiale' and not r.opzionale
  left join public.articoli a on a.id = r.articolo_id
  left join public.partner_profili p on p.staff_id = o.partner_id
  where o.id = p_offerta and (public.gestione() or o.partner_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Catalogo e disponibilità visti dal partner (senza dati interni)
-- ---------------------------------------------------------------------
create or replace function public.catalogo_partner(p_da date default null, p_a date default null)
returns table (id uuid, categoria text, sottocategoria text, marca text, descrizione text, accessori text,
               prezzo_partner numeric, disponibili integer)
language sql stable security definer
set search_path = public
as $$
  select a.id, a.categoria, a.sottocategoria, a.marca, a.descrizione, a.accessori,
         round(coalesce(a.prezzo_noleggio_giorno, 0) * (1 - coalesce(p.sconto_partner_percento, 0) / 100), 2),
         case when p_da is null then null else
           (a.quantita - a.danneggiati - coalesce((
             select sum(c.quantita) from public.checklist c join public.eventi e on e.id = c.evento_id
             where c.articolo_id = a.id and e.stato = 'confermato' and e.data_inizio is not null
               and e.data_inizio::date <= coalesce(p_a, p_da) and coalesce(e.data_fine, e.data_inizio)::date >= p_da), 0))::integer
         end
  from public.articoli a
  left join public.partner_profili p on p.staff_id = auth.uid()
  where a.attivo and a.prezzo_noleggio_giorno is not null
    and (public.is_partner() or public.gestione())
  order by a.categoria, a.descrizione;
$$;

-- ---------------------------------------------------------------------
-- Conferma del materiale dall'ufficio: crea l'evento Meekon con la lista del materiale
-- ---------------------------------------------------------------------
create or replace function public.conferma_materiale_partner(p_offerta uuid, p_nota text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.partner_offerte;
  v_partner text;
  v_evento uuid;
begin
  if not public.gestione() then
    raise exception 'permesso negato' using errcode = '42501';
  end if;
  select * into o from public.partner_offerte where id = p_offerta for update;
  if not found then
    raise exception 'offerta inesistente' using errcode = 'P0002';
  end if;
  if o.materiale_stato <> 'da_confermare' then
    raise exception 'materiale non da confermare' using errcode = '55000';
  end if;
  select coalesce(pp.ragione_sociale, s.nome) into v_partner
    from public.staff s left join public.partner_profili pp on pp.staff_id = s.id where s.id = o.partner_id;

  insert into public.eventi (titolo, tipo, stato, data_inizio, data_fine, montaggio_da, localita, importo_chf, note_interne)
    values (left(format('%s – %s', coalesce(o.evento_titolo, 'Evento'), v_partner), 200), 'Partner', 'confermato',
            o.data_inizio, o.data_fine, o.montaggio_da, left(o.luogo, 200),
            public.costo_materiale_partner(o.id),
            left(format('Materiale per il partner %s (offerta partner N. %s). Cliente finale: %s.', v_partner, o.numero,
                        coalesce(o.cliente_azienda, o.cliente_nome, '—')), 10000))
    returning id into v_evento;

  insert into public.checklist (evento_id, voce, quantita, articolo_id)
    select v_evento, left(coalesce(a.descrizione, r.titolo, r.descrizione), 200), greatest(1, ceil(r.quantita))::integer, r.articolo_id
    from public.partner_righe r left join public.articoli a on a.id = r.articolo_id
    where r.offerta_id = o.id and r.tipo = 'materiale' and not r.opzionale
    order by r.posizione;

  update public.partner_offerte
    set materiale_stato = 'confermato', evento_id = v_evento, nota_meekon = coalesce(nullif(btrim(p_nota), ''), nota_meekon)
    where id = o.id;
  return v_evento;
end;
$$;

-- Righe dell'offerta del partner, sostituite in una transazione (RLS e trigger "solo bozza" valgono).
create or replace function public.imposta_righe_partner(p_offerta uuid, p_righe jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) > 200 then
    raise exception 'input non valido' using errcode = '22023';
  end if;
  if not exists (select 1 from public.partner_offerte where id = p_offerta and partner_id = auth.uid()) then
    raise exception 'offerta inesistente' using errcode = 'P0002';
  end if;
  delete from public.partner_righe where offerta_id = p_offerta;
  insert into public.partner_righe (offerta_id, posizione, tipo, articolo_id, titolo, descrizione, quantita, giorni, prezzo_unitario, sconto_percento, opzionale)
    select p_offerta, (r.ord - 1)::integer, coalesce(r.tipo, 'servizio'), r.articolo_id, nullif(btrim(r.titolo), ''), r.descrizione,
           coalesce(r.quantita, 1), coalesce(r.giorni, 1), coalesce(r.prezzo_unitario, 0), coalesce(r.sconto_percento, 0), coalesce(r.opzionale, false)
    from rows from (jsonb_to_recordset(p_righe) as (
      tipo text, articolo_id uuid, titolo text, descrizione text, quantita numeric, giorni numeric,
      prezzo_unitario numeric, sconto_percento numeric, opzionale boolean
    )) with ordinality as r(tipo, articolo_id, titolo, descrizione, quantita, giorni, prezzo_unitario, sconto_percento, opzionale, ord);
end;
$$;

-- Regole e AGB di Meekon per il PDF del partner (che non legge la tabella impostazioni):
-- niente dati della ditta, solo regole, scaglioni e testi delle AGB.
create or replace function public.agb_meekon()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select case when public.is_partner() or public.gestione() then
    jsonb_build_object(
      'regole', coalesce(dati -> 'regole', '{}'::jsonb),
      'scaglioni', coalesce(dati -> 'scaglioni', '[]'::jsonb),
      'testi', coalesce((select jsonb_object_agg(k, jsonb_build_object('agb', v -> 'agb')) from jsonb_each(coalesce(dati -> 'testi', '{}'::jsonb)) as t(k, v)), '{}'::jsonb))
  end
  from public.impostazioni where id = 1;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.partner_profili enable row level security;
alter table public.partner_offerte enable row level security;
alter table public.partner_righe enable row level security;

drop policy if exists partner_profili_select on public.partner_profili;
drop policy if exists partner_profili_insert on public.partner_profili;
drop policy if exists partner_profili_update on public.partner_profili;
create policy partner_profili_select on public.partner_profili
  for select to authenticated using (public.gestione() or (staff_id = auth.uid() and public.is_partner()));
create policy partner_profili_insert on public.partner_profili
  for insert to authenticated with check (public.gestione() or (staff_id = auth.uid() and public.is_partner()));
create policy partner_profili_update on public.partner_profili
  for update to authenticated
  using (public.gestione() or (staff_id = auth.uid() and public.is_partner()))
  with check (public.gestione() or (staff_id = auth.uid() and public.is_partner()));

drop policy if exists partner_offerte_select on public.partner_offerte;
drop policy if exists partner_offerte_insert on public.partner_offerte;
drop policy if exists partner_offerte_update on public.partner_offerte;
drop policy if exists partner_offerte_delete on public.partner_offerte;
create policy partner_offerte_select on public.partner_offerte
  for select to authenticated using (public.gestione() or (partner_id = auth.uid() and public.is_partner()));
create policy partner_offerte_insert on public.partner_offerte
  for insert to authenticated with check (partner_id = auth.uid() and public.is_partner());
create policy partner_offerte_update on public.partner_offerte
  for update to authenticated
  using (public.gestione() or (partner_id = auth.uid() and public.is_partner()))
  with check (public.gestione() or (partner_id = auth.uid() and public.is_partner()));
create policy partner_offerte_delete on public.partner_offerte
  for delete to authenticated using (partner_id = auth.uid() and public.is_partner() and stato = 'bozza');

drop policy if exists partner_righe_select on public.partner_righe;
drop policy if exists partner_righe_scrive on public.partner_righe;
create policy partner_righe_select on public.partner_righe
  for select to authenticated
  using (exists (select 1 from public.partner_offerte o where o.id = offerta_id
                 and (public.gestione() or (o.partner_id = auth.uid() and public.is_partner()))));
create policy partner_righe_scrive on public.partner_righe
  for all to authenticated
  using (exists (select 1 from public.partner_offerte o where o.id = offerta_id and o.partner_id = auth.uid() and public.is_partner()))
  with check (exists (select 1 from public.partner_offerte o where o.id = offerta_id and o.partner_id = auth.uid() and public.is_partner()));

-- ---------------------------------------------------------------------
-- Privilegi
-- ---------------------------------------------------------------------
revoke all on public.partner_profili, public.partner_offerte, public.partner_righe, public.partner_offerte_totali
  from public, anon, authenticated;
grant select, insert, update on public.partner_profili to authenticated;
grant select, insert, update, delete on public.partner_offerte, public.partner_righe to authenticated;
grant select on public.partner_offerte_totali to authenticated;

revoke all on function public.is_partner()                              from public, anon;
revoke all on function public.costo_materiale_partner(uuid)             from public, anon;
revoke all on function public.catalogo_partner(date, date)              from public, anon;
revoke all on function public.conferma_materiale_partner(uuid, text)    from public, anon;
revoke all on function public.imposta_righe_partner(uuid, jsonb)        from public, anon;
revoke all on function public.agb_meekon()                              from public, anon;
revoke all on function public.partner_profili_protegge()                from public, anon, authenticated;
revoke all on function public.partner_offerte_regole()                  from public, anon, authenticated;
revoke all on function public.partner_righe_solo_bozza()                from public, anon, authenticated;
grant execute on function public.is_partner()                           to authenticated;
grant execute on function public.costo_materiale_partner(uuid)          to authenticated;
grant execute on function public.catalogo_partner(date, date)           to authenticated;
grant execute on function public.conferma_materiale_partner(uuid, text) to authenticated;
grant execute on function public.imposta_righe_partner(uuid, jsonb)     to authenticated;
grant execute on function public.agb_meekon()                           to authenticated;
