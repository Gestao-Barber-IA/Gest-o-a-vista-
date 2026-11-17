-- Reconquista de clientes sumidos (WhatsApp): quem não vem há 3 a 12 meses recebe uma mensagem perguntando
-- se pode receber um presente de retorno. Sai pelo número que fala com os clientes, poucas por dia.
alter table public.integrations add column if not exists wb_on boolean not null default false;
alter table public.integrations add column if not exists wb_daily integer not null default 15;
alter table public.integrations add column if not exists wb_min_days integer not null default 90;
alter table public.integrations add column if not exists wb_max_days integer not null default 365;
alter table public.integrations add column if not exists wb_text text not null default '';
alter table public.integrations add column if not exists wb_status text;
alter table public.integrations add column if not exists wb_status_at timestamptz;
