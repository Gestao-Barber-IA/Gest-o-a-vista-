-- Bônus: registro de bônus em dinheiro (ex.: roleta de R$ 10 a R$ 50 ao vender 3 produtos) ou presentes
-- (ex.: 2 ingressos VIP de cinema) dados ao profissional.
-- Quem lança: o dono, o gestor (de área ou nível Gestor) e o líder com o acesso extra "Bônus" (nunca para si mesmo).
-- Quem vê: o profissional vê só os dele; o dono, a gestão e o líder com o acesso extra veem os de todos.
-- Pode rodar mais de uma vez.
create table if not exists public.bonus_records (
  id text primary key,
  company_id uuid not null references public.companies on delete cascade,
  barber_id text not null references public.barbers on delete cascade,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bonus_records_company_date on public.bonus_records (company_id, date);

grant select, insert, update, delete on public.bonus_records to authenticated;
grant all on public.bonus_records to service_role;
alter table public.bonus_records enable row level security;

create or replace function public.lider_bonus() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((leader_extra()->>'bonus')::boolean, false)
$$;
grant execute on function public.lider_bonus() to authenticated;

drop policy if exists bonus_read on public.bonus_records;
drop policy if exists bonus_ins on public.bonus_records;
drop policy if exists bonus_upd on public.bonus_records;
drop policy if exists bonus_del on public.bonus_records;
create policy bonus_read on public.bonus_records for select
  using (company_id = my_company() and (is_gestor() or barber_id = my_barber() or can_edit_barber(barber_id) or lider_bonus()));
create policy bonus_ins on public.bonus_records for insert
  with check (company_id = my_company() and (is_gestor() or ((can_edit_barber(barber_id) or lider_bonus()) and barber_id is distinct from my_barber())));
create policy bonus_upd on public.bonus_records for update
  using (company_id = my_company() and (is_gestor() or ((can_edit_barber(barber_id) or lider_bonus()) and barber_id is distinct from my_barber())))
  with check (company_id = my_company() and (is_gestor() or ((can_edit_barber(barber_id) or lider_bonus()) and barber_id is distinct from my_barber())));
create policy bonus_del on public.bonus_records for delete
  using (company_id = my_company() and (is_gestor() or ((can_edit_barber(barber_id) or lider_bonus()) and barber_id is distinct from my_barber())));

do $$ begin
  begin alter publication supabase_realtime add table public.bonus_records; exception when duplicate_object then null; end;
end $$;
