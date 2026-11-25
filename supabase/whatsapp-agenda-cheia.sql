-- Agenda cheia automática: profissional com pouca ocupação no próximo dia aberto (e, se ligado, no resto de hoje)
-- recebe convites para os clientes dele que estão perto do prazo de voltar, no período em que há horário livre.
alter table public.integrations add column if not exists ac_on boolean not null default false;
alter table public.integrations add column if not exists ac_limit integer not null default 60;  -- ocupação abaixo disso (%) recebe convites
alter table public.integrations add column if not exists ac_daily integer not null default 10; -- convites por dia
alter table public.integrations add column if not exists ac_days integer not null default 1;   -- 1 = próximo dia aberto; 2 = também o resto de hoje
alter table public.integrations add column if not exists ac_text text not null default '';
alter table public.integrations add column if not exists ac_status text;
alter table public.integrations add column if not exists ac_status_at timestamptz;
