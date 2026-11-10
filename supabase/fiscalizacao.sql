-- Fiscalização (controle disciplinar). Só o gestor e os líderes da área veem e registram; o profissional não vê. Pode rodar mais de uma vez.
create table if not exists public.discipline (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  barber_id text not null check (char_length(barber_id) <= 80),
  day date not null default current_date,
  severity text not null default 'ocorrencia' check (severity in ('ocorrencia', 'advertencia', 'reincidencia', 'penalidade')),
  kind text not null default 'outro' check (kind in ('atraso', 'falta', 'atendimento', 'higiene', 'uniforme', 'organizacao', 'comportamento', 'outro')),
  note text not null default '' check (char_length(note) <= 2000),
  author text not null default '' check (char_length(author) <= 80)
);
create index if not exists discipline_company on public.discipline (company_id, day desc);
alter table public.discipline enable row level security;
grant select, insert, update, delete on public.discipline to authenticated;
grant select, insert, update, delete on public.discipline to service_role;
drop policy if exists disc_read on public.discipline;
drop policy if exists disc_ins on public.discipline;
drop policy if exists disc_upd on public.discipline;
drop policy if exists disc_del on public.discipline;
create policy disc_read on public.discipline for select using (company_id = my_company() and (is_gestor() or can_edit_barber(barber_id)));
create policy disc_ins on public.discipline for insert to authenticated
  with check (company_id = my_company() and user_id = auth.uid() and (is_gestor() or can_edit_barber(barber_id)));
create policy disc_upd on public.discipline for update using (company_id = my_company() and (is_gestor() or can_edit_barber(barber_id)))
  with check (company_id = my_company() and (is_gestor() or can_edit_barber(barber_id)));
create policy disc_del on public.discipline for delete using (company_id = my_company() and is_gestor());
