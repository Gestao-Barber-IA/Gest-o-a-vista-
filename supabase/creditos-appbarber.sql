-- Créditos da API da AppBarber (pré-paga: cada consulta bem-sucedida gasta 1 crédito).
-- A API não informa o saldo; o sistema conta as consultas que faz e compara com as recargas registradas pelo dono.
alter table public.integrations add column if not exists ab_pack integer not null default 0;      -- saldo no momento da última recarga registrada
alter table public.integrations add column if not exists ab_used integer not null default 0;      -- consultas feitas desde então
alter table public.integrations add column if not exists ab_reset_at timestamptz;                  -- quando a recarga foi registrada
alter table public.integrations add column if not exists ab_zero_at timestamptz;                   -- quando a AppBarber respondeu "saldo insuficiente"

-- Soma as consultas de forma atômica (o servidor de sincronização e o de WhatsApp gravam ao mesmo tempo).
create or replace function public.ab_add_uso(p_company uuid, p_n integer, p_zero boolean)
returns void language sql security definer set search_path = public as $$
  update public.integrations
     set ab_used = ab_used + greatest(coalesce(p_n, 0), 0),
         ab_zero_at = case when p_zero then now() else ab_zero_at end
   where company_id = p_company;
$$;
revoke all on function public.ab_add_uso(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.ab_add_uso(uuid, integer, boolean) to service_role;
