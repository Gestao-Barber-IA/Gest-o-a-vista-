-- Pedido de feedback no WhatsApp para clientes novos, depois que a comanda é paga.
alter table public.integrations add column if not exists fb_on boolean not null default false;
alter table public.integrations add column if not exists fb_text text not null default '';
alter table public.integrations add column if not exists fb_status text;
alter table public.integrations add column if not exists fb_status_at timestamptz;
