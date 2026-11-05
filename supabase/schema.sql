-- =====================================================================
-- Gestão Barber IA — banco de dados no Supabase
-- Como usar: Supabase → SQL Editor → New query → cole tudo → Run.
-- Pode rodar de novo sem problema: o script recria funções e regras.
-- =====================================================================

-- ---------- Tabelas ----------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cnpj text not null default '',
  phone text not null default '',
  email text not null default '',
  logo text,
  settings jsonb not null default '{}'::jsonb,   -- pesos, metas e indicadores ocultos
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  company_id uuid not null references public.companies on delete cascade,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  role text not null check (role in ('gestor', 'barbeiro')),
  status text not null default 'pendente' check (status in ('ativo', 'pendente', 'recusado')),
  barber_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.barbers (
  id text primary key,
  company_id uuid not null references public.companies on delete cascade,
  name text not null,
  photo text,
  active boolean not null default true,
  role text not null default 'Barbeiro',
  instagram text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.invites (
  code text primary key,
  company_id uuid not null references public.companies on delete cascade,
  barber_id text not null references public.barbers on delete cascade,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

-- Resultado do dia de cada barbeiro (vem da integração ou de importação).
create table if not exists public.entries (
  id text primary key,
  company_id uuid not null references public.companies on delete cascade,
  barber_id text not null references public.barbers on delete cascade,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  source text not null default 'manual',
  updated_at timestamptz not null default now(),
  unique (barber_id, date)
);

-- Totais do mês lançados pelo gestor.
create table if not exists public.monthly (
  company_id uuid not null references public.companies on delete cascade,
  barber_id text not null references public.barbers on delete cascade,
  month text not null,             -- AAAA-MM
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (barber_id, month)
);

-- Chave da API de cada barbearia (só o gestor vê).
create table if not exists public.api_keys (
  company_id uuid primary key references public.companies on delete cascade,
  key text not null unique
);

create index if not exists entries_company_date on public.entries (company_id, date);
create index if not exists monthly_company_month on public.monthly (company_id, month);
create index if not exists profiles_company on public.profiles (company_id);
create index if not exists barbers_company on public.barbers (company_id);

-- ---------- Funções de apoio às regras ----------
create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid() and status = 'ativo'
$$;

create or replace function public.is_gestor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'ativo' and role = 'gestor')
$$;

create or replace function public.my_barber() returns text
language sql stable security definer set search_path = public as $$
  select barber_id from profiles where id = auth.uid() and status = 'ativo'
$$;

-- ---------- Regras de acesso (RLS) ----------
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.barbers enable row level security;
alter table public.invites enable row level security;
alter table public.entries enable row level security;
alter table public.monthly enable row level security;
alter table public.api_keys enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('companies','profiles','barbers','invites','entries','monthly','api_keys') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Barbearia: membros ativos leem; gestor edita.
create policy companies_read on public.companies for select using (id = my_company());
create policy companies_edit on public.companies for update using (id = my_company() and is_gestor());

-- Perfis: cada um vê o próprio (mesmo pendente); membros veem a equipe; gestor aprova.
create policy profiles_read on public.profiles for select using (id = auth.uid() or company_id = my_company());
create policy profiles_self on public.profiles for update using (id = auth.uid());
create policy profiles_gestor on public.profiles for update using (company_id = my_company() and is_gestor());

-- Barbeiros: membros leem; gestor cria, edita e remove; o barbeiro pode trocar a própria foto.
create policy barbers_read on public.barbers for select using (company_id = my_company());
create policy barbers_insert on public.barbers for insert with check (company_id = my_company() and is_gestor());
create policy barbers_update on public.barbers for update using (company_id = my_company() and (is_gestor() or id = my_barber()));
create policy barbers_delete on public.barbers for delete using (company_id = my_company() and is_gestor());

-- Convites: só o gestor.
create policy invites_all on public.invites for all using (company_id = my_company() and is_gestor()) with check (company_id = my_company() and is_gestor());

-- Resultados: membros leem; gestor edita.
create policy entries_read on public.entries for select using (company_id = my_company());
create policy entries_write on public.entries for all using (company_id = my_company() and is_gestor()) with check (company_id = my_company() and is_gestor());
create policy monthly_read on public.monthly for select using (company_id = my_company());
create policy monthly_write on public.monthly for all using (company_id = my_company() and is_gestor()) with check (company_id = my_company() and is_gestor());

-- Chave da API: só o gestor.
create policy api_keys_all on public.api_keys for all using (company_id = my_company() and is_gestor()) with check (company_id = my_company() and is_gestor());

-- Quem não é gestor não pode mudar o próprio cargo, situação ou barbearia.
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_gestor() and (new.role is distinct from old.role or new.status is distinct from old.status
      or new.company_id is distinct from old.company_id or new.barber_id is distinct from old.barber_id) then
    raise exception 'Somente o gestor pode alterar cargo, situação ou vínculo.';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles for each row execute function public.guard_profile();

-- O barbeiro só pode trocar a própria foto.
create or replace function public.guard_barber() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_gestor() and (new.name is distinct from old.name or new.active is distinct from old.active
      or new.role is distinct from old.role or new.instagram is distinct from old.instagram or new.company_id is distinct from old.company_id) then
    raise exception 'O barbeiro só pode trocar a própria foto.';
  end if;
  return new;
end $$;
drop trigger if exists guard_barber on public.barbers;
create trigger guard_barber before update on public.barbers for each row execute function public.guard_barber();

-- ---------- Cadastro: gestor cria a barbearia; barbeiro entra por convite ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  inv public.invites;
  cid uuid;
begin
  if meta ? 'invite_code' then
    select * into inv from invites where code = meta->>'invite_code' and not used for update;
    if inv.code is null then
      raise exception 'Convite inválido ou já usado.';
    end if;
    insert into profiles (id, company_id, name, email, phone, role, status, barber_id)
    values (new.id, inv.company_id, coalesce(meta->>'name', ''), coalesce(new.email, ''), coalesce(meta->>'phone', ''), 'barbeiro', 'pendente', inv.barber_id);
    update invites set used = true where code = inv.code;
  else
    insert into companies (name, email)
    values (coalesce(nullif(meta->>'company', ''), 'Minha barbearia'), coalesce(new.email, ''))
    returning id into cid;
    insert into profiles (id, company_id, name, email, role, status)
    values (new.id, cid, coalesce(nullif(meta->>'name', ''), meta->>'full_name', ''), coalesce(new.email, ''), 'gestor', 'ativo');
    insert into api_keys (company_id, key) values (cid, 'gbia_' || replace(gen_random_uuid()::text, '-', ''));
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Mantém o e-mail do perfil igual ao do login.
create or replace function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end $$;
drop trigger if exists on_auth_user_email on auth.users;
create trigger on_auth_user_email after update of email on auth.users for each row execute function public.sync_profile_email();

-- Mostra a barbearia e o barbeiro de um convite antes do cadastro (sem login).
create or replace function public.get_invite(p_code text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('company', c.name, 'barber', b.name, 'barber_id', b.id)
  from invites i join companies c on c.id = i.company_id join barbers b on b.id = i.barber_id
  where i.code = p_code and not i.used
$$;
grant execute on function public.get_invite(text) to anon, authenticated;

-- Gera uma chave nova da API (só gestor).
create or replace function public.rotate_api_key() returns text
language plpgsql security definer set search_path = public as $$
declare k text := 'gbia_' || replace(gen_random_uuid()::text, '-', '');
begin
  if not is_gestor() then raise exception 'Somente o gestor.'; end if;
  insert into api_keys (company_id, key) values (my_company(), k)
  on conflict (company_id) do update set key = excluded.key;
  return k;
end $$;
grant execute on function public.rotate_api_key() to authenticated;

-- ---------- Tempo real (ranking ao vivo em todos os aparelhos) ----------
do $$ begin
  begin alter publication supabase_realtime add table public.entries; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.monthly; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.barbers; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.companies; exception when duplicate_object then null; end;
end $$;
