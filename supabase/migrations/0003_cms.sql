-- =====================================================================
-- Meekon Displays — 0003: contenuti pubblici modificabili (CMS)
-- Specifica: docs/architettura.md, sezione "Contenuti pubblici modificabili".
--
--   * Tabelle media_galleria, sale, dj, partner, testi, pubblicazioni.
--   * RLS su tutte: admin legge e scrive tutto; il tecnico non ha nessun accesso.
--   * anon (la build del sito, con la chiave anon): SELECT solo delle righe
--     pubblicate e solo delle colonne pubbliche (privilegi di colonna);
--     su testi SELECT di tutte le righe (sono testi pubblici).
--   * Bucket Storage privato "media": scrittura solo admin; anon può leggere
--     SOLO i file referenziati da righe pubblicate (serve alla build per
--     copiarli in /assets/media/). Nessun file in bozza è leggibile da anon.
--   * updated_at / updated_by impostati da trigger (non dal client).
-- Migrazione rieseguibile.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Tabelle
-- Percorsi media: solo nel bucket "media", nomi generati dalle API:
--   <cartella>/<uuid>.<ext>, cartella in (galleria, dj, partner).
-- ---------------------------------------------------------------------

create table if not exists public.media_galleria (
  id           uuid primary key default gen_random_uuid(),
  file_path    text not null
               check (file_path ~ '^(galleria|dj|partner)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|mp4)$'),
  poster_path  text
               check (poster_path is null or poster_path ~ '^(galleria|dj|partner)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'),
  tipo         text not null check (tipo in ('foto', 'video')),
  categoria    text not null check (categoria in ('matrimoni', 'aziende', 'feste', 'palco')),
  formato      text not null default 'wide' check (formato in ('wide', 'tall', 'reel')),
  alt_it       text not null check (char_length(alt_it) between 1 and 300),
  alt_de       text check (alt_de is null or char_length(alt_de) <= 300),
  alt_fr       text check (alt_fr is null or char_length(alt_fr) <= 300),
  alt_en       text check (alt_en is null or char_length(alt_en) <= 300),
  ordine       integer not null default 0 check (ordine between 0 and 100000),
  pubblicato   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null,
  -- foto: file immagine e niente poster; video: file mp4
  constraint media_galleria_tipo_file check (
    (tipo = 'foto' and file_path !~ '\.mp4$' and poster_path is null)
    or (tipo = 'video' and file_path ~ '\.mp4$')
  )
);

create table if not exists public.sale (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (char_length(nome) between 1 and 160),
  luogo       text check (luogo is null or char_length(luogo) <= 160),
  paese       text not null default 'CH' check (paese in ('CH', 'IT', 'DE', 'FR')),
  tipo_it     text check (tipo_it is null or char_length(tipo_it) <= 120),
  tipo_de     text check (tipo_de is null or char_length(tipo_de) <= 120),
  tipo_fr     text check (tipo_fr is null or char_length(tipo_fr) <= 120),
  tipo_en     text check (tipo_en is null or char_length(tipo_en) <= 120),
  ordine      integer not null default 0 check (ordine between 0 and 100000),
  pubblicato  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

create table if not exists public.dj (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (char_length(nome) between 1 and 120),
  genere_it   text check (genere_it is null or char_length(genere_it) <= 120),
  genere_de   text check (genere_de is null or char_length(genere_de) <= 120),
  genere_fr   text check (genere_fr is null or char_length(genere_fr) <= 120),
  genere_en   text check (genere_en is null or char_length(genere_en) <= 120),
  foto_path   text
              check (foto_path is null or foto_path ~ '^(galleria|dj|partner)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'),
  link        text
              check (link is null or (char_length(link) <= 500 and link ~ '^https://[^[:space:]"''<>\\]+$')),
  ordine      integer not null default 0 check (ordine between 0 and 100000),
  pubblicato  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

create table if not exists public.partner (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (char_length(nome) between 1 and 120),
  logo_path   text
              check (logo_path is null or logo_path ~ '^(galleria|dj|partner)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'),
  link        text
              check (link is null or (char_length(link) <= 500 and link ~ '^https://[^[:space:]"''<>\\]+$')),
  ordine      integer not null default 0 check (ordine between 0 and 100000),
  pubblicato  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

-- Testi del sito: sovrascrivono le chiavi di src/i18n/*.json (campo vuoto = testo del file).
create table if not exists public.testi (
  chiave      text primary key
              check (char_length(chiave) <= 120 and chiave ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  it          text check (it is null or char_length(it) <= 2000),
  de          text check (de is null or char_length(de) <= 2000),
  fr          text check (fr is null or char_length(fr) <= 2000),
  en          text check (en is null or char_length(en) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

-- Registro delle pubblicazioni (anche limite: 1 ogni 2 minuti).
create table if not exists public.pubblicazioni (
  id            uuid primary key default gen_random_uuid(),
  richiesta_da  uuid references public.staff (id) on delete set null,
  created_at    timestamptz not null default now(),
  esito         text not null default 'in_corso' check (esito in ('in_corso', 'avviata', 'errore')),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id) on delete set null
);

create index if not exists media_galleria_ordine_idx on public.media_galleria (ordine, created_at);
create index if not exists sale_ordine_idx           on public.sale (ordine, created_at);
create index if not exists dj_ordine_idx             on public.dj (ordine, created_at);
create index if not exists partner_ordine_idx        on public.partner (ordine, created_at);
create index if not exists pubblicazioni_created_idx on public.pubblicazioni (created_at desc);

-- ---------------------------------------------------------------------
-- Trigger: updated_at / updated_by (e richiesta_da) decisi dal DB, non dal client.
-- Se la modifica viene dalla dashboard (auth.uid() nullo) updated_by resta invariato.
-- ---------------------------------------------------------------------
create or replace function public.cms_audit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.updated_by := coalesce(auth.uid(), old.updated_by);
  end if;
  if tg_table_name = 'pubblicazioni' then
    if tg_op = 'INSERT' then
      new.richiesta_da := auth.uid();
    else
      new.richiesta_da := old.richiesta_da;
    end if;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['media_galleria', 'sale', 'dj', 'partner', 'testi', 'pubblicazioni'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format(
      'create trigger trg_%1$s_audit before insert or update on public.%1$I
         for each row execute function public.cms_audit()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.media_galleria enable row level security;
alter table public.sale           enable row level security;
alter table public.dj             enable row level security;
alter table public.partner        enable row level security;
alter table public.testi          enable row level security;
alter table public.pubblicazioni  enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('media_galleria', 'sale', 'dj', 'partner', 'testi', 'pubblicazioni')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;

-- admin: tutto. Il tecnico (authenticated non admin) non ha nessuna policy → nessun accesso.
create policy media_galleria_admin_all on public.media_galleria
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy sale_admin_all on public.sale
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy dj_admin_all on public.dj
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy partner_admin_all on public.partner
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy testi_admin_all on public.testi
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pubblicazioni_admin_all on public.pubblicazioni
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- anon (build del sito): solo righe pubblicate; testi tutti.
create policy media_galleria_anon_pubblicati on public.media_galleria
  for select to anon using (pubblicato = true);
create policy sale_anon_pubblicati on public.sale
  for select to anon using (pubblicato = true);
create policy dj_anon_pubblicati on public.dj
  for select to anon using (pubblicato = true);
create policy partner_anon_pubblicati on public.partner
  for select to anon using (pubblicato = true);
create policy testi_anon_select on public.testi
  for select to anon using (true);

-- ---------------------------------------------------------------------
-- Funzioni
-- ---------------------------------------------------------------------

-- true se il percorso è referenziato da una riga pubblicata (galleria, poster, foto DJ, logo partner).
create or replace function public.media_pubblicato(p_path text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select p_path is not null and (
       exists (select 1 from public.media_galleria g
               where g.pubblicato and (g.file_path = p_path or g.poster_path = p_path))
    or exists (select 1 from public.dj d where d.pubblicato and d.foto_path = p_path)
    or exists (select 1 from public.partner p where p.pubblicato and p.logo_path = p_path)
  );
$$;

-- Elenco dei file pubblicati (per la build). Restituisce solo percorsi, nessun altro dato.
create or replace function public.media_pubblicati()
returns table (file_path text)
language sql stable security definer
set search_path = public
as $$
  select g.file_path from public.media_galleria g where g.pubblicato
  union
  select g.poster_path from public.media_galleria g where g.pubblicato and g.poster_path is not null
  union
  select d.foto_path from public.dj d where d.pubblicato and d.foto_path is not null
  union
  select p.logo_path from public.partner p where p.pubblicato and p.logo_path is not null;
$$;

-- Nuovo ordine di una sezione: p_ids nell'ordine desiderato (ordine = 10, 20, 30, ...).
create or replace function public.cms_riordina(p_sezione text, p_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tabella text;
  v_n integer;
begin
  if not public.is_admin() then
    raise exception 'permesso negato' using errcode = '42501';
  end if;
  v_tabella := case p_sezione
    when 'galleria' then 'media_galleria'
    when 'sale' then 'sale'
    when 'dj' then 'dj'
    when 'partner' then 'partner'
  end;
  if v_tabella is null or p_ids is null or cardinality(p_ids) > 1000 then
    raise exception 'input non valido' using errcode = '22023';
  end if;
  execute format(
    'update public.%I t set ordine = x.pos * 10
       from unnest($1) with ordinality as x(id, pos)
      where t.id = x.id', v_tabella)
    using p_ids;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Registra una pubblicazione rispettando il limite di 1 ogni 2 minuti
-- (le richieste finite in "errore" non contano, così si può riprovare).
-- Lock transazionale: due richieste simultanee non passano entrambe.
create or replace function public.registra_pubblicazione()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ultima timestamptz;
  v_riga   public.pubblicazioni;
begin
  if not public.is_admin() then
    raise exception 'permesso negato' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('meekon_pubblicazioni'));
  select max(created_at) into v_ultima
    from public.pubblicazioni
   where esito <> 'errore' and created_at > now() - interval '2 minutes';
  if v_ultima is not null then
    return jsonb_build_object(
      'limite', true,
      'attesa_secondi', greatest(1, ceil(extract(epoch from (v_ultima + interval '2 minutes' - now()))))::integer
    );
  end if;
  insert into public.pubblicazioni default values returning * into v_riga;
  return jsonb_build_object('limite', false, 'id', v_riga.id, 'created_at', v_riga.created_at);
end;
$$;

-- ---------------------------------------------------------------------
-- Privilegi
-- ---------------------------------------------------------------------
revoke all on public.media_galleria, public.sale, public.dj, public.partner,
              public.testi, public.pubblicazioni
  from public, anon, authenticated;

grant select, insert, update, delete on public.media_galleria to authenticated;
grant select, insert, update, delete on public.sale           to authenticated;
grant select, insert, update, delete on public.dj             to authenticated;
grant select, insert, update, delete on public.partner        to authenticated;
grant select, insert, update, delete on public.testi          to authenticated;
grant select, insert, update         on public.pubblicazioni  to authenticated;

-- anon: solo le colonne pubbliche (niente id, updated_by, date).
grant select (file_path, poster_path, tipo, categoria, formato, alt_it, alt_de, alt_fr, alt_en, ordine, pubblicato)
  on public.media_galleria to anon;
grant select (nome, luogo, paese, tipo_it, tipo_de, tipo_fr, tipo_en, ordine, pubblicato)
  on public.sale to anon;
grant select (nome, genere_it, genere_de, genere_fr, genere_en, foto_path, link, ordine, pubblicato)
  on public.dj to anon;
grant select (nome, logo_path, link, ordine, pubblicato)
  on public.partner to anon;
grant select (chiave, it, de, fr, en)
  on public.testi to anon;

revoke all on function public.cms_audit()                      from public, anon, authenticated;
revoke all on function public.media_pubblicato(text)           from public;
revoke all on function public.media_pubblicati()               from public, anon;
revoke all on function public.cms_riordina(text, uuid[])       from public, anon;
revoke all on function public.registra_pubblicazione()         from public, anon;

grant execute on function public.media_pubblicato(text)        to anon, authenticated;
-- media_pubblicati(): non usata dalla build (legge le tabelle con la RLS); solo admin autenticati.
grant execute on function public.media_pubblicati()            to authenticated;
grant execute on function public.cms_riordina(text, uuid[])    to authenticated;
grant execute on function public.registra_pubblicazione()      to authenticated;

-- ---------------------------------------------------------------------
-- Storage: bucket privato "media"
-- Limiti anche a livello di bucket (tipo MIME e 200 MB): valgono pure per
-- i caricamenti con URL firmato. Il limite più stretto per le immagini
-- (10 MB) è controllato dall'API e di nuovo dalla build.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 209715200, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists media_admin_select        on storage.objects;
drop policy if exists media_admin_insert        on storage.objects;
drop policy if exists media_admin_update        on storage.objects;
drop policy if exists media_admin_delete        on storage.objects;
drop policy if exists media_anon_pubblicati     on storage.objects;

create policy media_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and public.is_admin());
create policy media_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and public.is_admin()
    and name ~ '^(galleria|dj|partner)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|mp4)$'
  );
create policy media_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and public.is_admin())
  with check (
    bucket_id = 'media'
    and public.is_admin()
    and name ~ '^(galleria|dj|partner)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|mp4)$'
  );
create policy media_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and public.is_admin());

-- anon: lettura SOLO dei file referenziati da righe pubblicate (contenuto già
-- pubblico sul sito). Le bozze restano illeggibili. Serve alla build.
create policy media_anon_pubblicati on storage.objects
  for select to anon
  using (bucket_id = 'media' and public.media_pubblicato(name));

commit;
