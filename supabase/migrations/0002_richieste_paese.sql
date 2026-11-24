-- =====================================================================
-- Meekon Displays — 0002: paese nelle richieste del sito
-- Specifica: docs/architettura.md
--
-- Il modulo pubblico invia anche il paese dell'evento (CH, IT, DE, FR).
--   * Nuova colonna richieste_web.paese (facoltativa, solo i 4 codici).
--   * anon può inserire anche questa colonna (privilegio di colonna).
--   * converti_richiesta passa il paese all'evento (default 'CH').
-- Migrazione rieseguibile.
-- =====================================================================

begin;

alter table public.richieste_web
  add column if not exists paese text;

alter table public.richieste_web
  drop constraint if exists richieste_web_paese_check;
alter table public.richieste_web
  add constraint richieste_web_paese_check
  check (paese is null or paese in ('CH', 'IT', 'DE', 'FR'));

-- anon: solo INSERT delle colonne del modulo, ora anche paese.
grant insert (paese) on public.richieste_web to anon;

-- Crea (o riusa, se l'e-mail esiste già) un cliente e un evento da una richiesta web.
-- Uguale alla versione di 0001, in più passa il paese (se assente: 'CH').
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

  insert into public.eventi (cliente_id, titolo, tipo, stato, data_inizio, localita, paese, ospiti, servizi, note_interne)
    values (
      v_cliente,
      left(coalesce(nullif(btrim(p_titolo), ''), coalesce(r.tipo || ' – ', '') || r.nome), 200),
      r.tipo,
      'richiesta',
      r.data::timestamp,
      r.localita,
      coalesce(r.paese, 'CH'),
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

-- create or replace mantiene i privilegi; si ribadiscono per sicurezza.
revoke all on function public.converti_richiesta(uuid, text) from public, anon;
grant execute on function public.converti_richiesta(uuid, text) to authenticated;

commit;
