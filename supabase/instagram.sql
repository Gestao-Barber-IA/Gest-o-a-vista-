-- Atendente IA no Instagram (Direct): a Meta manda as mensagens para a função "instagram" (webhook), que põe na fila;
-- o servidor pega pela sync-servidor, a atendente responde e a resposta sai pela API do Instagram (Graph API).
alter table public.integrations add column if not exists ig_on boolean not null default false;
alter table public.integrations add column if not exists ig_user_id text not null default '';   -- ID da conta profissional do Instagram
alter table public.integrations add column if not exists ig_token text not null default '';     -- token de acesso (longa duração; renovado sozinho)
alter table public.integrations add column if not exists ig_token_at timestamptz;
alter table public.integrations add column if not exists ig_app_secret text not null default ''; -- chave secreta do app da Meta (confere a assinatura)
alter table public.integrations add column if not exists ig_verify text not null default '';    -- token de verificação do webhook
alter table public.integrations add column if not exists ig_status text;
alter table public.integrations add column if not exists ig_status_at timestamptz;
alter table public.integrations add column if not exists ig_seen_at timestamptz;                -- última vez que o servidor buscou mensagens

create table if not exists public.ig_mensagens (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  sid text not null,                 -- ID do cliente no Instagram (IGSID)
  tipo text not null default 'msg',  -- msg (do cliente) | eco (enviada pela conta: atendente ou alguém da equipe pelo app do Instagram)
  texto text not null default '',
  mid text,
  status text not null default 'novo',
  criado_em timestamptz not null default now()
);
create index if not exists ig_mensagens_fila on public.ig_mensagens (company_id, status, id);
alter table public.ig_mensagens enable row level security; -- só a service_role (funções) mexe
grant all on public.ig_mensagens to service_role;
