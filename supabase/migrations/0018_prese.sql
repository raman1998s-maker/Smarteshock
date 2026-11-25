-- Meekon Displays — prese di corrente in location nell'offerta del partner (DJ).
-- prese: { "230v": n, "cee16": n, "cee32": n, "cee63": n, "cee125": n } (solo i tipi presenti, n = quante).
-- Nella richiesta del sito gli stessi dati stanno in richieste_web.dettagli_tecnici (prese + prese_<tipo>_n).

alter table public.partner_offerte
  add column if not exists prese jsonb check (prese is null or (jsonb_typeof(prese) = 'object' and pg_column_size(prese) <= 300));
