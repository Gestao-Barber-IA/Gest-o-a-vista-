-- Planos mensais vendidos: o profissional registra cada plano que fechou (nome e sobrenome do cliente,
-- WhatsApp e qual plano). Os dados do cliente só são vistos pelo dono, pela gestão de área e pelo
-- próprio profissional. A contagem (indicador Planos mensais) vai para os lançamentos do dia.
-- Pode rodar mais de uma vez.

create table if not exists public.plan_sales (
  id text primary key,
  company_id uuid not null references public.companies on delete cascade,
  barber_id text not null references public.barbers on delete cascade,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plan_sales_company_date on public.plan_sales (company_id, date);

grant select, insert, update, delete on public.plan_sales to authenticated;
grant all on public.plan_sales to service_role;
alter table public.plan_sales enable row level security;

drop policy if exists plan_sales_read on public.plan_sales;
drop policy if exists plan_sales_ins on public.plan_sales;
drop policy if exists plan_sales_upd on public.plan_sales;
drop policy if exists plan_sales_del on public.plan_sales;
create policy plan_sales_read on public.plan_sales for select
  using (company_id = my_company() and (is_gestor() or barber_id = my_barber() or can_edit_barber(barber_id)));
create policy plan_sales_ins on public.plan_sales for insert
  with check (company_id = my_company() and (is_gestor() or barber_id = my_barber() or can_edit_barber(barber_id)));
create policy plan_sales_upd on public.plan_sales for update
  using (company_id = my_company() and (is_gestor() or barber_id = my_barber() or can_edit_barber(barber_id)))
  with check (company_id = my_company() and (is_gestor() or barber_id = my_barber() or can_edit_barber(barber_id)));
create policy plan_sales_del on public.plan_sales for delete
  using (company_id = my_company() and (is_gestor() or barber_id = my_barber() or can_edit_barber(barber_id)));

do $$ begin
  begin alter publication supabase_realtime add table public.plan_sales; exception when duplicate_object then null; end;
end $$;

-- Com planos cadastrados pelo dono, o profissional pode atualizar a contagem de planos dos próprios lançamentos.
create or replace function public.self_fields() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select
      (case when jsonb_typeof(c.settings->'org'->'self'->'fields') = 'array' then c.settings->'org'->'self'->'fields' else '[]'::jsonb end)
      || (case when jsonb_typeof(c.settings->'planos') = 'array' and jsonb_array_length(c.settings->'planos') > 0 then '["planos"]'::jsonb else '[]'::jsonb end)
    from companies c where c.id = my_company() and my_barber() is not null), '[]'::jsonb)
$$;
