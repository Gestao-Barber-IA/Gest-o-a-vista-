-- Web app do cliente como "app": vitrine da barbearia (capa, banners, endereço, contatos, perguntas, termos, planos e
-- unidades), ícone e descrição dos serviços, profissional favorito e avaliações dos atendimentos (com autorização).
alter table public.ag_config add column if not exists capa text not null default '';
alter table public.ag_config add column if not exists banners jsonb not null default '[]'::jsonb;      -- [{"url": "..."}]
alter table public.ag_config add column if not exists endereco text not null default '';
alter table public.ag_config add column if not exists mapa text not null default '';
alter table public.ag_config add column if not exists whatsapp text not null default '';
alter table public.ag_config add column if not exists instagram text not null default '';
alter table public.ag_config add column if not exists faq jsonb not null default '[]'::jsonb;          -- [{"p": "...", "r": "..."}]
alter table public.ag_config add column if not exists termos text not null default '';
alter table public.ag_config add column if not exists planos_info jsonb not null default '{}'::jsonb;  -- {id_do_plano: {"desc": "...", "ocultar": false}}
alter table public.ag_config add column if not exists unidades jsonb not null default '{}'::jsonb;     -- {"Nome da unidade": {"endereco","mapa","capa","whatsapp"}}
alter table public.ag_config add column if not exists avaliacoes_on boolean not null default true;
alter table public.ag_servicos add column if not exists icone text not null default '';
alter table public.ag_servicos add column if not exists descricao text not null default '';
alter table public.ag_clientes add column if not exists favorito text;

create table if not exists public.ag_avaliacoes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  agendamento_id uuid not null unique references public.ag_agendamentos(id) on delete cascade,
  cliente_id uuid references public.ag_clientes(id) on delete set null,
  barber_id text references public.barbers(id) on delete set null,
  nota integer not null check (nota between 1 and 5),
  comentario text not null default '',
  publico boolean not null default false,   -- o cliente autorizou mostrar no web app
  oculto boolean not null default false,    -- a barbearia escondeu
  nome_publico text not null default '',    -- "Nome S."
  criado_em timestamptz not null default now()
);
create index if not exists ag_avaliacoes_emp on public.ag_avaliacoes (company_id, criado_em desc);
alter table public.ag_avaliacoes enable row level security;
grant select, insert, update, delete on public.ag_avaliacoes to authenticated;
grant all on public.ag_avaliacoes to service_role;
drop policy if exists ag_avaliacoes_ver on public.ag_avaliacoes;
create policy ag_avaliacoes_ver on public.ag_avaliacoes for select using (company_id = public.my_company());
drop policy if exists ag_avaliacoes_mexer on public.ag_avaliacoes;
create policy ag_avaliacoes_mexer on public.ag_avaliacoes for update using (company_id = public.my_company() and public.ag_equipe()) with check (company_id = public.my_company() and public.ag_equipe());
