-- Aprovação de empresas pelo dono do SaaS. Pode rodar mais de uma vez.
-- As empresas que já existem continuam aprovadas; as que se cadastrarem daqui em diante ficam aguardando aprovação.
alter table public.companies add column if not exists approved boolean not null default true;
alter table public.companies alter column approved set default false;

-- Sem aprovação, o acesso fica bloqueado no servidor (todas as regras de dados usam access_of).
create or replace function public.access_of(c public.companies) returns text
language sql stable as $$
  select case
    when not coalesce(c.approved, true) then 'blocked'
    when c.sub_status = 'trial' and now() < c.trial_ends_at then 'trial'
    when c.sub_status = 'pending' and now() < c.trial_ends_at + interval '1 day' then 'trial'
    when c.sub_status in ('active', 'courtesy', 'canceled') and c.paid_until is not null
         and current_date <= c.paid_until + 1 then 'paid'
    else 'blocked'
  end
$$;

-- O próprio cliente não pode se aprovar.
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
     or new.invoice_url is distinct from old.invoice_url or new.cpf_cnpj is distinct from old.cpf_cnpj
     or new.approved is distinct from old.approved then
    raise exception 'Os dados da assinatura só podem ser alterados pelo pagamento.';
  end if;
  return new;
end $$;

-- O app sabe se a empresa ainda aguarda aprovação.
create or replace function public.company_access() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'access', access_of(c), 'status', c.sub_status, 'plan_id', c.plan_id,
    'trial_ends_at', c.trial_ends_at, 'paid_until', c.paid_until, 'invoice_url', c.invoice_url,
    'has_subscription', c.asaas_subscription_id is not null, 'cpf_cnpj', c.cpf_cnpj,
    'max_barbers', case when access_of(c) = 'paid' then pl.max_barbers else null end,
    'api', access_of(c) = 'paid' and (c.sub_status = 'courtesy' or coalesce(pl.api, false)),
    'admin', is_platform_admin(), 'approved', coalesce(c.approved, true))
  from profiles p join companies c on c.id = p.company_id left join plans pl on pl.id = c.plan_id
  where p.id = auth.uid() and p.status = 'ativo'
$$;
grant execute on function public.company_access() to authenticated;

-- Painel do SaaS: lista com a situação da aprovação.
create or replace function public.admin_companies() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Acesso restrito.'; end if;
  return coalesce((
    select json_agg(row_to_json(t) order by t.created_at desc) from (
      select c.id, c.name, c.email, c.phone, c.cpf_cnpj, c.created_at, c.plan_id, c.sub_status, access_of(c) as access,
             c.trial_ends_at, c.paid_until, c.asaas_subscription_id is not null as has_subscription,
             coalesce(c.approved, true) as approved,
             (select count(*) from barbers b where b.company_id = c.id and b.active) as barbers,
             (select count(*) from profiles p where p.company_id = c.id and p.status = 'ativo') as users,
             greatest((select max(updated_at) from entries e where e.company_id = c.id),
                      (select max(updated_at) from monthly m where m.company_id = c.id)) as last_activity,
             (select p.name from profiles p where p.company_id = c.id and p.role = 'gestor' order by p.created_at limit 1) as owner
      from companies c) t), '[]'::json);
end $$;
grant execute on function public.admin_companies() to authenticated;

-- Aprovar: libera o acesso e o teste grátis de 7 dias começa a contar na aprovação.
create or replace function public.admin_update_company(p_id uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Acesso restrito.'; end if;
  update companies set
    plan_id = case when p_patch ? 'plan_id' then nullif(p_patch->>'plan_id', '') else plan_id end,
    sub_status = coalesce(p_patch->>'sub_status', sub_status),
    trial_ends_at = coalesce((p_patch->>'trial_ends_at')::timestamptz, trial_ends_at),
    paid_until = case when p_patch ? 'paid_until' then (p_patch->>'paid_until')::date else paid_until end,
    approved = case when p_patch ? 'approved' then (p_patch->>'approved')::boolean else approved end
  where id = p_id;
end $$;
