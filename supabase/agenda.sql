-- Agenda própria (sem depender da AppBarber) + web app do cliente (agendar.html).
-- Serviços, horários de cada profissional, bloqueios, agendamentos (com trava contra dois horários ao mesmo tempo
-- para o mesmo profissional), clientes com verificação pelo WhatsApp e a fila de mensagens que o servidor envia.
create extension if not exists btree_gist;

-- Quem pode mexer na agenda: o gestor e quem tem "Recepcionista" na função.
create or replace function public.ag_equipe() returns boolean language sql stable security definer set search_path = public as $$
  select public.is_gestor() or exists (select 1 from public.barbers b where b.id = public.my_barber() and b.role ilike '%recep%');
$$;

create table if not exists public.ag_config (
  company_id uuid primary key references public.companies(id) on delete cascade,
  ativo boolean not null default false,          -- web app do cliente ligado
  passo integer not null default 20,             -- de quantos em quantos minutos os horários aparecem
  antecedencia integer not null default 60,      -- minutos mínimos entre agora e o horário (web app)
  dias_max integer not null default 30,          -- até quantos dias à frente o cliente agenda
  cancelar_horas integer not null default 2,     -- até quantas horas antes o cliente cancela pelo app
  buraco_min integer not null default 40,        -- não oferecer horário que deixe buraco menor que isso
  aviso text not null default '',                -- recado no topo do web app
  atualizado timestamptz not null default now()
);

create table if not exists public.ag_servicos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  nome text not null,
  duracao integer not null default 30,
  preco numeric not null default 0,
  ativo boolean not null default true,
  online boolean not null default true,          -- aparece no web app
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists ag_servicos_emp on public.ag_servicos (company_id, ordem);

create table if not exists public.ag_profissionais (
  barber_id text primary key references public.barbers(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  ativo boolean not null default true,           -- atende pela agenda
  online boolean not null default true,          -- aparece no web app
  servicos uuid[] not null default '{}',         -- vazio = faz todos
  horarios jsonb not null default '{}'::jsonb,   -- {"1": [["09:00","12:00"],["13:00","20:00"]], ...} (0 = domingo)
  atualizado timestamptz not null default now()
);

create table if not exists public.ag_clientes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  nome text not null default '',
  sobrenome text not null default '',
  fone text not null,                            -- só números, com DDD (sem o 55)
  email text not null default '',
  nascimento date,
  obs text not null default '',
  verificado_em timestamptz,
  sessao_hash text,
  sessao_expira timestamptz,
  criado_em timestamptz not null default now(),
  unique (company_id, fone)
);

create table if not exists public.ag_agendamentos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  barber_id text not null references public.barbers(id) on delete cascade,
  cliente_id uuid references public.ag_clientes(id) on delete set null,
  cliente_nome text not null default '',
  cliente_fone text not null default '',
  inicio timestamptz not null,
  fim timestamptz not null,
  servicos jsonb not null default '[]'::jsonb,   -- [{id, nome, duracao, preco}]
  valor numeric not null default 0,
  status text not null default 'agendado',       -- agendado | confirmado | chegou | finalizado | faltou | cancelado
  origem text not null default 'equipe',         -- equipe | app | atendente | totem
  obs text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (fim > inicio),
  constraint ag_sem_conflito exclude using gist (barber_id with =, tstzrange(inicio, fim) with &&) where (status not in ('cancelado', 'faltou'))
);
create index if not exists ag_agendamentos_dia on public.ag_agendamentos (company_id, inicio);
create index if not exists ag_agendamentos_cli on public.ag_agendamentos (cliente_id, inicio);

create table if not exists public.ag_bloqueios (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  barber_id text references public.barbers(id) on delete cascade, -- vazio = todos
  inicio timestamptz not null,
  fim timestamptz not null,
  motivo text not null default '',
  criado_em timestamptz not null default now(),
  check (fim > inicio)
);
create index if not exists ag_bloqueios_dia on public.ag_bloqueios (company_id, inicio);

-- Códigos de verificação (só o hash) e a fila de mensagens que o servidor manda pelo WhatsApp.
create table if not exists public.ag_codigos (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  fone text not null,
  codigo_hash text not null,
  nome text not null default '',
  sobrenome text not null default '',
  expira timestamptz not null,
  tentativas integer not null default 0,
  usado boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists ag_codigos_fone on public.ag_codigos (company_id, fone, criado_em desc);
create table if not exists public.wa_saida (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  fone text not null,
  texto text not null,
  status text not null default 'novo',
  criado_em timestamptz not null default now(),
  enviado_em timestamptz
);
create index if not exists wa_saida_fila on public.wa_saida (company_id, status, id);
alter table public.integrations add column if not exists ws_seen_at timestamptz; -- última vez que o servidor buscou a fila

-- Permissões: a equipe da empresa vê; o gestor e a recepção mexem. Códigos e fila: só as funções (service_role).
do $$ declare t text; begin
  foreach t in array array['ag_config','ag_servicos','ag_profissionais','ag_clientes','ag_agendamentos','ag_bloqueios'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format('create policy %I on public.%I for select using (company_id = public.my_company())', t || '_ver', t);
    execute format('drop policy if exists %I on public.%I', t || '_mexer', t);
    execute format('create policy %I on public.%I for all using (company_id = public.my_company() and public.ag_equipe()) with check (company_id = public.my_company() and public.ag_equipe())', t || '_mexer', t);
  end loop;
end $$;
alter table public.ag_codigos enable row level security;
alter table public.wa_saida enable row level security;
grant all on public.ag_codigos to service_role;
grant all on public.wa_saida to service_role;
