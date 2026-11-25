-- 0015 Lingua dell'interfaccia per ogni utente (italiano, tedesco, inglese; il titolare usa il tedesco).
-- Ognuno cambia solo la propria lingua, tramite imposta_mia_lingua() (la tabella staff la scrive solo l'admin).

alter table public.staff
  add column if not exists lingua text check (lingua is null or lingua in ('it', 'de', 'en'));

create or replace function public.imposta_mia_lingua(p_lingua text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lingua is null or p_lingua not in ('it', 'de', 'en') then
    raise exception 'lingua non valida' using errcode = '22023';
  end if;
  update public.staff set lingua = p_lingua where id = auth.uid() and attivo;
  if not found then
    raise exception 'permesso negato' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.imposta_mia_lingua(text) from public, anon;
grant execute on function public.imposta_mia_lingua(text) to authenticated;
