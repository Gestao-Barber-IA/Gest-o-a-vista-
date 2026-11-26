-- Cashback pelo valor da comanda: ao finalizar (ou mudar o valor de um horário finalizado), o cashback do cliente é
-- recalculado pelo total cobrado, para qualquer cliente cadastrado (não só quem agendou pelo web app).
create or replace function public.ag_cb_calc(p_company uuid, p_valor numeric) returns numeric language sql stable security definer set search_path = public as $$
  select case when coalesce((c.cashback->>'ativo')::boolean, false) and coalesce((c.cashback->>'pct')::numeric, 0) > 0
              and p_valor >= coalesce((c.cashback->>'minimo')::numeric, 0)
         then round(p_valor * least(50, (c.cashback->>'pct')::numeric) / 100, 2) else 0 end
  from public.ag_config c where c.company_id = p_company
  union all select 0 limit 1;
$$;
revoke all on function public.ag_cb_calc(uuid, numeric) from public, anon, authenticated;

create or replace function public.ag_cb_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'finalizado' and new.cliente_id is not null and (old.status is distinct from new.status or old.valor is distinct from new.valor) then
    new.cashback := public.ag_cb_calc(new.company_id, coalesce(new.valor, 0));
  end if;
  return new;
end $$;
drop trigger if exists ag_cb_antes on public.ag_agendamentos;
create trigger ag_cb_antes before update on public.ag_agendamentos for each row execute function public.ag_cb_antes();

-- Depois do gatilho do status (ag_status_funil): acerta o lançamento de cashback desse horário.
create or replace function public.ag_cb_depois() returns trigger language plpgsql security definer set search_path = public as $$
declare g bigint; val int;
begin
  if new.status = 'finalizado' and new.cliente_id is not null and (old.status is distinct from new.status or old.valor is distinct from new.valor) then
    select id into g from public.ag_cashback where agendamento_id = new.id and tipo = 'ganho' limit 1;
    select coalesce((cashback->>'validade')::int, 0) into val from public.ag_config where company_id = new.company_id;
    if coalesce(new.cashback, 0) > 0 then
      if g is null then
        insert into public.ag_cashback (company_id, cliente_id, agendamento_id, tipo, valor, status, expira)
          values (new.company_id, new.cliente_id, new.id, 'ganho', new.cashback, 'liberado', case when coalesce(val, 0) > 0 then (new.inicio at time zone 'America/Sao_Paulo')::date + val end);
      else
        update public.ag_cashback set valor = new.cashback, status = 'liberado' where id = g;
      end if;
    elsif g is not null then
      update public.ag_cashback set status = 'cancelado' where id = g;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists ag_zcb_depois on public.ag_agendamentos;
create trigger ag_zcb_depois after update on public.ag_agendamentos for each row execute function public.ag_cb_depois();
