-- =====================================================================
-- Gestão Barber IA — banco de dados no Supabase
-- Como usar: Supabase → SQL Editor → New query → cole tudo → Run.
-- Pode rodar de novo sem problema: o script recria funções e regras.
-- Inclui a base do app e a parte de assinatura (SaaS).
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
  updated_at timestamptz not null default now()
);
-- Um registro por barbeiro, dia e origem: o da integração (api) e o lançado à mão (manual) convivem.
alter table public.entries drop constraint if exists entries_barber_id_date_key;
create unique index if not exists entries_barber_date_source on public.entries (barber_id, date, source);

-- Totais do mês lançados pelo gestor.
create table if not exists public.monthly (
  company_id uuid not null references public.companies on delete cascade,
  barber_id text not null references public.barbers on delete cascade,
  month text not null,             -- AAAA-MM
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (barber_id, month)
);

-- Checklist Agenda Cheia: um registro por profissional e dia (AAAA-MM-DD) ou mês (AAAA-MM, resultados do mês).
create table if not exists public.pop_records (
  id text primary key,
  company_id uuid not null references public.companies on delete cascade,
  barber_id text not null references public.barbers on delete cascade,
  day text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists pop_records_company_day on public.pop_records (company_id, day);

-- Chave da API de cada barbearia (só o gestor vê).
create table if not exists public.api_keys (
  company_id uuid primary key references public.companies on delete cascade,
  key text not null unique
);

create index if not exists entries_company_date on public.entries (company_id, date);
create index if not exists monthly_company_month on public.monthly (company_id, month);
create index if not exists profiles_company on public.profiles (company_id);
create index if not exists barbers_company on public.barbers (company_id);

-- Permissões das tabelas para quem está logado (as regras abaixo limitam o que cada um vê).
-- Garante o funcionamento mesmo com "Expor automaticamente novas tabelas" desligado.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.companies, public.profiles, public.barbers, public.invites,
  public.entries, public.monthly, public.api_keys, public.pop_records to authenticated;
-- As funções do servidor (API, Asaas, limpeza das fotos) usam o papel service_role.
grant select, insert, update, delete on public.companies, public.profiles, public.barbers, public.invites,
  public.entries, public.monthly, public.api_keys, public.pop_records to service_role;

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

-- Gestor de área (Organograma) ou nível de acesso Gestor: pode lançar os números de quem está abaixo dele.
create or replace function public.can_edit_barber(p_barber text) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive
  o as (select coalesce(c.settings->'org', '{}'::jsonb) j from companies c where c.id = my_company()),
  mine as (select g->>'nodeId' as nid from o, jsonb_array_elements(coalesce(o.j->'grants', '[]'::jsonb)) g
           where g->>'userId' = auth.uid()::text and g->>'role' = 'gestor'),
  nodes as (select n->>'id' as id, n->>'parentId' as pid, n->'people' as people from o, jsonb_array_elements(coalesce(o.j->'nodes', '[]'::jsonb)) n),
  sub(id) as (select id from nodes where id in (select nid from mine where nid is not null)
              union select n.id from nodes n join sub s on n.pid = s.id)
  select is_gestor()
      or exists (select 1 from mine where nid is null)
      -- Nível de acesso "Gestor" (Adicionar profissional): lança e confere de toda a equipe.
      or exists (select 1 from o where my_barber() is not null and o.j->'access'->>my_barber() = 'gestor')
      or exists (select 1 from nodes n join sub s on s.id = n.id where n.people ? ('b:' || p_barber))
$$;

-- Acessos extras do líder (Adicionar profissional): o dono libera conferir o checklist e/ou lançar métricas específicas.
create or replace function public.leader_extra() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select case when my_barber() is not null and c.settings->'org'->'access'->>my_barber() = 'lider'
    then coalesce(c.settings->'org'->'extras'->my_barber(), '{}'::jsonb) end
    from companies c where c.id = my_company()), '{}'::jsonb)
$$;
create or replace function public.leader_fields() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when jsonb_typeof(leader_extra()->'fields') = 'array' then leader_extra()->'fields' else '[]'::jsonb end
$$;
create or replace function public.can_review_barber(p_barber text) returns boolean
language sql stable security definer set search_path = public as $$
  select can_edit_barber(p_barber) or coalesce((leader_extra()->>'review')::boolean, false)
$$;

-- ---------- Regras de acesso (RLS) ----------
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.barbers enable row level security;
alter table public.invites enable row level security;
alter table public.entries enable row level security;
alter table public.monthly enable row level security;
alter table public.api_keys enable row level security;
alter table public.pop_records enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('companies','profiles','barbers','invites','entries','monthly','api_keys','pop_records') loop
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
-- Resultados diários: os da integração (source 'api') só o dono e a própria API gravam;
-- os lançados à mão (source 'manual') também o gestor de área, para as pessoas dele.
create policy entries_ins on public.entries for insert
  with check (company_id = my_company() and (is_gestor() or (source = 'manual' and (can_edit_barber(barber_id) or jsonb_array_length(leader_fields()) > 0))));
create policy entries_upd on public.entries for update
  using (company_id = my_company() and (is_gestor() or (source = 'manual' and (can_edit_barber(barber_id) or jsonb_array_length(leader_fields()) > 0))))
  with check (company_id = my_company() and (is_gestor() or (source = 'manual' and (can_edit_barber(barber_id) or jsonb_array_length(leader_fields()) > 0))));
create policy entries_del on public.entries for delete using (company_id = my_company() and is_gestor());
create policy monthly_read on public.monthly for select using (company_id = my_company());
create policy monthly_ins on public.monthly for insert with check (company_id = my_company() and (can_edit_barber(barber_id) or jsonb_array_length(leader_fields()) > 0));
create policy monthly_upd on public.monthly for update using (company_id = my_company() and (can_edit_barber(barber_id) or jsonb_array_length(leader_fields()) > 0)) with check (company_id = my_company() and (can_edit_barber(barber_id) or jsonb_array_length(leader_fields()) > 0));
create policy monthly_del on public.monthly for delete using (company_id = my_company() and is_gestor());

-- Total do mês: campo que já tem número da integração só muda pelo dono (ajuste manual),
-- e o registro de quem ajustou (_adj) também só o dono altera.
create or replace function public.guard_monthly() returns trigger
language plpgsql security invoker set search_path = public as $$
declare r record;
begin
  if current_user not in ('authenticated', 'anon') or is_gestor() then return new; end if;
  -- Líder com métricas liberadas: só altera essas.
  if not can_edit_barber(new.barber_id) and exists (
    select 1 from (select jsonb_object_keys(new.data) k union select jsonb_object_keys(case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end)) x
    where (new.data->x.k) is distinct from (case when tg_op = 'UPDATE' then old.data->x.k end) and not (leader_fields() ? x.k)
  ) then raise exception 'Você não tem permissão para lançar este indicador.'; end if;
  if nullif(new.data->'_adj', 'null'::jsonb) is distinct from (case when tg_op = 'UPDATE' then nullif(old.data->'_adj', 'null'::jsonb) end) then
    raise exception 'Só o dono pode ajustar valores da integração.';
  end if;
  for r in select * from (values ('fat', 'fat'), ('cli', 'cli'), ('serv', 'serv'), ('prod', 'prod'), ('planos', 'planos'), ('ocupPct', 'hDisp'), ('ocupPct', 'hOcup'), ('fidPct', 'ret')) v(k, ek) loop
    if nullif(new.data->r.k, 'null'::jsonb) is distinct from (case when tg_op = 'UPDATE' then nullif(old.data->r.k, 'null'::jsonb) end)
       and exists (select 1 from entries e where e.barber_id = new.barber_id and e.source <> 'manual' and to_char(e.date, 'YYYY-MM') = new.month and e.data ? r.ek) then
      raise exception 'Este campo vem da integração. Só o dono pode ajustar.';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists guard_monthly on public.monthly;
create trigger guard_monthly before insert or update on public.monthly for each row execute function public.guard_monthly();

-- Lançamentos por dia: o líder com métricas liberadas só grava essas.
create or replace function public.guard_entry() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') or is_gestor() or can_edit_barber(new.barber_id) then return new; end if;
  if exists (
    select 1 from (select jsonb_object_keys(new.data) k union select jsonb_object_keys(case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end)) x
    where (new.data->x.k) is distinct from (case when tg_op = 'UPDATE' then old.data->x.k end) and not (leader_fields() ? x.k)
  ) then raise exception 'Você não tem permissão para lançar este indicador.'; end if;
  return new;
end $$;
drop trigger if exists guard_entry on public.entries;
create trigger guard_entry before insert or update on public.entries for each row execute function public.guard_entry();

-- Checklist: membros leem; o próprio barbeiro, o gestor de área e o dono preenchem.
create policy pop_read on public.pop_records for select using (company_id = my_company());

-- Provas do checklist: só a gestão aprova ou recusa; ninguém confere a própria prova (exceto o dono);
-- prova já conferida não pode ser alterada nem apagada por quem não confere.
create or replace function public.guard_pop() returns trigger
language plpgsql security invoker set search_path = public as $$
declare reviewer boolean;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  reviewer := is_gestor() or (can_review_barber(new.barber_id) and new.barber_id is distinct from my_barber());
  if reviewer then return new; end if;
  if exists (
    select 1 from jsonb_each(coalesce(new.data->'ev', '{}'::jsonb)) k, jsonb_array_elements(case when jsonb_typeof(k.value) = 'array' then k.value else '[]'::jsonb end) e
    where coalesce(e->>'status', 'pendente') <> 'pendente'
      and not exists (select 1 from jsonb_each(coalesce(case when tg_op = 'UPDATE' then old.data->'ev' end, '{}'::jsonb)) k2,
                      jsonb_array_elements(case when jsonb_typeof(k2.value) = 'array' then k2.value else '[]'::jsonb end) e2
                      where e2->>'id' = e->>'id' and e2->>'status' = e->>'status')
  ) then raise exception 'Somente a gestão pode conferir as provas.'; end if;
  if tg_op = 'UPDATE' and exists (
    select 1 from jsonb_each(coalesce(old.data->'ev', '{}'::jsonb)) k, jsonb_array_elements(case when jsonb_typeof(k.value) = 'array' then k.value else '[]'::jsonb end) e
    where coalesce(e->>'status', 'pendente') <> 'pendente'
      and not exists (select 1 from jsonb_each(coalesce(new.data->'ev', '{}'::jsonb)) k2,
                      jsonb_array_elements(case when jsonb_typeof(k2.value) = 'array' then k2.value else '[]'::jsonb end) e2
                      where e2->>'id' = e->>'id' and e2->>'status' = e->>'status')
  ) then raise exception 'Prova já conferida não pode ser alterada.'; end if;
  return new;
end $$;
drop trigger if exists guard_pop on public.pop_records;
create trigger guard_pop before insert or update on public.pop_records for each row execute function public.guard_pop();
drop policy if exists pop_write on public.pop_records;
create policy pop_ins on public.pop_records for insert
  with check (company_id = my_company() and (can_edit_barber(barber_id) or can_review_barber(barber_id) or barber_id = my_barber()));
create policy pop_upd on public.pop_records for update
  using (company_id = my_company() and (can_edit_barber(barber_id) or can_review_barber(barber_id) or barber_id = my_barber()))
  with check (company_id = my_company() and (can_edit_barber(barber_id) or can_review_barber(barber_id) or barber_id = my_barber()));
create policy pop_del on public.pop_records for delete using (company_id = my_company() and is_gestor());

-- Fotos das provas (Storage, pasta: barbearia/barbeiro/dia/arquivo.jpg). Bucket privado, até 3 MB por imagem.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('provas', 'provas', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    drop policy if exists provas_read on storage.objects;
    drop policy if exists provas_insert on storage.objects;
    drop policy if exists provas_delete on storage.objects;
    create policy provas_read on storage.objects for select to authenticated
      using (bucket_id = 'provas' and (storage.foldername(name))[1] = my_company()::text);
    create policy provas_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'provas' and (storage.foldername(name))[1] = my_company()::text
        and (can_edit_barber((storage.foldername(name))[2]) or (storage.foldername(name))[2] = my_barber()));
    create policy provas_delete on storage.objects for delete to authenticated
      using (bucket_id = 'provas' and (storage.foldername(name))[1] = my_company()::text
        and (can_edit_barber((storage.foldername(name))[2]) or (storage.foldername(name))[2] = my_barber()));
    -- POPs · Guia do Sucesso: fotos do passo a passo (pasta: barbearia/pop/arquivo.jpg). Equipe vê; só o dono envia e apaga.
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('pops', 'pops', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    drop policy if exists pops_read on storage.objects;
    drop policy if exists pops_insert on storage.objects;
    drop policy if exists pops_delete on storage.objects;
    create policy pops_read on storage.objects for select to authenticated
      using (bucket_id = 'pops' and (storage.foldername(name))[1] = my_company()::text);
    create policy pops_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'pops' and (storage.foldername(name))[1] = my_company()::text and is_gestor());
    create policy pops_delete on storage.objects for delete to authenticated
      using (bucket_id = 'pops' and (storage.foldername(name))[1] = my_company()::text and is_gestor());
    -- Músicas do pódio (Fechamento): uma por colocação (pasta: barbearia/podio-N-id.mp3). Equipe ouve; só o dono envia e apaga. Até 12 MB.
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('musicas', 'musicas', false, 12582912, array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/webm'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    drop policy if exists musicas_read on storage.objects;
    drop policy if exists musicas_insert on storage.objects;
    drop policy if exists musicas_delete on storage.objects;
    create policy musicas_read on storage.objects for select to authenticated
      using (bucket_id = 'musicas' and (storage.foldername(name))[1] = my_company()::text);
    create policy musicas_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'musicas' and (storage.foldername(name))[1] = my_company()::text and is_gestor());
    create policy musicas_delete on storage.objects for delete to authenticated
      using (bucket_id = 'musicas' and (storage.foldername(name))[1] = my_company()::text and is_gestor());
    -- Fotos dos profissionais e logo da empresa (pasta: empresa/arquivo.jpg). Leitura pública pelo endereço
    -- (nome do arquivo aleatório), para os cards e a TV abrirem rápido; só a equipe da empresa envia e apaga. Até 2 MB.
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('fotos', 'fotos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    drop policy if exists fotos_insert on storage.objects;
    drop policy if exists fotos_delete on storage.objects;
    create policy fotos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = my_company()::text);
    create policy fotos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'fotos' and (storage.foldername(name))[1] = my_company()::text);
  end if;
end $$;

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
  begin alter publication supabase_realtime add table public.pop_records; exception when duplicate_object then null; end;
end $$;

-- =====================================================================
-- ASSINATURA (SaaS): planos, teste grátis, bloqueio e painel do dono do SaaS
-- =====================================================================

-- ---------- Planos ----------
create table if not exists public.plans (
  id text primary key,
  name text not null,
  max_barbers int,                 -- null = ilimitado
  price_cents int not null,        -- valor mensal em centavos
  api boolean not null default true,
  active boolean not null default true,
  sort int not null default 0
);
insert into public.plans (id, name, max_barbers, price_cents, sort) values
  ('essencial', 'Essencial', 4, 9900, 1),
  ('profissional', 'Profissional', 10, 17900, 2),
  ('premium', 'Premium', null, 27900, 3)
on conflict (id) do nothing;

-- ---------- Assinatura de cada barbearia ----------
alter table public.companies add column if not exists plan_id text references public.plans;
alter table public.companies add column if not exists sub_status text not null default 'trial';
alter table public.companies add column if not exists trial_ends_at timestamptz not null default now() + interval '7 days';
alter table public.companies add column if not exists paid_until date;
alter table public.companies add column if not exists asaas_customer_id text;
alter table public.companies add column if not exists asaas_subscription_id text;
alter table public.companies add column if not exists invoice_url text;
alter table public.companies add column if not exists cpf_cnpj text not null default '';
alter table public.companies add column if not exists terms_accepted_at timestamptz;
alter table public.companies drop constraint if exists companies_sub_status_check;
alter table public.companies add constraint companies_sub_status_check
  check (sub_status in ('trial', 'pending', 'active', 'overdue', 'canceled', 'courtesy', 'blocked'));
create index if not exists companies_asaas_sub on public.companies (asaas_subscription_id);
create index if not exists companies_asaas_cus on public.companies (asaas_customer_id);

-- Dono(s) do SaaS.
create table if not exists public.platform_admins (user_id uuid primary key references auth.users on delete cascade);
alter table public.platform_admins enable row level security;
alter table public.plans enable row level security;

grant select on public.plans to anon, authenticated;
grant insert, update on public.plans to authenticated;
grant select, insert, update, delete on public.plans, public.platform_admins to service_role;

-- ---------- Regra de acesso ----------
-- trial    : 7 dias desde o cadastro, só lançamento manual
-- pending  : assinou e aguarda o 1º pagamento (vale até 1 dia depois do fim do teste)
-- active / courtesy / canceled : vale até paid_until (+1 dia para compensação)
-- overdue / blocked : bloqueado
create or replace function public.access_of(c public.companies) returns text
language sql stable as $$
  select case
    when c.sub_status = 'trial' and now() < c.trial_ends_at then 'trial'
    when c.sub_status = 'pending' and now() < c.trial_ends_at + interval '1 day' then 'trial'
    when c.sub_status in ('active', 'courtesy', 'canceled') and c.paid_until is not null
         and current_date <= c.paid_until + 1 then 'paid'
    else 'blocked'
  end
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;

-- Barbearia do usuário, só se o acesso estiver liberado (usado em todas as regras de dados).
create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select p.company_id from profiles p join companies c on c.id = p.company_id
  where p.id = auth.uid() and p.status = 'ativo' and access_of(c) <> 'blocked'
$$;

-- Barbearia do usuário mesmo bloqueada (para mostrar a tela de pagamento).
create or replace function public.my_company_any() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid() and status = 'ativo'
$$;

drop policy if exists companies_read on public.companies;
create policy companies_read on public.companies for select using (id = my_company_any());

-- Campos de assinatura só mudam pelo servidor (Asaas), pelo SQL Editor ou pelo dono do SaaS.
-- (Roda com o papel de quem fez a alteração: usuários do app são "authenticated".)
create or replace function public.guard_company() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') or is_platform_admin() then
    return new;
  end if;
  if new.plan_id is distinct from old.plan_id or new.sub_status is distinct from old.sub_status
     or new.trial_ends_at is distinct from old.trial_ends_at or new.paid_until is distinct from old.paid_until
     or new.asaas_customer_id is distinct from old.asaas_customer_id
     or new.asaas_subscription_id is distinct from old.asaas_subscription_id
     or new.invoice_url is distinct from old.invoice_url or new.cpf_cnpj is distinct from old.cpf_cnpj then
    raise exception 'Os dados da assinatura só podem ser alterados pelo pagamento.';
  end if;
  return new;
end $$;
drop trigger if exists guard_company on public.companies;
create trigger guard_company before update on public.companies for each row execute function public.guard_company();

-- Situação da assinatura para o app.
create or replace function public.company_access() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'access', access_of(c), 'status', c.sub_status, 'plan_id', c.plan_id,
    'trial_ends_at', c.trial_ends_at, 'paid_until', c.paid_until, 'invoice_url', c.invoice_url,
    'has_subscription', c.asaas_subscription_id is not null, 'cpf_cnpj', c.cpf_cnpj,
    'max_barbers', case when access_of(c) = 'paid' then pl.max_barbers else null end,
    'api', access_of(c) = 'paid' and (c.sub_status = 'courtesy' or coalesce(pl.api, false)),
    'admin', is_platform_admin())
  from profiles p join companies c on c.id = p.company_id left join plans pl on pl.id = c.plan_id
  where p.id = auth.uid() and p.status = 'ativo'
$$;
grant execute on function public.company_access() to authenticated;

-- ---------- Limite de barbeiros do plano ----------
create or replace function public.guard_barber_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int; n int; c public.companies;
begin
  if not new.active or (tg_op = 'UPDATE' and old.active) then return new; end if;
  select * into c from companies where id = new.company_id;
  if access_of(c) <> 'paid' then return new; end if;  -- no teste não há limite
  select max_barbers into lim from plans where id = c.plan_id;
  if lim is null then return new; end if;
  select count(*) into n from barbers where company_id = new.company_id and active and id <> new.id;
  if n >= lim then
    raise exception 'Limite do plano: até % barbeiros ativos. Mude de plano para cadastrar mais.', lim;
  end if;
  return new;
end $$;
drop trigger if exists guard_barber_limit on public.barbers;
create trigger guard_barber_limit before insert or update of active on public.barbers
  for each row execute function public.guard_barber_limit();

-- ---------- Chave da API só nos planos pagos ----------
create or replace function public.rotate_api_key() returns text
language plpgsql security definer set search_path = public as $$
declare k text := 'gbia_' || replace(gen_random_uuid()::text, '-', ''); c public.companies;
begin
  if not is_gestor() then raise exception 'Somente o gestor.'; end if;
  select * into c from companies where id = my_company();
  if access_of(c) <> 'paid' then raise exception 'A integração por API está disponível nos planos pagos.'; end if;
  insert into api_keys (company_id, key) values (c.id, k)
  on conflict (company_id) do update set key = excluded.key;
  return k;
end $$;

-- ---------- Cadastro: guarda o aceite dos termos ----------
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
    -- Marca escolhida no cadastro: Gestão Barber IA (barbearia) ou Gestão Salão IA (salão/esmalteria).
    insert into companies (name, email, phone, terms_accepted_at, settings)
    values (coalesce(nullif(meta->>'company', ''), case when meta->>'brand' = 'salao' then 'Meu salão' else 'Minha barbearia' end),
            coalesce(new.email, ''), coalesce(meta->>'phone', ''),
            case when meta ? 'terms_accepted_at' then now() end,
            jsonb_build_object('brand', case when meta->>'brand' = 'salao' then 'salao' else 'barber' end))
    returning id into cid;
    insert into profiles (id, company_id, name, email, phone, role, status)
    values (new.id, cid, coalesce(nullif(meta->>'name', ''), meta->>'full_name', ''), coalesce(new.email, ''), coalesce(meta->>'phone', ''), 'gestor', 'ativo');
    insert into api_keys (company_id, key) values (cid, 'gbia_' || replace(gen_random_uuid()::text, '-', ''));
  end if;
  return new;
end $$;

-- ---------- Painel do dono do SaaS ----------
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select using (true);
drop policy if exists plans_admin_ins on public.plans;
create policy plans_admin_ins on public.plans for insert with check (is_platform_admin());
drop policy if exists plans_admin_upd on public.plans;
create policy plans_admin_upd on public.plans for update using (is_platform_admin());

create or replace function public.admin_companies() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Acesso restrito.'; end if;
  return coalesce((
    select json_agg(row_to_json(t) order by t.created_at desc) from (
      select c.id, c.name, c.email, c.phone, c.cpf_cnpj, c.created_at, c.plan_id, c.sub_status, access_of(c) as access,
             c.trial_ends_at, c.paid_until, c.asaas_subscription_id is not null as has_subscription,
             (select count(*) from barbers b where b.company_id = c.id and b.active) as barbers,
             (select count(*) from profiles p where p.company_id = c.id and p.status = 'ativo') as users,
             greatest((select max(updated_at) from entries e where e.company_id = c.id),
                      (select max(updated_at) from monthly m where m.company_id = c.id)) as last_activity,
             (select p.name from profiles p where p.company_id = c.id and p.role = 'gestor' order by p.created_at limit 1) as owner
      from companies c) t), '[]'::json);
end $$;
grant execute on function public.admin_companies() to authenticated;

create or replace function public.admin_update_company(p_id uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Acesso restrito.'; end if;
  update companies set
    plan_id = case when p_patch ? 'plan_id' then nullif(p_patch->>'plan_id', '') else plan_id end,
    sub_status = coalesce(p_patch->>'sub_status', sub_status),
    trial_ends_at = coalesce((p_patch->>'trial_ends_at')::timestamptz, trial_ends_at),
    paid_until = case when p_patch ? 'paid_until' then (p_patch->>'paid_until')::date else paid_until end
  where id = p_id;
end $$;
grant execute on function public.admin_update_company(uuid, jsonb) to authenticated;

-- ---------- Interessados (cadastro da página de vendas /oferta) ----------
-- Qualquer pessoa pode se cadastrar; só o dono do SaaS vê e edita a lista.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null check (char_length(nome) between 1 and 80),
  sobrenome text not null default '' check (char_length(sobrenome) <= 80),
  celular text not null check (char_length(celular) between 10 and 20),
  email text not null default '' check (char_length(email) <= 120),
  tipo text check (tipo in ('barbearia', 'salao', 'esmalteria', 'estetica')),
  equipe int check (equipe in (4, 10, 99)),
  origem text not null default '' check (char_length(origem) <= 200),
  consentimento boolean not null default false check (consentimento),
  status text not null default 'novo' check (status in ('novo', 'contatado', 'cliente', 'descartado')),
  nota text not null default '' check (char_length(nota) <= 500)
);
create index if not exists leads_created on public.leads (created_at desc);
alter table public.leads enable row level security;
grant insert on public.leads to anon, authenticated;
grant select, update, delete on public.leads to authenticated;
grant select, insert, update, delete on public.leads to service_role;
drop policy if exists leads_insert on public.leads;
drop policy if exists leads_admin_read on public.leads;
drop policy if exists leads_admin_upd on public.leads;
drop policy if exists leads_admin_del on public.leads;
create policy leads_insert on public.leads for insert to anon, authenticated
  with check (status = 'novo' and nota = '' and consentimento);
create policy leads_admin_read on public.leads for select using (is_platform_admin());
create policy leads_admin_upd on public.leads for update using (is_platform_admin()) with check (is_platform_admin());
create policy leads_admin_del on public.leads for delete using (is_platform_admin());
-- Respostas do quiz, enviadas logo depois do cadastro (só preenche o que estiver vazio, até 2 horas depois).
create or replace function public.lead_quiz(p_id uuid, p_tipo text, p_equipe int) returns void
language sql security definer set search_path = public as $$
  update leads set tipo = coalesce(tipo, p_tipo), equipe = coalesce(equipe, p_equipe)
  where id = p_id and created_at > now() - interval '2 hours'
    and p_tipo in ('barbearia', 'salao', 'esmalteria', 'estetica') and p_equipe in (4, 10, 99)
$$;
grant execute on function public.lead_quiz(uuid, text, int) to anon, authenticated;

-- ============================================================
-- Reportar erro, Sugestões de melhorias (com votos) — Gestão Barber IA / Gestão Salão IA
-- Pode rodar mais de uma vez (idempotente). Também está no final do schema.sql.
-- ============================================================

-- ---------- Erros reportados pelos donos das empresas ----------
create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) between 5 and 3000),
  page text not null default '' check (char_length(page) <= 80),
  device text not null default '' check (char_length(device) <= 300),
  shot text check (shot is null or char_length(shot) <= 300),
  status text not null default 'novo' check (status in ('novo', 'analisando', 'corrigido', 'descartado')),
  reply text not null default '' check (char_length(reply) <= 1000)
);
create index if not exists bug_reports_company on public.bug_reports (company_id, created_at desc);
alter table public.bug_reports enable row level security;
grant select, insert, update, delete on public.bug_reports to authenticated;
grant select, insert, update, delete on public.bug_reports to service_role;
drop policy if exists bug_ins on public.bug_reports;
drop policy if exists bug_read on public.bug_reports;
drop policy if exists bug_admin_upd on public.bug_reports;
drop policy if exists bug_admin_del on public.bug_reports;
-- O dono reporta pela própria empresa; só o dono do SaaS muda a situação e responde.
create policy bug_ins on public.bug_reports for insert to authenticated
  with check (company_id = my_company() and is_gestor() and user_id = auth.uid() and status = 'novo' and reply = '');
create policy bug_read on public.bug_reports for select using ((company_id = my_company() and is_gestor()) or is_platform_admin());
create policy bug_admin_upd on public.bug_reports for update using (is_platform_admin()) with check (is_platform_admin());
create policy bug_admin_del on public.bug_reports for delete using (is_platform_admin());

-- ---------- Sugestões de melhorias (todos os donos veem e votam) ----------
create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  brand text not null default 'barber' check (brand in ('barber', 'salao')),
  title text not null check (char_length(title) between 3 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  status text not null default 'aberta' check (status in ('aberta', 'analisando', 'planejada', 'feita', 'recusada')),
  reply text not null default '' check (char_length(reply) <= 1000)
);
create index if not exists suggestions_created on public.suggestions (created_at desc);
alter table public.suggestions enable row level security;
grant select, insert, update, delete on public.suggestions to authenticated;
grant select, insert, update, delete on public.suggestions to service_role;
drop policy if exists sug_read on public.suggestions;
drop policy if exists sug_ins on public.suggestions;
drop policy if exists sug_admin_upd on public.suggestions;
drop policy if exists sug_del on public.suggestions;
create policy sug_read on public.suggestions for select using (is_gestor() or is_platform_admin());
create policy sug_ins on public.suggestions for insert to authenticated
  with check (company_id = my_company() and is_gestor() and user_id = auth.uid() and status = 'aberta' and reply = '');
create policy sug_admin_upd on public.suggestions for update using (is_platform_admin()) with check (is_platform_admin());
-- Quem sugeriu pode apagar enquanto estiver aberta; o dono do SaaS pode apagar sempre.
create policy sug_del on public.suggestions for delete using (is_platform_admin() or (user_id = auth.uid() and status = 'aberta'));

-- Um voto por empresa em cada sugestão.
create table if not exists public.suggestion_votes (
  suggestion_id uuid not null references public.suggestions on delete cascade,
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (suggestion_id, company_id)
);
alter table public.suggestion_votes enable row level security;
grant select, insert, delete on public.suggestion_votes to authenticated;
grant select, insert, update, delete on public.suggestion_votes to service_role;
drop policy if exists vote_read on public.suggestion_votes;
drop policy if exists vote_ins on public.suggestion_votes;
drop policy if exists vote_del on public.suggestion_votes;
create policy vote_read on public.suggestion_votes for select using (is_gestor() or is_platform_admin());
create policy vote_ins on public.suggestion_votes for insert to authenticated
  with check (company_id = my_company() and is_gestor() and user_id = auth.uid());
create policy vote_del on public.suggestion_votes for delete using (company_id = my_company() and is_gestor());

-- Prints dos erros (pasta privada: empresa/arquivo.jpg). O dono envia; o dono e o dono do SaaS veem. Até 3 MB.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('reportes', 'reportes', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    drop policy if exists reportes_read on storage.objects;
    drop policy if exists reportes_insert on storage.objects;
    drop policy if exists reportes_delete on storage.objects;
    create policy reportes_read on storage.objects for select to authenticated
      using (bucket_id = 'reportes' and ((storage.foldername(name))[1] = my_company()::text or is_platform_admin()));
    create policy reportes_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'reportes' and (storage.foldername(name))[1] = my_company()::text and is_gestor());
    create policy reportes_delete on storage.objects for delete to authenticated
      using (bucket_id = 'reportes' and is_platform_admin());
  end if;
end $$;

-- Sonhos dos profissionais e Unidades (lojas). Pode rodar mais de uma vez.
alter table public.barbers add column if not exists dream jsonb;
alter table public.barbers add column if not exists unit text;
alter table public.barbers drop constraint if exists barbers_unit_len;
alter table public.barbers add constraint barbers_unit_len check (unit is null or char_length(unit) <= 40);
-- O profissional pode trocar a própria foto e o próprio sonho; nome, função, unidade e situação só o gestor.
create or replace function public.guard_barber() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_gestor() and (new.name is distinct from old.name or new.active is distinct from old.active
      or new.role is distinct from old.role or new.instagram is distinct from old.instagram or new.company_id is distinct from old.company_id
      or new.unit is distinct from old.unit) then
    raise exception 'O profissional só pode trocar a própria foto e o próprio sonho.';
  end if;
  return new;
end $$;
