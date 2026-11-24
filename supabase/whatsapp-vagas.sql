-- Preencher vagas (WhatsApp): quando um horário de hoje (ou amanhã) é cancelado e continua livre, o servidor convida
-- na hora clientes do mesmo profissional que já estão no prazo de voltar. A atendente IA responde e marca.
alter table public.integrations add column if not exists fv_on boolean not null default false;
alter table public.integrations add column if not exists fv_per integer not null default 2;     -- convites por vaga
alter table public.integrations add column if not exists fv_daily integer not null default 8;   -- convites por dia
alter table public.integrations add column if not exists fv_lead integer not null default 90;   -- minutos mínimos até o horário
alter table public.integrations add column if not exists fv_days integer not null default 2;    -- 1 = só hoje; 2 = hoje e amanhã
alter table public.integrations add column if not exists fv_text text not null default '';
alter table public.integrations add column if not exists fv_status text;
alter table public.integrations add column if not exists fv_status_at timestamptz;
