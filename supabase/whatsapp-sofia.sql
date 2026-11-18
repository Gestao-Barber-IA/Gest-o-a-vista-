-- Sofia, a atendente IA no WhatsApp dos clientes (marca, remarca e cancela horários na AppBarber).
-- A chave da Anthropic fica só no servidor (/etc/gbia-sync.env); aqui ficam as escolhas do dono.
alter table public.integrations add column if not exists ia_on boolean not null default false;
alter table public.integrations add column if not exists ia_name text not null default 'Sofia';
alter table public.integrations add column if not exists ia_model text not null default 'claude-sonnet-5-5';
alter table public.integrations add column if not exists ia_hours jsonb;
alter table public.integrations add column if not exists ia_pause integer not null default 60; -- minutos sem responder depois que a recepção entra na conversa
alter table public.integrations add column if not exists ia_notes text not null default '';
alter table public.integrations add column if not exists ia_report jsonb;          -- relatório semanal (domingo à noite) com as sugestões
alter table public.integrations add column if not exists ia_report_at timestamptz;
alter table public.integrations add column if not exists ia_report_phone text not null default ''; -- WhatsApp que recebe o aviso do relatório
alter table public.integrations add column if not exists ia_status text;
alter table public.integrations add column if not exists ia_status_at timestamptz;
alter table public.integrations add column if not exists ia_arts jsonb not null default '[]'::jsonb; -- artes que a Sofia envia (ex.: tabela de planos)
notify pgrst, 'reload schema';
