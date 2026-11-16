-- Termos e regras da barbearia: cada profissional lê, marca o aceite, escreve o nome completo e assina.
-- O texto fica nas configurações da empresa (settings.terms = { text, ver }); cada nova versão pede novo aceite.
-- Quem vê: o próprio profissional vê o dele; o dono (gestor) vê os de todos. Pode rodar mais de uma vez.
create table if not exists public.term_accepts (
  id text primary key,
  company_id uuid not null references public.companies on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  ver text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists term_accepts_company on public.term_accepts (company_id, ver);
grant select, insert, update, delete on public.term_accepts to authenticated;
grant all on public.term_accepts to service_role;
alter table public.term_accepts enable row level security;
drop policy if exists term_read on public.term_accepts;
drop policy if exists term_ins on public.term_accepts;
drop policy if exists term_upd on public.term_accepts;
drop policy if exists term_del on public.term_accepts;
create policy term_read on public.term_accepts for select using (company_id = my_company() and (user_id = auth.uid() or is_gestor()));
create policy term_ins on public.term_accepts for insert with check (company_id = my_company() and user_id = auth.uid());
create policy term_upd on public.term_accepts for update using (company_id = my_company() and user_id = auth.uid()) with check (company_id = my_company() and user_id = auth.uid());
create policy term_del on public.term_accepts for delete using (company_id = my_company() and is_gestor());
