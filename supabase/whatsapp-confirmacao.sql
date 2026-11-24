-- Confirmação de presença (evitar faltas): na véspera o cliente recebe um pedido de confirmação do horário de amanhã;
-- a atendente IA confirma na agenda, remarca ou cancela. No dia, 2º aviso para quem não respondeu.
alter table public.integrations add column if not exists cf_on boolean not null default false;
alter table public.integrations add column if not exists cf_hour text not null default '17:00';   -- a partir de que horas pede na véspera
alter table public.integrations add column if not exists cf_second boolean not null default true; -- 2º aviso no dia
alter table public.integrations add column if not exists cf_before integer not null default 180;  -- minutos antes do horário (2º aviso)
alter table public.integrations add column if not exists cf_text text not null default '';
alter table public.integrations add column if not exists cf_text2 text not null default '';
alter table public.integrations add column if not exists cf_status text;
alter table public.integrations add column if not exists cf_status_at timestamptz;
