-- Totem de autoatendimento (tablet na recepção): o cliente digita o celular, faz check-in do horário marcado
-- ("No local" na AppBarber) ou agenda na hora. O tablet fala com a função "totem"; o servidor de IP fixo
-- pega os pedidos (função sync-servidor) e conversa com a AppBarber.
alter table public.integrations add column if not exists tt_on boolean not null default false;
alter table public.integrations add column if not exists tt_token_hash text;          -- sha-256 do código do link do tablet
alter table public.integrations add column if not exists tt_days integer not null default 7; -- dias que dá para agendar
alter table public.integrations add column if not exists tt_notify boolean not null default true; -- avisa o profissional no WhatsApp
alter table public.integrations add column if not exists tt_status text;
alter table public.integrations add column if not exists tt_status_at timestamptz;
alter table public.integrations add column if not exists tt_seen_at timestamptz;      -- última vez que o servidor procurou pedidos

create table if not exists public.totem_pedidos (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  acao text not null,
  dados jsonb not null default '{}'::jsonb,
  status text not null default 'novo', -- novo | pego | feito | erro | expirado
  resposta jsonb,
  criado_em timestamptz not null default now(),
  pego_em timestamptz,
  feito_em timestamptz
);
create index if not exists totem_pedidos_fila on public.totem_pedidos (company_id, status, id);
-- Só as funções (service_role) leem e gravam: os pedidos têm o celular do cliente e são apagados logo depois.
alter table public.totem_pedidos enable row level security;
revoke all on public.totem_pedidos from anon, authenticated;
grant all on public.totem_pedidos to service_role;
