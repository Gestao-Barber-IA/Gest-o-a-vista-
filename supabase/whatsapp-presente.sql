-- Reconquista: texto do presente de retorno que a atendente IA manda quando o cliente aceita o convite.
alter table public.integrations add column if not exists wb_gift text not null default '';
