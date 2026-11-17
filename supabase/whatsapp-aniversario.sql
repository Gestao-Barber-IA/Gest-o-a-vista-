-- Parabéns no WhatsApp para os clientes aniversariantes do dia (lista de aniversariantes da AppBarber).
alter table public.integrations add column if not exists bd_on boolean not null default false;
alter table public.integrations add column if not exists bd_text text not null default '';
alter table public.integrations add column if not exists bd_status text;
alter table public.integrations add column if not exists bd_status_at timestamptz;
