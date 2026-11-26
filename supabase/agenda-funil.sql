-- Funil de venda no agendamento do web app: extras e produtos recomendados, oferta especial depois de confirmar,
-- cupons de desconto e cashback (crédito para a próxima visita, liberado quando o atendimento é finalizado).
alter table public.ag_servicos add column if not exists extra_sem_tempo boolean not null default false; -- como adicional, não ocupa tempo (ex.: sobrancelha)
alter table public.ag_servicos add column if not exists recomenda uuid[] not null default '{}';          -- serviços sugeridos em "Aproveite também"
alter table public.ag_servicos add column if not exists recomenda_produtos uuid[] not null default '{}';
alter table public.ag_config add column if not exists ofertas jsonb not null default '[]'::jsonb;  -- [{"apos": id|"" , "oferece": id, "desconto": 20}]
alter table public.ag_config add column if not exists cashback jsonb not null default '{}'::jsonb; -- {"ativo", "pct", "minimo", "validade", "max_uso"}
alter table public.ag_config add column if not exists chegar_antes integer not null default 10;
alter table public.ag_agendamentos add column if not exists produtos jsonb not null default '[]'::jsonb; -- [{id, nome, preco, qtd}] reservados para retirar
alter table public.ag_agendamentos add column if not exists subtotal numeric not null default 0;
alter table public.ag_agendamentos add column if not exists desconto numeric not null default 0;       -- cupom
alter table public.ag_agendamentos add column if not exists cupom text not null default '';
alter table public.ag_agendamentos add column if not exists credito_usado numeric not null default 0;
alter table public.ag_agendamentos add column if not exists cashback numeric not null default 0;       -- a ganhar quando finalizar

create table if not exists public.ag_produtos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  nome text not null, descricao text not null default '', preco numeric not null default 0, foto text not null default '',
  ativo boolean not null default true, online boolean not null default true, ordem integer not null default 0,
  criado_em timestamptz not null default now()
);
create table if not exists public.ag_cupons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  codigo text not null, tipo text not null default 'pct' check (tipo in ('pct', 'valor')), valor numeric not null default 0,
  validade date, limite integer, por_cliente boolean not null default true, minimo numeric not null default 0, ativo boolean not null default true,
  criado_em timestamptz not null default now(), unique (company_id, codigo)
);
create table if not exists public.ag_cupom_usos (
  id bigint generated always as identity primary key,
  cupom_id uuid not null references public.ag_cupons(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  cliente_id uuid references public.ag_clientes(id) on delete set null,
  agendamento_id uuid not null unique references public.ag_agendamentos(id) on delete cascade,
  criado_em timestamptz not null default now()
);
-- Extrato do cashback: ganho (positivo) e uso (negativo). Ganho fica pendente até o atendimento ser finalizado.
create table if not exists public.ag_cashback (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  cliente_id uuid not null references public.ag_clientes(id) on delete cascade,
  agendamento_id uuid references public.ag_agendamentos(id) on delete set null,
  tipo text not null check (tipo in ('ganho', 'uso', 'ajuste')),
  valor numeric not null,
  status text not null default 'pendente' check (status in ('pendente', 'liberado', 'cancelado')),
  expira date,
  criado_em timestamptz not null default now()
);
create index if not exists ag_cashback_cli on public.ag_cashback (cliente_id, status);
create index if not exists ag_cashback_ag on public.ag_cashback (agendamento_id);

-- Saldo disponível do cliente (ganhos liberados e não vencidos, menos os usos ativos; nunca negativo).
create or replace function public.ag_saldo(p_cliente uuid) returns numeric language sql stable security definer set search_path = public as $$
  select greatest(0, coalesce(sum(case when tipo = 'ganho' and status = 'liberado' and (expira is null or expira >= (now() at time zone 'America/Sao_Paulo')::date) then valor
                                     when tipo in ('uso', 'ajuste') and status = 'liberado' then valor else 0 end), 0))::numeric(10,2)
  from public.ag_cashback where cliente_id = p_cliente and company_id = coalesce(public.my_company(), company_id); -- equipe: só da própria empresa
$$;
revoke all on function public.ag_saldo(uuid) from public, anon;
grant execute on function public.ag_saldo(uuid) to authenticated, service_role;

-- O status do horário move o cashback e o cupom: finalizado libera o ganho; cancelado/faltou cancela ganho e uso
-- (o crédito volta para o cliente) e libera o uso do cupom; reativar devolve tudo como estava.
create or replace function public.ag_status_funil() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'finalizado' then
    update public.ag_cashback set status = 'liberado' where agendamento_id = new.id and tipo = 'ganho' and status <> 'liberado';
    update public.ag_cashback set status = 'liberado' where agendamento_id = new.id and tipo = 'uso' and status = 'cancelado';
  elsif new.status in ('cancelado', 'faltou') then
    update public.ag_cashback set status = 'cancelado' where agendamento_id = new.id and status <> 'cancelado';
    delete from public.ag_cupom_usos where agendamento_id = new.id;
  elsif old.status in ('cancelado', 'faltou') then
    update public.ag_cashback set status = case when tipo = 'ganho' then 'pendente' else 'liberado' end where agendamento_id = new.id and status = 'cancelado';
  elsif old.status = 'finalizado' then
    update public.ag_cashback set status = 'pendente' where agendamento_id = new.id and tipo = 'ganho' and status = 'liberado';
  end if;
  return new;
end $$;
drop trigger if exists ag_status_funil on public.ag_agendamentos;
create trigger ag_status_funil after update of status on public.ag_agendamentos for each row execute function public.ag_status_funil();

do $$ declare t text; begin
  foreach t in array array['ag_produtos','ag_cupons','ag_cupom_usos','ag_cashback'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format('create policy %I on public.%I for select using (company_id = public.my_company())', t || '_ver', t);
    execute format('drop policy if exists %I on public.%I', t || '_mexer', t);
    execute format('create policy %I on public.%I for all using (company_id = public.my_company() and public.ag_equipe()) with check (company_id = public.my_company() and public.ag_equipe())', t || '_mexer', t);
  end loop;
end $$;
