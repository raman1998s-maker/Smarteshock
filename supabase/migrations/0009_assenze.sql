-- 0009 Assenze: i giorni in cui un dipendente non è disponibile.
-- Ognuno (anche tecnico e base) gestisce le proprie; la gestione (admin + ufficio)
-- le vede tutte e può segnarle per gli altri, così l'agenda avvisa prima di assegnare.

create table if not exists public.assenze (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null default auth.uid() references public.staff (id) on delete cascade,
  dal         date not null,
  al          date not null,
  motivo      text check (motivo is null or char_length(motivo) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint assenze_date_ordine check (al >= dal and al - dal <= 366)
);

create index if not exists assenze_periodo_idx on public.assenze (dal, al);
create index if not exists assenze_staff_idx on public.assenze (staff_id, dal);

drop trigger if exists trg_assenze_updated_at on public.assenze;
create trigger trg_assenze_updated_at before update on public.assenze
  for each row execute function public.set_updated_at();

alter table public.assenze enable row level security;

drop policy if exists assenze_select on public.assenze;
drop policy if exists assenze_insert on public.assenze;
drop policy if exists assenze_update on public.assenze;
drop policy if exists assenze_delete on public.assenze;
create policy assenze_select on public.assenze
  for select to authenticated
  using ((staff_id = auth.uid() and public.is_staff()) or public.gestione());
create policy assenze_insert on public.assenze
  for insert to authenticated
  with check ((staff_id = auth.uid() and public.is_staff()) or public.gestione());
create policy assenze_update on public.assenze
  for update to authenticated
  using ((staff_id = auth.uid() and public.is_staff()) or public.gestione())
  with check ((staff_id = auth.uid() and public.is_staff()) or public.gestione());
create policy assenze_delete on public.assenze
  for delete to authenticated
  using ((staff_id = auth.uid() and public.is_staff()) or public.gestione());

revoke all on public.assenze from public, anon, authenticated;
grant select, insert, update, delete on public.assenze to authenticated;
