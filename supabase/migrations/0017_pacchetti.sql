-- 0017 Prezzi a pacchetto: un modello di allestimento entra nell'offerta come UNA riga con un prezzo unico
-- (es. "Schermo dietro con luci sopra", CHF 1'200/giorno) e la descrizione di cosa comprende; i singoli
-- articoli restano nella riga (componenti) per magazzino, peso e disponibilità.
--
-- modelli          + prezzo_giorno (prezzo di noleggio del pacchetto al giorno) e categoria (per i gruppi del PDF)
-- offerte_righe,   + modello_id e componenti ([{articolo_id, quantita}] per 1 pacchetto)
-- partner_righe    (partner_righe: nuovo tipo 'pacchetto'; costo per il partner = prezzo del pacchetto − suo sconto)
-- conferma_materiale_partner  la lista materiale comprende anche i componenti dei pacchetti

alter table public.modelli
  add column if not exists prezzo_giorno numeric(12, 2) check (prezzo_giorno is null or prezzo_giorno >= 0),
  add column if not exists categoria text check (categoria is null or char_length(categoria) <= 60),
  -- parte del disegno del configuratore a cui corrisponde il pacchetto (es. schermo_dietro)
  add column if not exists parte text check (parte is null or parte in ('truss', 'luci_truss', 'schermo_dietro', 'schermo_davanti', 'regia', 'live_stream', 'microfono', 'casse_top', 'sub', 'monitor_dj', 'luci_stativo', 'nebbia', 'effetti', 'dance_floor', 'welcome_board')),
  -- disegno dello schema di allestimento (data URL PNG/JPEG/WebP): i partner scelgono guardando il disegno
  add column if not exists immagine text check (immagine is null or (char_length(immagine) <= 900000 and immagine ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'));

alter table public.offerte_righe
  add column if not exists modello_id uuid references public.modelli (id) on delete set null,
  add column if not exists componenti jsonb check (componenti is null or (jsonb_typeof(componenti) = 'array' and jsonb_array_length(componenti) <= 200)),
  -- scelta nel configuratore: { parte, w, h } (schermi in moduli 0,5 × 1 m, pista in pannelli 1 × 1 m) o { parte, n }
  add column if not exists configurazione jsonb check (configurazione is null or (jsonb_typeof(configurazione) = 'object' and pg_column_size(configurazione) <= 400));

alter table public.partner_righe
  add column if not exists modello_id uuid references public.modelli (id) on delete set null,
  add column if not exists componenti jsonb check (componenti is null or (jsonb_typeof(componenti) = 'array' and jsonb_array_length(componenti) <= 200)),
  -- scelta nel configuratore: { parte, w, h } (schermi in moduli 0,5 × 1 m, pista in pannelli 1 × 1 m) o { parte, n }
  add column if not exists configurazione jsonb check (configurazione is null or (jsonb_typeof(configurazione) = 'object' and pg_column_size(configurazione) <= 400));
alter table public.partner_righe drop constraint if exists partner_righe_tipo_check;
alter table public.partner_righe add constraint partner_righe_tipo_check check (tipo in ('servizio', 'materiale', 'pacchetto'));
alter table public.partner_righe drop constraint if exists partner_righe_materiale;
alter table public.partner_righe add constraint partner_righe_materiale
  check ((tipo <> 'materiale' or articolo_id is not null) and (tipo <> 'pacchetto' or componenti is not null));

-- Modelli: salva anche prezzo e categoria.
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
    insert into public.modelli (nome, descrizione, per_partner, attivo, prezzo_giorno, categoria, immagine, parte)
      values (p_dati ->> 'nome', nullif(p_dati ->> 'descrizione', ''), coalesce((p_dati ->> 'per_partner')::boolean, true),
              coalesce((p_dati ->> 'attivo')::boolean, true), (p_dati ->> 'prezzo_giorno')::numeric, nullif(p_dati ->> 'categoria', ''),
              nullif(p_dati ->> 'immagine', ''), nullif(p_dati ->> 'parte', ''))
      returning id into v_id;
  else
    update public.modelli
      set nome = p_dati ->> 'nome', descrizione = nullif(p_dati ->> 'descrizione', ''),
          per_partner = coalesce((p_dati ->> 'per_partner')::boolean, true), attivo = coalesce((p_dati ->> 'attivo')::boolean, true),
          prezzo_giorno = (p_dati ->> 'prezzo_giorno')::numeric, categoria = nullif(p_dati ->> 'categoria', ''),
          immagine = nullif(p_dati ->> 'immagine', ''), parte = nullif(p_dati ->> 'parte', '')
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

-- Righe dell'offerta Meekon (solo in bozza), con modello e componenti.
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
  insert into public.offerte_righe (offerta_id, articolo_id, modello_id, componenti, configurazione, posizione, titolo, descrizione, quantita, giorni, prezzo_unitario, sconto_percento, opzionale)
    select p_offerta, r.articolo_id, r.modello_id, r.componenti, r.configurazione, (r.ord - 1)::integer, nullif(btrim(r.titolo), ''), r.descrizione,
           coalesce(r.quantita, 1), coalesce(r.giorni, 1), coalesce(r.prezzo_unitario, 0), coalesce(r.sconto_percento, 0), coalesce(r.opzionale, false)
    from rows from (jsonb_to_recordset(p_righe) as (
      articolo_id uuid, modello_id uuid, componenti jsonb, configurazione jsonb, titolo text, descrizione text, quantita numeric, giorni numeric,
      prezzo_unitario numeric, sconto_percento numeric, opzionale boolean
    )) with ordinality as r(articolo_id, modello_id, componenti, configurazione, titolo, descrizione, quantita, giorni, prezzo_unitario, sconto_percento, opzionale, ord);
end;
$$;

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
  insert into public.partner_righe (offerta_id, posizione, tipo, articolo_id, modello_id, componenti, configurazione, titolo, descrizione, quantita, giorni, prezzo_unitario, sconto_percento, opzionale)
    select p_offerta, (r.ord - 1)::integer, coalesce(r.tipo, 'servizio'), r.articolo_id, r.modello_id, r.componenti, r.configurazione, nullif(btrim(r.titolo), ''), r.descrizione,
           coalesce(r.quantita, 1), coalesce(r.giorni, 1), coalesce(r.prezzo_unitario, 0), coalesce(r.sconto_percento, 0), coalesce(r.opzionale, false)
    from rows from (jsonb_to_recordset(p_righe) as (
      tipo text, articolo_id uuid, modello_id uuid, componenti jsonb, configurazione jsonb, titolo text, descrizione text, quantita numeric, giorni numeric,
      prezzo_unitario numeric, sconto_percento numeric, opzionale boolean
    )) with ordinality as r(tipo, articolo_id, modello_id, componenti, configurazione, titolo, descrizione, quantita, giorni, prezzo_unitario, sconto_percento, opzionale, ord);
end;
$$;

-- Nuova versione: copia anche modello e componenti.
do $$
declare def text;
begin
  def := pg_get_functiondef('public.nuova_offerta(uuid, uuid)'::regprocedure);
  def := replace(def,
    'insert into public.offerte_righe (offerta_id, articolo_id, posizione, titolo, descrizione, quantita, giorni, prezzo_unitario, sconto_percento)',
    'insert into public.offerte_righe (offerta_id, articolo_id, modello_id, componenti, configurazione, opzionale, posizione, titolo, descrizione, quantita, giorni, prezzo_unitario, sconto_percento)');
  def := replace(def,
    'select v_id, articolo_id, posizione, titolo, descrizione, quantita, giorni, prezzo_unitario, sconto_percento',
    'select v_id, articolo_id, modello_id, componenti, configurazione, opzionale, posizione, titolo, descrizione, quantita, giorni, prezzo_unitario, sconto_percento');
  if position('modello_id, componenti' in def) = 0 then
    raise exception 'nuova_offerta: sostituzione non riuscita';
  end if;
  execute def;
end;
$$;

-- Costo per il partner: articoli singoli (noleggio) + pacchetti (prezzo del modello), meno il suo sconto.
create or replace function public.costo_materiale_partner(p_offerta uuid)
returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce(sum(round(r.quantita * r.giorni
           * coalesce(case when r.tipo = 'pacchetto' then m.prezzo_giorno else a.prezzo_noleggio_giorno end, 0)
           * (1 - coalesce(p.sconto_partner_percento, 0) / 100), 2)), 0)
  from public.partner_offerte o
  join public.partner_righe r on r.offerta_id = o.id and r.tipo in ('materiale', 'pacchetto') and not r.opzionale
  left join public.articoli a on a.id = r.articolo_id
  left join public.modelli m on m.id = r.modello_id
  left join public.partner_profili p on p.staff_id = o.partner_id
  where o.id = p_offerta and (public.gestione() or o.partner_id = auth.uid());
$$;

-- Conferma del materiale: anche i componenti dei pacchetti finiscono nella lista materiale.
do $$
declare def text;
begin
  def := pg_get_functiondef('public.conferma_materiale_partner(uuid, text)'::regprocedure);
  def := replace(def,
    $old$    where r.offerta_id = o.id and r.tipo = 'materiale' and not r.opzionale
    order by r.posizione;$old$,
    $new$    where r.offerta_id = o.id and r.tipo = 'materiale' and not r.opzionale
    order by r.posizione;

  insert into public.checklist (evento_id, voce, quantita, articolo_id)
    select v_evento, left(coalesce(a.descrizione, 'Articolo'), 200), greatest(1, ceil(r.quantita * (c ->> 'quantita')::numeric))::integer, a.id
    from public.partner_righe r
    cross join lateral jsonb_array_elements(coalesce(r.componenti, '[]'::jsonb)) c
    join public.articoli a on a.id = (c ->> 'articolo_id')::uuid
    where r.offerta_id = o.id and r.tipo = 'pacchetto' and not r.opzionale;$new$);
  if position('jsonb_array_elements' in def) = 0 then
    raise exception 'conferma_materiale_partner: sostituzione non riuscita';
  end if;
  execute def;
end;
$$;

-- Lo stato "materiale in attesa" vale anche per le offerte con soli pacchetti.
do $$
declare def text;
begin
  def := pg_get_functiondef('public.partner_offerte_regole()'::regprocedure);
  def := replace(def, $o$r.tipo = 'materiale' and not r.opzionale$o$, $n$r.tipo in ('materiale', 'pacchetto') and not r.opzionale$n$);
  if position($n$r.tipo in ('materiale', 'pacchetto')$n$ in def) = 0 then
    raise exception 'partner_offerte_regole: sostituzione non riuscita';
  end if;
  execute def;
end;
$$;
