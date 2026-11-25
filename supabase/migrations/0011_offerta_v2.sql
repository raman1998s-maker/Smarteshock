-- 0011 Offerta secondo la specifica approvata (dicembre 2026):
--   - cliente: indirizzo completo (obbligatorio prima dell'invio) e formula di saluto ("Anrede")
--   - evento: inizio montaggio e smontaggio (riquadro evento del PDF, visibili anche alla squadra)
--   - righe opzionali (mostrate nel PDF, non sommate)
--   - con prezzi IVA inclusa, la quota IVA ("davon MWST") è arrotondata ai 5 centesimi
--   - accettazione online del cliente tramite link segreto: nome, data/ora, IP, versione AGB,
--     consenso foto; la conferma dell'ufficio richiede la location dell'evento.

-- ---------------------------------------------------------------------
-- Colonne nuove
-- ---------------------------------------------------------------------
alter table public.clienti
  add column if not exists indirizzo text check (indirizzo is null or char_length(indirizzo) <= 300),
  add column if not exists anrede text check (anrede is null or char_length(anrede) <= 200);

alter table public.eventi
  add column if not exists montaggio_da timestamp,
  add column if not exists smontaggio_da timestamp;

alter table public.offerte
  add column if not exists anrede text check (anrede is null or char_length(anrede) <= 200),
  add column if not exists token text unique check (token is null or token ~ '^[0-9a-f]{48}$'),
  add column if not exists accettata_il timestamptz,
  add column if not exists accettata_nome text check (accettata_nome is null or char_length(accettata_nome) <= 120),
  add column if not exists accettata_ip text check (accettata_ip is null or char_length(accettata_ip) <= 64),
  add column if not exists accettata_agb text check (accettata_agb is null or char_length(accettata_agb) <= 20),
  add column if not exists accettata_online boolean not null default false,
  add column if not exists foto_consenso boolean;

alter table public.offerte_righe
  add column if not exists opzionale boolean not null default false;

-- ---------------------------------------------------------------------
-- Totali: le righe opzionali non si sommano; "davon MWST" ai 5 centesimi
-- ---------------------------------------------------------------------
create or replace view public.offerte_totali
with (security_invoker = true) as
  with base as (
    select o.id, o.iva_percento, o.prezzi_iva_inclusa, o.sconto_percento, o.sconto_chf,
           coalesce(sum(round(r.quantita * r.giorni * r.prezzo_unitario * (1 - r.sconto_percento / 100), 2))
                    filter (where not r.opzionale), 0) as subtotale
    from public.offerte o
    left join public.offerte_righe r on r.offerta_id = o.id
    group by o.id
  ),
  scontato as (
    select b.*,
           round(b.subtotale * b.sconto_percento / 100, 2) as sconto_percento_chf,
           greatest(b.subtotale - round(b.subtotale * b.sconto_percento / 100, 2) - b.sconto_chf, 0) as imponibile
    from base b
  ),
  finale as (
    select s.*,
           case when s.prezzi_iva_inclusa then round(s.imponibile * 20) / 20
                else round((s.imponibile + round(s.imponibile * s.iva_percento / 100, 2)) * 20) / 20 end as totale
    from scontato s
  )
  select f.id as offerta_id,
         f.subtotale::numeric(12, 2) as subtotale,
         f.sconto_percento,
         f.sconto_percento_chf::numeric(12, 2) as sconto_percento_chf,
         f.sconto_chf,
         f.imponibile::numeric(12, 2) as imponibile,
         f.iva_percento,
         f.prezzi_iva_inclusa,
         (case when f.prezzi_iva_inclusa then round(f.totale * f.iva_percento / (100 + f.iva_percento) * 20) / 20
               else round(f.imponibile * f.iva_percento / 100, 2) end)::numeric(12, 2) as iva,
         f.totale::numeric(12, 2) as totale
  from finale f;

-- ---------------------------------------------------------------------
-- Conferma (interna): segna accettata, scadono le altre versioni, evento confermato.
-- Usata sia dall'ufficio (accetta_offerta) sia dal cliente online (accetta_offerta_online).
-- ---------------------------------------------------------------------
create or replace function public._conferma_offerta(p_offerta uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evento uuid;
  v_totale numeric;
begin
  select o.evento_id into v_evento from public.offerte o where o.id = p_offerta;
  select t.totale into v_totale from public.offerte_totali t where t.offerta_id = p_offerta;
  update public.offerte set stato = 'scaduta'
    where evento_id = v_evento and id <> p_offerta and stato in ('bozza', 'inviata');
  update public.offerte set stato = 'accettata', accettata_il = coalesce(accettata_il, now()) where id = p_offerta;
  update public.eventi set stato = 'confermato', importo_chf = v_totale
    where id = v_evento and stato in ('richiesta', 'offerta', 'confermato');
end;
$$;

-- Dall'ufficio: serve la location dell'evento (località o indirizzo).
create or replace function public.accetta_offerta(p_offerta uuid)
returns void
language plpgsql
security definer  -- controlla gestione() qui sotto; chiama _conferma_offerta (non eseguibile da authenticated)
set search_path = public
as $$
declare
  v_evento public.eventi;
begin
  if not public.gestione() then
    raise exception 'permesso negato' using errcode = '42501';
  end if;
  select e.* into v_evento
    from public.offerte o join public.eventi e on e.id = o.evento_id
    where o.id = p_offerta for update of o;
  if not found then
    raise exception 'offerta inesistente' using errcode = 'P0002';
  end if;
  if coalesce(btrim(v_evento.localita), '') = '' and coalesce(btrim(v_evento.indirizzo), '') = '' then
    raise exception 'manca la location dell''evento' using errcode = '55000';
  end if;
  perform public._conferma_offerta(p_offerta);
end;
$$;

-- ---------------------------------------------------------------------
-- Accettazione online (ruolo anon, chiamata solo dalla Netlify Function, che conosce
-- l'IP del cliente). Il token (48 caratteri esadecimali casuali) è il solo accesso.
-- ---------------------------------------------------------------------
create or replace function public.offerta_pubblica(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o public.offerte;
  e public.eventi;
  c public.clienti;
  t public.offerte_totali;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    return null;
  end if;
  select * into o from public.offerte where token = p_token and stato in ('inviata', 'accettata', 'scaduta', 'rifiutata');
  if not found then
    return null;
  end if;
  select * into e from public.eventi where id = o.evento_id;
  select * into c from public.clienti where id = e.cliente_id;
  select * into t from public.offerte_totali where offerta_id = o.id;
  return jsonb_build_object(
    'numero', e.numero_ordine || case when o.versione > 1 then '/' || o.versione else '' end,
    'stato', o.stato,
    'lingua', o.lingua,
    'valida_fino', o.valida_fino,
    'scaduta', o.stato = 'scaduta' or (o.stato = 'inviata' and o.valida_fino is not null and o.valida_fino < public.oggi_ch()),
    'accettata_il', o.accettata_il,
    'accettata_nome', o.accettata_nome,
    'cliente', coalesce(c.azienda, c.nome),
    'evento', jsonb_build_object('titolo', e.titolo, 'data_inizio', e.data_inizio, 'data_fine', e.data_fine,
                                 'luogo', concat_ws(', ', e.sala, coalesce(e.indirizzo, e.localita))),
    'righe', coalesce((select jsonb_agg(jsonb_build_object(
                 'titolo', r.titolo, 'descrizione', r.descrizione, 'quantita', r.quantita, 'giorni', r.giorni,
                 'prezzo_unitario', r.prezzo_unitario, 'sconto_percento', r.sconto_percento, 'opzionale', r.opzionale)
               order by r.posizione) from public.offerte_righe r where r.offerta_id = o.id), '[]'::jsonb),
    'totali', to_jsonb(t) - 'offerta_id',
    'agb_versione', (select dati -> 'regole' ->> 'agb_versione' from public.impostazioni where id = 1)
  );
end;
$$;

create or replace function public.accetta_offerta_online(p_token text, p_nome text, p_foto boolean, p_ip text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.offerte;
  v_agb text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    raise exception 'token non valido' using errcode = 'P0002';
  end if;
  if p_nome is null or char_length(btrim(p_nome)) not between 2 and 120 then
    raise exception 'nome non valido' using errcode = '22023';
  end if;
  select * into o from public.offerte where token = p_token for update;
  if not found then
    raise exception 'offerta inesistente' using errcode = 'P0002';
  end if;
  if o.stato <> 'inviata' or (o.valida_fino is not null and o.valida_fino < public.oggi_ch()) then
    raise exception 'offerta non più accettabile' using errcode = '55000';
  end if;
  select dati -> 'regole' ->> 'agb_versione' into v_agb from public.impostazioni where id = 1;
  update public.offerte
    set accettata_il = now(), accettata_nome = btrim(p_nome), accettata_ip = left(p_ip, 64),
        accettata_agb = left(coalesce(v_agb, '?'), 20), accettata_online = true, foto_consenso = coalesce(p_foto, false)
    where id = o.id;
  perform public._conferma_offerta(o.id);
  return jsonb_build_object('ok', true, 'accettata_il', now());
end;
$$;

-- ---------------------------------------------------------------------
-- Vista per tecnico e base: + inizio montaggio e smontaggio
-- ---------------------------------------------------------------------
drop view if exists public.eventi_tecnico;
drop function if exists public.eventi_assegnati();

create function public.eventi_assegnati()
returns table (
  id                      uuid,
  numero_ordine           text,
  cliente_id              uuid,
  cliente_nome            text,
  cliente_telefono        text,
  titolo                  text,
  tipo                    text,
  stato                   text,
  data_inizio             timestamp,
  data_fine               timestamp,
  montaggio_da            timestamp,
  smontaggio_da           timestamp,
  localita                text,
  sala                    text,
  indirizzo               text,
  contatto_luogo_nome     text,
  contatto_luogo_telefono text,
  paese                   text,
  ospiti                  integer,
  servizi                 text[],
  programma               text,
  note_squadra            text,
  created_at              timestamptz,
  updated_at              timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.numero_ordine, e.cliente_id, c.nome, c.telefono,
         e.titolo, e.tipo, e.stato, e.data_inizio, e.data_fine, e.montaggio_da, e.smontaggio_da,
         e.localita, e.sala, e.indirizzo, e.contatto_luogo_nome, e.contatto_luogo_telefono,
         e.paese, e.ospiti, e.servizi,
         e.programma, e.note_squadra, e.created_at, e.updated_at
  from public.eventi e
  left join public.clienti c on c.id = e.cliente_id
  where public.is_assegnato(e.id)
    and (
      public.ruolo_corrente() <> 'base'
      or public.oggi_ch() between e.data_inizio::date and coalesce(e.data_fine, e.data_inizio)::date
    );
$$;

create view public.eventi_tecnico
with (security_invoker = true, security_barrier = true) as
  select * from public.eventi_assegnati();

-- ---------------------------------------------------------------------
-- Privilegi
-- ---------------------------------------------------------------------
revoke all on public.eventi_tecnico from public, anon, authenticated;
grant select on public.eventi_tecnico to authenticated;
revoke all on public.offerte_totali from public, anon, authenticated;
grant select on public.offerte_totali to authenticated;

revoke all on function public.eventi_assegnati()                                 from public, anon;
revoke all on function public._conferma_offerta(uuid)                            from public, anon, authenticated;
revoke all on function public.offerta_pubblica(text)                             from public, authenticated;
revoke all on function public.accetta_offerta_online(text, text, boolean, text)  from public, authenticated;
grant execute on function public.eventi_assegnati()                                to authenticated;
grant execute on function public.accetta_offerta(uuid)                             to authenticated;
-- solo il ruolo anon (usato dalla Netlify Function pubblica, mai dal browser)
grant execute on function public.offerta_pubblica(text)                            to anon;
grant execute on function public.accetta_offerta_online(text, text, boolean, text) to anon;
