-- Indicação premiada: cliente fiel recebe um código para indicar amigos; o amigo novo ganha um benefício na 1ª
-- visita e quem indicou ganha um prêmio quando o amigo vem. A lista de quem tem prêmio a receber fica no app.
alter table public.integrations add column if not exists in_on boolean not null default false;
alter table public.integrations add column if not exists in_daily integer not null default 3;   -- convites por dia
alter table public.integrations add column if not exists in_min integer not null default 4;     -- visitas mínimas para receber o código
alter table public.integrations add column if not exists in_beneficio text not null default '20% de desconto no primeiro atendimento';
alter table public.integrations add column if not exists in_premio text not null default 'um corte grátis';
alter table public.integrations add column if not exists in_text text not null default '';
alter table public.integrations add column if not exists in_status text;
alter table public.integrations add column if not exists in_status_at timestamptz;
create table if not exists public.ia_indicacoes (
  company_id uuid not null references public.companies(id) on delete cascade,
  codigo text not null,
  nome text not null default '',
  fone4 text not null default '',
  convidado_em date,
  agendados integer not null default 0,  -- amigos que agendaram com o código
  vieram integer not null default 0,     -- amigos que vieram (prêmios ganhos)
  entregues integer not null default 0,  -- prêmios já entregues (marcado no app)
  atualizado timestamptz not null default now(),
  primary key (company_id, codigo)
);
alter table public.ia_indicacoes enable row level security;
grant select, update on public.ia_indicacoes to authenticated;
grant all on public.ia_indicacoes to service_role;
drop policy if exists ia_indicacoes_ver on public.ia_indicacoes;
create policy ia_indicacoes_ver on public.ia_indicacoes for select using (company_id = my_company() and is_gestor());
drop policy if exists ia_indicacoes_editar on public.ia_indicacoes;
create policy ia_indicacoes_editar on public.ia_indicacoes for update using (company_id = my_company() and is_gestor()) with check (company_id = my_company() and is_gestor());
