-- Meekon Displays — CMS: loghi dei DJ e ruolo dei partner (come nella sezione DJ del sito).
-- dj.foto_e_logo   true = l'immagine è un logo (centrato nel riquadro, sfondo trasparente),
--                  false = foto del DJ (ritagliata a tutta altezza)
-- partner.ruolo_*  ruolo facoltativo sotto il logo, es. "Video team", nelle 4 lingue

alter table public.dj
  add column if not exists foto_e_logo boolean not null default true;

alter table public.partner
  add column if not exists ruolo_it text check (ruolo_it is null or char_length(ruolo_it) <= 60),
  add column if not exists ruolo_de text check (ruolo_de is null or char_length(ruolo_de) <= 60),
  add column if not exists ruolo_fr text check (ruolo_fr is null or char_length(ruolo_fr) <= 60),
  add column if not exists ruolo_en text check (ruolo_en is null or char_length(ruolo_en) <= 60);

-- anon (build del sito): solo colonne pubbliche
grant select (foto_e_logo) on public.dj to anon;
grant select (ruolo_it, ruolo_de, ruolo_fr, ruolo_en) on public.partner to anon;
