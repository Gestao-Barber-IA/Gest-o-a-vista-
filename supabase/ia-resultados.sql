-- Resultado da atendente IA e do totem: cada agendamento, remarcação, cancelamento, adicional aceito, convite,
-- conversa e custo da IA vira uma linha. O app soma por período (Integração › Resultado da atendente IA).
create table if not exists public.ia_eventos (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  em timestamptz not null default now(),
  tipo text not null,        -- agendamento | remarcacao | cancelamento | adicional | convite | conversa | recepcao | uso
  origem text,               -- whatsapp | retorno | reconquista | feedback | totem
  valor numeric,             -- R$ do agendamento/adicional; US$ no "uso" (custo da IA)
  ref text,                  -- identificador do agendamento (códigos da AppBarber), para o comparecimento
  compareceu boolean,        -- conferido na agenda no dia seguinte (realizado)
  dados jsonb not null default '{}'::jsonb
);
create index if not exists ia_eventos_periodo on public.ia_eventos (company_id, em);
create unique index if not exists ia_eventos_ref on public.ia_eventos (company_id, ref);
alter table public.ia_eventos enable row level security;
grant select on public.ia_eventos to authenticated;
grant all on public.ia_eventos to service_role;
drop policy if exists ia_eventos_gestor on public.ia_eventos;
create policy ia_eventos_gestor on public.ia_eventos for select using (company_id = my_company() and is_gestor());
