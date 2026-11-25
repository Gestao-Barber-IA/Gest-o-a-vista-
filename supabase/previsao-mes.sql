-- Previsão do mês: valor dos horários já marcados por dia (do servidor, pela AppBarber), para projetar o faturamento.
alter table public.integrations add column if not exists fc_agenda jsonb not null default '{}'::jsonb; -- { "AAAA-MM-DD": valor }
alter table public.integrations add column if not exists fc_at timestamptz;
