-- Venda de planos: oferta do plano mensal para clientes frequentes (na conversa, depois de agendar, e convite por dia).
alter table public.integrations add column if not exists pl_on boolean not null default false;
alter table public.integrations add column if not exists pl_chat boolean not null default true;   -- oferecer na conversa
alter table public.integrations add column if not exists pl_daily integer not null default 2;     -- convites por dia (0 = só na conversa)
alter table public.integrations add column if not exists pl_days jsonb not null default '[1,2,3,4]'::jsonb; -- dias da semana em que o plano vale
alter table public.integrations add column if not exists pl_plans jsonb not null default '[]'::jsonb; -- [{nome, preco, avulso, visitas, quando}]
alter table public.integrations add column if not exists pl_text text not null default '';
alter table public.integrations add column if not exists pl_status text;
alter table public.integrations add column if not exists pl_status_at timestamptz;
