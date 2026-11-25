-- Relatório mensal com análise e plano de ação (IA): gerado pelo servidor no dia 1º, para o mês anterior.
create table if not exists public.ia_relatorios (
  company_id uuid not null references public.companies(id) on delete cascade,
  ym text not null,                          -- AAAA-MM
  dados jsonb not null default '{}'::jsonb,  -- números do mês usados na análise
  analise jsonb not null default '{}'::jsonb,-- { resumo, melhorou[], atencao[], acoes[], barbeiros[] }
  criado_em timestamptz not null default now(),
  primary key (company_id, ym)
);
alter table public.ia_relatorios enable row level security;
grant select on public.ia_relatorios to authenticated;
grant all on public.ia_relatorios to service_role;
drop policy if exists ia_relatorios_gestor on public.ia_relatorios;
create policy ia_relatorios_gestor on public.ia_relatorios for select using (company_id = my_company() and is_gestor());
alter table public.integrations add column if not exists rm_pedido text;   -- "gerar agora" pelo app (AAAA-MM)
alter table public.integrations add column if not exists rm_status text;
alter table public.integrations add column if not exists rm_status_at timestamptz;
