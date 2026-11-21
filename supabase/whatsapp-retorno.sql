-- Retorno no tempo certo (WhatsApp): o sistema aprende de quantos em quantos dias cada cliente volta, o dia da semana,
-- o horário e o profissional de costume. Um dia depois do prazo dele, manda um convite com um horário livre no jeito dele.
alter table public.integrations add column if not exists rt_on boolean not null default false;
alter table public.integrations add column if not exists rt_daily integer not null default 10;
alter table public.integrations add column if not exists rt_text text not null default '';
alter table public.integrations add column if not exists rt_status text;
alter table public.integrations add column if not exists rt_status_at timestamptz;
