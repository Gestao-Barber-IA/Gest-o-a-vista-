-- Link personalizado do web app: /agendar/<nome> (letras minúsculas, números e hífen; único entre as empresas).
alter table public.ag_config add column if not exists slug text not null default '';
create unique index if not exists ag_config_slug on public.ag_config (slug) where slug <> '';
-- O app confere se o nome está livre antes de salvar (sem ver os dados das outras empresas).
create or replace function public.ag_slug_livre(p_slug text) returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.ag_config where slug = lower(p_slug) and company_id <> public.my_company());
$$;
revoke all on function public.ag_slug_livre(text) from public, anon;
grant execute on function public.ag_slug_livre(text) to authenticated;
