-- Meekon Displays — permessi minimi per service_role (solo Edge Functions lato server).
-- invita-utente scrive in staff; il caricamento iniziale del CMS ha scritto in dj e partner.
-- Nessun permesso nuovo per anon o authenticated.
grant select, insert on public.staff to service_role;
grant select, insert on public.dj to service_role;
grant select, insert on public.partner to service_role;
