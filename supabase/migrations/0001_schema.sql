-- =====================================================================
-- Meekon Displays — schema iniziale (Supabase / Postgres 15+)
-- Specifica: docs/architettura.md
--
-- Principi:
--   * RLS attiva su TUTTE le tabelle, policy minime.
--   * Ruoli applicativi in public.staff (admin | tecnico); ruoli Postgres
--     usati da Supabase: anon (visitatore), authenticated (utente loggato).
--   * Il tecnico non legge mai la tabella eventi direttamente: usa la vista
--     eventi_tecnico (senza campi economici).
--   * anon può solo inserire in richieste_web.
--   * Migrazione rieseguibile (idempotente dove possibile).
-- =====================================================================

begin;


-- ---------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------

create table if not exists public.staff (
  id          uuid primary key references auth.users (id) on delete cascade,
  nome        text not null check (char_length(nome) between 1 and 120),
  ruolo       text not null default 'tecnico' check (ruolo in ('admin', 'tecnico')),
  telefono    text check (telefono is null or char_length(telefono) <= 40),
  attivo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.clienti (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (char_length(nome) between 1 and 120),
  azienda     text check (azienda is null or char_length(azienda) <= 160),
  email       text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  telefono    text check (telefono is null or char_length(telefono) <= 40),
  lingua      text not null default 'it' check (lingua in ('it', 'de', 'fr', 'en')),
  note        text check (note is null or char_length(note) <= 4000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- data_inizio / data_fine: "timestamp without time zone" = ora locale
-- dell'evento (CH/IT/DE/FR sono tutti nello stesso fuso orario).
create table if not exists public.eventi (
  id              uuid primary key default gen_random_uuid(),
  numero_ordine   text not null unique check (numero_ordine ~ '^[0-9]{4}-[0-9]{4,}$'),
  cliente_id      uuid references public.clienti (id) on delete set null,
  titolo          text not null check (char_length(titolo) between 1 and 200),
  tipo            text check (tipo is null or char_length(tipo) <= 80),
  stato           text not null default 'richiesta'
                  check (stato in ('richiesta', 'offerta', 'confermato', 'completato', 'annullato')),
  data_inizio     timestamp,
  data_fine       timestamp,
  localita        text check (localita is null or char_length(localita) <= 200),
  sala            text check (sala is null or char_length(sala) <= 200),
  paese           text not null default 'CH' check (paese in ('CH', 'IT', 'DE', 'FR')),
  ospiti          integer check (ospiti is null or ospiti between 0 and 100000),
  servizi         text[] not null default '{}'
                  check (cardinality(servizi) <= 30),
  programma       text check (programma is null or char_length(programma) <= 10000),
  note_interne    text check (note_interne is null or char_length(note_interne) <= 10000),
  importo_chf     numeric(12, 2) check (importo_chf is null or importo_chf >= 0),
  acconto_pagato  boolean not null default false,
  saldo_pagato    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint eventi_date_ordine check (data_fine is null or data_inizio is null or data_fine >= data_inizio)
);

create table if not exists public.eventi_staff (
  evento_id     uuid not null references public.eventi (id) on delete cascade,
  staff_id      uuid not null references public.staff (id) on delete cascade,
  ruolo_evento  text check (ruolo_evento is null or char_length(ruolo_evento) <= 80),
  created_at    timestamptz not null default now(),
  primary key (evento_id, staff_id)
);

create table if not exists public.checklist (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventi (id) on delete cascade,
  voce        text not null check (char_length(voce) between 1 and 200),
  quantita    integer not null default 1 check (quantita between 1 and 100000),
  caricato    boolean not null default false,
  note        text check (note is null or char_length(note) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- evento_id: collegamento opzionale all'evento creato con "converti"
-- (aggiunta rispetto alla tabella in architettura.md, evita doppie conversioni).
create table if not exists public.richieste_web (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (char_length(nome) between 1 and 120),
  email       text not null check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telefono    text check (telefono is null or char_length(telefono) <= 40),
  tipo        text check (tipo is null or char_length(tipo) <= 80),
  data        date,
  localita    text check (localita is null or char_length(localita) <= 120),
  ospiti      integer check (ospiti is null or ospiti between 1 and 100000),
  servizi     text[] not null default '{}' check (cardinality(servizi) <= 15),
  messaggio   text check (messaggio is null or char_length(messaggio) <= 4000),
  lingua      text not null default 'it' check (lingua in ('it', 'de', 'fr', 'en')),
  stato       text not null default 'nuova' check (stato in ('nuova', 'gestita', 'scartata')),
  evento_id   uuid references public.eventi (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Contatore per numero_ordine (AAAA-NNNN, riparte da 1 ogni anno).
-- Nessun accesso diretto: lo usa solo la funzione trigger (SECURITY DEFINER).
create table if not exists public.contatori_ordine (
  anno    integer primary key,
  ultimo  integer not null default 0
);

-- ---------------------------------------------------------------------
-- Indici
-- ---------------------------------------------------------------------
create index if not exists eventi_data_inizio_idx   on public.eventi (data_inizio);
create index if not exists eventi_stato_idx         on public.eventi (stato);
create index if not exists eventi_cliente_idx       on public.eventi (cliente_id);
create index if not exists eventi_staff_staff_idx   on public.eventi_staff (staff_id);
create index if not exists checklist_evento_idx     on public.checklist (evento_id);
create index if not exists richieste_stato_idx      on public.richieste_web (stato, created_at desc);
create index if not exists richieste_evento_idx     on public.richieste_web (evento_id);
create index if not exists clienti_email_idx        on public.clienti (lower(email));

-- ---------------------------------------------------------------------
-- Funzioni helper (SECURITY DEFINER, search_path fissato)
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where s.id = auth.uid() and s.ruolo = 'admin' and s.attivo
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where s.id = auth.uid() and s.attivo
  );
$$;

-- true se l'utente corrente (attivo) è assegnato all'evento
create or replace function public.is_assegnato(p_evento uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.eventi_staff es
    join public.staff s on s.id = es.staff_id
    where es.evento_id = p_evento and es.staff_id = auth.uid() and s.attivo
  );
$$;

-- true se l'utente corrente condivide almeno un evento con il dipendente p_staff
create or replace function public.condivide_evento(p_staff uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.eventi_staff mio
    join public.eventi_staff altro on altro.evento_id = mio.evento_id
    join public.staff s on s.id = mio.staff_id
    where mio.staff_id = auth.uid() and s.attivo and altro.staff_id = p_staff
  );
$$;

-- ---------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['staff', 'clienti', 'eventi', 'checklist', 'richieste_web'] loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I', t);
    execute format(
      'create trigger trg_%1$s_updated_at before update on public.%1$I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- numero_ordine: assegnato in automatico all'inserimento, immutabile dopo.
create or replace function public.assegna_numero_ordine()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anno integer;
  v_num  integer;
begin
  if tg_op = 'INSERT' then
    v_anno := extract(year from (now() at time zone 'Europe/Zurich'))::integer;
    insert into public.contatori_ordine as c (anno, ultimo)
      values (v_anno, 1)
      on conflict (anno) do update set ultimo = c.ultimo + 1
      returning ultimo into v_num;
    new.numero_ordine := v_anno::text || '-' || lpad(v_num::text, 4, '0');
  elsif tg_op = 'UPDATE' then
    new.numero_ordine := old.numero_ordine;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_eventi_numero_ordine on public.eventi;
create trigger trg_eventi_numero_ordine
  before insert or update on public.eventi
  for each row execute function public.assegna_numero_ordine();

-- checklist: chi non è admin (tecnico) può cambiare solo caricato e note.
-- Le modifiche fatte da ruoli di servizio (dashboard, migrazioni) non sono toccate.
create or replace function public.checklist_limita_tecnico()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.id is distinct from old.id
       or new.evento_id is distinct from old.evento_id
       or new.voce is distinct from old.voce
       or new.quantita is distinct from old.quantita
       or new.created_at is distinct from old.created_at then
      raise exception 'permesso negato: il tecnico può modificare solo caricato e note'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_checklist_limita_tecnico on public.checklist;
create trigger trg_checklist_limita_tecnico
  before update on public.checklist
  for each row execute function public.checklist_limita_tecnico();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.staff            enable row level security;
alter table public.clienti          enable row level security;
alter table public.eventi           enable row level security;
alter table public.eventi_staff     enable row level security;
alter table public.checklist        enable row level security;
alter table public.richieste_web    enable row level security;
alter table public.contatori_ordine enable row level security;  -- nessuna policy: nessun accesso

-- Le policy vengono ricreate da zero (idempotenza).
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('staff', 'clienti', 'eventi', 'eventi_staff', 'checklist', 'richieste_web', 'contatori_ordine')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;

-- staff: ognuno legge sé stesso; il tecnico legge i colleghi degli eventi
-- a cui è assegnato (nome/telefono per coordinarsi); l'admin legge e scrive tutto.
create policy staff_select on public.staff
  for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.condivide_evento(id));
create policy staff_admin_insert on public.staff
  for insert to authenticated with check (public.is_admin());
create policy staff_admin_update on public.staff
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy staff_admin_delete on public.staff
  for delete to authenticated using (public.is_admin());

-- clienti: solo admin (il tecnico vede nome/telefono del cliente solo tramite eventi_tecnico).
create policy clienti_admin_all on public.clienti
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- eventi: solo admin (il tecnico usa la vista eventi_tecnico).
create policy eventi_admin_all on public.eventi
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- eventi_staff: admin tutto; tecnico legge le assegnazioni dei propri eventi.
create policy eventi_staff_select on public.eventi_staff
  for select to authenticated
  using (public.is_admin() or public.is_assegnato(evento_id));
create policy eventi_staff_admin_insert on public.eventi_staff
  for insert to authenticated with check (public.is_admin());
create policy eventi_staff_admin_update on public.eventi_staff
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy eventi_staff_admin_delete on public.eventi_staff
  for delete to authenticated using (public.is_admin());

-- checklist: admin tutto; tecnico legge e aggiorna (solo caricato/note, vedi trigger)
-- le voci dei propri eventi.
create policy checklist_select on public.checklist
  for select to authenticated
  using (public.is_admin() or public.is_assegnato(evento_id));
create policy checklist_update on public.checklist
  for update to authenticated
  using (public.is_admin() or public.is_assegnato(evento_id))
  with check (public.is_admin() or public.is_assegnato(evento_id));
create policy checklist_admin_insert on public.checklist
  for insert to authenticated with check (public.is_admin());
create policy checklist_admin_delete on public.checklist
  for delete to authenticated using (public.is_admin());

-- richieste_web: anon solo INSERT (nessuna lettura), sempre come "nuova".
create policy richieste_anon_insert on public.richieste_web
  for insert to anon
  with check (
    stato = 'nuova'
    and evento_id is null
    and char_length(nome) between 1 and 120
    and char_length(email) <= 254
    and (messaggio is null or char_length(messaggio) <= 4000)
  );
create policy richieste_admin_all on public.richieste_web
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Vista per il tecnico (senza campi economici)
-- La vista è security_invoker; i dati arrivano da una funzione SECURITY
-- DEFINER che restituisce SOLO gli eventi assegnati all'utente corrente e
-- SOLO colonne non economiche (+ nome/telefono del cliente). Così il tecnico
-- non ha bisogno di nessun permesso sulla tabella eventi.
-- ---------------------------------------------------------------------
create or replace function public.eventi_assegnati()
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
  note_interne     text,
  created_at       timestamptz,
  updated_at       timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.numero_ordine, e.cliente_id, c.nome, c.telefono,
         e.titolo, e.tipo, e.stato, e.data_inizio, e.data_fine,
         e.localita, e.sala, e.paese, e.ospiti, e.servizi,
         e.programma, e.note_interne, e.created_at, e.updated_at
  from public.eventi e
  left join public.clienti c on c.id = e.cliente_id
  where public.is_assegnato(e.id);
$$;

create or replace view public.eventi_tecnico
with (security_invoker = true, security_barrier = true) as
  select * from public.eventi_assegnati();

-- ---------------------------------------------------------------------
-- Funzioni RPC per operazioni in più passi (SECURITY INVOKER: la RLS
-- dell'admin si applica normalmente; in più controllano is_admin()).
-- ---------------------------------------------------------------------

-- Sostituisce le assegnazioni di un evento.
-- p_assegnazioni: [{"staff_id": "...", "ruolo_evento": "..."}]
create or replace function public.imposta_staff_evento(p_evento uuid, p_assegnazioni jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'permesso negato' using errcode = '42501';
  end if;
  if jsonb_typeof(p_assegnazioni) <> 'array' or jsonb_array_length(p_assegnazioni) > 50 then
    raise exception 'input non valido' using errcode = '22023';
  end if;
  if not exists (select 1 from public.eventi where id = p_evento) then
    raise exception 'evento inesistente' using errcode = 'P0002';
  end if;

  delete from public.eventi_staff where evento_id = p_evento;
  insert into public.eventi_staff (evento_id, staff_id, ruolo_evento)
    select p_evento, (a ->> 'staff_id')::uuid, nullif(a ->> 'ruolo_evento', '')
    from jsonb_array_elements(p_assegnazioni) a;
end;
$$;

-- Crea (o riusa, se l'e-mail esiste già) un cliente e un evento da una richiesta web.
create or replace function public.converti_richiesta(p_richiesta uuid, p_titolo text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r          public.richieste_web;
  v_cliente  uuid;
  v_evento   public.eventi;
begin
  if not public.is_admin() then
    raise exception 'permesso negato' using errcode = '42501';
  end if;

  select * into r from public.richieste_web where id = p_richiesta for update;
  if not found then
    raise exception 'richiesta inesistente' using errcode = 'P0002';
  end if;
  if r.evento_id is not null or r.stato <> 'nuova' then
    raise exception 'richiesta già gestita' using errcode = '23505';
  end if;

  select id into v_cliente from public.clienti
    where lower(email) = lower(r.email)
    order by created_at limit 1;
  if v_cliente is null then
    insert into public.clienti (nome, email, telefono, lingua)
      values (r.nome, r.email, r.telefono, r.lingua)
      returning id into v_cliente;
  end if;

  insert into public.eventi (cliente_id, titolo, tipo, stato, data_inizio, localita, ospiti, servizi, note_interne)
    values (
      v_cliente,
      left(coalesce(nullif(btrim(p_titolo), ''), coalesce(r.tipo || ' – ', '') || r.nome), 200),
      r.tipo,
      'richiesta',
      r.data::timestamp,
      r.localita,
      r.ospiti,
      r.servizi,
      r.messaggio
    )
    returning * into v_evento;

  update public.richieste_web
    set stato = 'gestita', evento_id = v_evento.id
    where id = r.id;

  return jsonb_build_object(
    'cliente_id', v_cliente,
    'evento_id', v_evento.id,
    'numero_ordine', v_evento.numero_ordine
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Privilegi: si parte da zero e si concede il minimo.
-- (Supabase di default concede ALL ad anon/authenticated sulle tabelle di public.)
-- ---------------------------------------------------------------------
revoke all on public.staff, public.clienti, public.eventi, public.eventi_staff,
              public.checklist, public.richieste_web, public.contatori_ordine,
              public.eventi_tecnico
  from public, anon, authenticated;

grant select, insert, update, delete on public.staff         to authenticated;
grant select, insert, update, delete on public.clienti       to authenticated;
grant select, insert, update, delete on public.eventi        to authenticated;
grant select, insert, update, delete on public.eventi_staff  to authenticated;
grant select, insert, update, delete on public.checklist     to authenticated;
grant select, insert, update, delete on public.richieste_web to authenticated;
grant select                         on public.eventi_tecnico to authenticated;

-- anon: solo INSERT delle colonne del modulo (nessun SELECT, nessuna altra colonna).
grant insert (nome, email, telefono, tipo, data, localita, ospiti, servizi, messaggio, lingua)
  on public.richieste_web to anon;

-- Funzioni: niente EXECUTE per public/anon.
revoke all on function public.is_admin()                               from public, anon;
revoke all on function public.is_staff()                               from public, anon;
revoke all on function public.is_assegnato(uuid)                       from public, anon;
revoke all on function public.condivide_evento(uuid)                   from public, anon;
revoke all on function public.eventi_assegnati()                       from public, anon;
revoke all on function public.imposta_staff_evento(uuid, jsonb)        from public, anon;
revoke all on function public.converti_richiesta(uuid, text)           from public, anon;
revoke all on function public.assegna_numero_ordine()                  from public, anon, authenticated;
revoke all on function public.checklist_limita_tecnico()               from public, anon, authenticated;
revoke all on function public.set_updated_at()                         from public, anon, authenticated;

grant execute on function public.is_admin()                        to authenticated;
grant execute on function public.is_staff()                        to authenticated;
grant execute on function public.is_assegnato(uuid)                to authenticated;
grant execute on function public.condivide_evento(uuid)            to authenticated;
grant execute on function public.eventi_assegnati()                to authenticated;
grant execute on function public.imposta_staff_evento(uuid, jsonb) to authenticated;
grant execute on function public.converti_richiesta(uuid, text)    to authenticated;

commit;
