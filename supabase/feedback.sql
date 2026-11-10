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
