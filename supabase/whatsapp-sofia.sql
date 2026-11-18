-- Sofia, a atendente IA no WhatsApp dos clientes (marca, remarca e cancela horários na AppBarber).
-- A chave da Anthropic fica só no servidor (/etc/gbia-sync.env); aqui ficam as escolhas do dono.
alter table public.integrations add column if not exists ia_on boolean not null default false;
alter table public.integrations add column if not exists ia_name text not null default 'Sofia';
alter table public.integrations add column if not exists ia_model text not null default 'claude-sonnet-5-5';
alter table public.integrations add column if not exists ia_hours jsonb;
alter table public.integrations add column if not exists ia_pause integer not null default 3;
alter table public.integrations add column if not exists ia_notes text not null default '';
alter table public.integrations add column if not exists ia_status text;
alter table public.integrations add column if not exists ia_status_at timestamptz;
notify pgrst, 'reload schema';
