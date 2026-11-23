-- Reconquista: texto do presente de retorno que a atendente IA manda quando o cliente aceita o convite.
alter table public.integrations add column if not exists wb_gift text not null default '';
-- Mensagem que ela manda junto da confirmação do horário agendado com o presente (ex.: o cupom).
alter table public.integrations add column if not exists wb_gift_done text not null default '';
