-- Checklist de rotina (Líder e Recepção): tarefas com horário que o líder e a recepcionista ticam no dia.
-- Só o dono e quem tem nível de acesso Gestor criam e mudam as tarefas. Algumas tarefas só podem ser
-- confirmadas com foto e descrição (a regra vale também no servidor). Pode rodar mais de uma vez.

-- Dono ou nível de acesso "Gestor" (Adicionar profissional).
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select is_gestor() or exists (select 1 from companies c where c.id = my_company()
    and my_barber() is not null and c.settings->'org'->'access'->>my_barber() = 'gestor')
$$;

-- Quem cumpre as tarefas de cada público: Líder = nível de acesso Líder; Recepção = função com "recep".
create or replace function public.routine_can_do(p_aud text) returns boolean
language sql stable security definer set search_path = public as $$
  select is_manager()
    or (p_aud = 'lider' and exists (select 1 from companies c where c.id = my_company()
          and my_barber() is not null and c.settings->'org'->'access'->>my_barber() = 'lider'))
    or (p_aud = 'recepcao' and exists (select 1 from barbers b where b.id = my_barber()
          and b.company_id = my_company() and b.role ilike '%recep%'))
$$;

create table if not exists public.routine_tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  audience text not null default 'lider' check (audience in ('lider', 'recepcao')),
  title text not null check (char_length(title) between 1 and 120),
  detail text not null default '' check (char_length(detail) <= 1000),
  at text not null default '09:00' check (at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  days int[] not null default '{1,2,3,4,5,6}',   -- 0 = domingo … 6 = sábado
  proof boolean not null default false,
  active boolean not null default true
);
create index if not exists routine_tasks_company on public.routine_tasks (company_id, audience, at);

create table if not exists public.routine_done (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  task_id uuid not null references public.routine_tasks on delete cascade,
  day date not null,
  done_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  author text not null default '' check (char_length(author) <= 80),
  note text not null default '' check (char_length(note) <= 1000),
  photo text check (photo is null or char_length(photo) <= 300),
  unique (task_id, day)
);
create index if not exists routine_done_company on public.routine_done (company_id, day desc);

alter table public.routine_tasks enable row level security;
alter table public.routine_done enable row level security;
grant select, insert, update, delete on public.routine_tasks, public.routine_done to authenticated;
grant select, insert, update, delete on public.routine_tasks, public.routine_done to service_role;

drop policy if exists rt_read on public.routine_tasks;
drop policy if exists rt_ins on public.routine_tasks;
drop policy if exists rt_upd on public.routine_tasks;
drop policy if exists rt_del on public.routine_tasks;
create policy rt_read on public.routine_tasks for select using (company_id = my_company());
create policy rt_ins on public.routine_tasks for insert to authenticated with check (company_id = my_company() and is_manager());
create policy rt_upd on public.routine_tasks for update using (company_id = my_company() and is_manager()) with check (company_id = my_company() and is_manager());
create policy rt_del on public.routine_tasks for delete using (company_id = my_company() and is_manager());

drop policy if exists rd_read on public.routine_done;
drop policy if exists rd_ins on public.routine_done;
drop policy if exists rd_del on public.routine_done;
create policy rd_read on public.routine_done for select using (company_id = my_company());
create policy rd_ins on public.routine_done for insert to authenticated
  with check (company_id = my_company() and user_id = auth.uid()
    and exists (select 1 from routine_tasks t where t.id = task_id and t.company_id = my_company() and routine_can_do(t.audience)));
-- Desfazer: a gestão, ou quem ticou, no mesmo dia.
create policy rd_del on public.routine_done for delete
  using (company_id = my_company() and (is_manager() or (user_id = auth.uid() and day = (now() at time zone 'America/Sao_Paulo')::date)));

-- Tarefa com prova: só confirma com foto e descrição. Quem não é da gestão só tica o dia de hoje.
create or replace function public.guard_routine_done() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if not is_manager() and new.day <> (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Só dá para marcar as tarefas de hoje.';
  end if;
  if exists (select 1 from routine_tasks t where t.id = new.task_id and t.proof)
     and (new.photo is null or char_length(btrim(new.note)) < 3) then
    raise exception 'Esta tarefa só pode ser confirmada com foto e descrição.';
  end if;
  new.done_at := now();
  return new;
end $$;
drop trigger if exists guard_routine_done on public.routine_done;
create trigger guard_routine_done before insert on public.routine_done for each row execute function public.guard_routine_done();
