-- Sincronização automática pela nuvem (AppBarber): o servidor do Gestão Barber IA, com IP fixo,
-- busca os dados de cada barbearia 24 horas por dia, sem computador ligado na loja.
-- Cada empresa guarda aqui o código do estabelecimento e a chave da API da AppBarber.
-- Só o gestor (dono) da empresa vê e altera. O servidor lê pela função sync-servidor (service_role).
create table if not exists public.integrations (
  company_id uuid primary key references public.companies on delete cascade,
  provider text not null default 'appbarber',
  est_code text not null default '',
  api_key text not null default '',
  branch_code text not null default '',
  active boolean not null default true,
  names jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_status text,
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.integrations to authenticated;
grant select, insert, update, delete on public.integrations to service_role;
alter table public.integrations enable row level security;
drop policy if exists integrations_gestor on public.integrations;
create policy integrations_gestor on public.integrations for all
  using (company_id = my_company() and is_gestor())
  with check (company_id = my_company() and is_gestor());
