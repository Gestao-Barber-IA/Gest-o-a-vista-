-- Lembrete de agendamento para os clientes (WhatsApp), 1 hora antes do horário marcado na AppBarber.
-- Enviado pelo número conectado no servidor de sincronização. Nome e telefone dos clientes não são gravados aqui.
alter table public.integrations add column if not exists cl_on boolean not null default false;
alter table public.integrations add column if not exists cl_lead integer not null default 60;
alter table public.integrations add column if not exists cl_text text not null default '';
alter table public.integrations add column if not exists cl_reply text not null default '';
alter table public.integrations add column if not exists cl_status text;
alter table public.integrations add column if not exists cl_status_at timestamptz;
