-- Agenda sem buracos: sugere ao cliente vir um pouco antes/depois quando o horário dele deixou um buraco menor que 40
-- minutos na agenda do profissional; a atendente IA remarca se ele aceitar.
alter table public.integrations add column if not exists oa_on boolean not null default false;
alter table public.integrations add column if not exists oa_daily integer not null default 6;
alter table public.integrations add column if not exists oa_text text not null default '';
alter table public.integrations add column if not exists oa_status text;
alter table public.integrations add column if not exists oa_status_at timestamptz;
