-- Autolançamento: o dono libera indicadores para cada profissional lançar os PRÓPRIOS números
-- (Configurações › Indicadores e metas › "Profissional lança os próprios números").
-- Fica em companies.settings->'org'->'self'->'fields' (só o dono altera as configurações).
-- Pode rodar mais de uma vez.

create or replace function public.self_fields() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select case when my_barber() is not null and jsonb_typeof(c.settings->'org'->'self'->'fields') = 'array'
    then c.settings->'org'->'self'->'fields' end
    from companies c where c.id = my_company()), '[]'::jsonb)
$$;

-- Indicadores que a pessoa pode lançar para este profissional: os do líder (toda a equipe)
-- mais os do autolançamento (só quando o profissional é ela mesma).
create or replace function public.lan_fields(p_barber text) returns jsonb
language sql stable security definer set search_path = public as $$
  select leader_fields() || case when p_barber is not null and p_barber = my_barber() then self_fields() else '[]'::jsonb end
$$;

grant execute on function public.self_fields() to authenticated;
grant execute on function public.lan_fields(text) to authenticated;

drop policy if exists entries_ins on public.entries;
drop policy if exists entries_upd on public.entries;
create policy entries_ins on public.entries for insert
  with check (company_id = my_company() and (is_gestor() or (source = 'manual' and (can_edit_barber(barber_id) or jsonb_array_length(lan_fields(barber_id)) > 0))));
create policy entries_upd on public.entries for update
  using (company_id = my_company() and (is_gestor() or (source = 'manual' and (can_edit_barber(barber_id) or jsonb_array_length(lan_fields(barber_id)) > 0))))
  with check (company_id = my_company() and (is_gestor() or (source = 'manual' and (can_edit_barber(barber_id) or jsonb_array_length(lan_fields(barber_id)) > 0))));

drop policy if exists monthly_ins on public.monthly;
drop policy if exists monthly_upd on public.monthly;
create policy monthly_ins on public.monthly for insert with check (company_id = my_company() and (can_edit_barber(barber_id) or jsonb_array_length(lan_fields(barber_id)) > 0));
create policy monthly_upd on public.monthly for update using (company_id = my_company() and (can_edit_barber(barber_id) or jsonb_array_length(lan_fields(barber_id)) > 0)) with check (company_id = my_company() and (can_edit_barber(barber_id) or jsonb_array_length(lan_fields(barber_id)) > 0));

create or replace function public.guard_entry() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') or is_gestor() or can_edit_barber(new.barber_id) then return new; end if;
  if exists (
    select 1 from (select jsonb_object_keys(new.data) k union select jsonb_object_keys(case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end)) x
    where (new.data->x.k) is distinct from (case when tg_op = 'UPDATE' then old.data->x.k end) and not (lan_fields(new.barber_id) ? x.k)
  ) then raise exception 'Você não tem permissão para lançar este indicador.'; end if;
  return new;
end $$;

create or replace function public.guard_monthly() returns trigger
language plpgsql security invoker set search_path = public as $$
declare r record;
begin
  if current_user not in ('authenticated', 'anon') or is_gestor() then return new; end if;
  -- Líder com métricas liberadas ou profissional no autolançamento: só altera essas.
  if not can_edit_barber(new.barber_id) and exists (
    select 1 from (select jsonb_object_keys(new.data) k union select jsonb_object_keys(case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end)) x
    where (new.data->x.k) is distinct from (case when tg_op = 'UPDATE' then old.data->x.k end) and not (lan_fields(new.barber_id) ? x.k)
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
