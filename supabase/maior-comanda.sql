-- Maior comanda com foto: o profissional registra o valor da maior comanda dele no mês e envia a foto
-- da comanda (obrigatória; fica no armazenamento privado "provas"). O valor vai para os lançamentos do dia.
-- A equipe vê o valor (destaque "Maior comanda"); a foto, só o dono, a gestão de área e o próprio profissional.
-- Pode rodar mais de uma vez.

create table if not exists public.comanda_records (
  id text primary key,
  company_id uuid not null references public.companies on delete cascade,
  barber_id text not null references public.barbers on delete cascade,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists comanda_records_company_date on public.comanda_records (company_id, date);

grant select, insert, update, delete on public.comanda_records to authenticated;
grant all on public.comanda_records to service_role;
alter table public.comanda_records enable row level security;

drop policy if exists comanda_rec_read on public.comanda_records;
drop policy if exists comanda_rec_ins on public.comanda_records;
drop policy if exists comanda_rec_upd on public.comanda_records;
drop policy if exists comanda_rec_del on public.comanda_records;
create policy comanda_rec_read on public.comanda_records for select
  using (company_id = my_company() and (is_gestor() or barber_id = my_barber() or can_edit_barber(barber_id)));
create policy comanda_rec_ins on public.comanda_records for insert
  with check (company_id = my_company() and (is_gestor() or barber_id = my_barber() or can_edit_barber(barber_id)));
create policy comanda_rec_upd on public.comanda_records for update
  using (company_id = my_company() and (is_gestor() or barber_id = my_barber() or can_edit_barber(barber_id)))
  with check (company_id = my_company() and (is_gestor() or barber_id = my_barber() or can_edit_barber(barber_id)));
create policy comanda_rec_del on public.comanda_records for delete
  using (company_id = my_company() and (is_gestor() or barber_id = my_barber() or can_edit_barber(barber_id)));

do $$ begin
  begin alter publication supabase_realtime add table public.comanda_records; exception when duplicate_object then null; end;
end $$;

-- O profissional passa a poder gravar a maior comanda nos próprios lançamentos (além dos campos já liberados).
create or replace function public.self_fields() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select
      (case when jsonb_typeof(c.settings->'org'->'self'->'fields') = 'array' then c.settings->'org'->'self'->'fields' else '[]'::jsonb end)
      || (case when jsonb_typeof(c.settings->'planos') = 'array' and jsonb_array_length(c.settings->'planos') > 0 then '["planos"]'::jsonb else '[]'::jsonb end)
      || '["comanda"]'::jsonb
    from companies c where c.id = my_company() and my_barber() is not null), '[]'::jsonb)
$$;
