-- Lembretes automáticos no WhatsApp (checklist do dia).
-- O dono liga em Integração; o servidor de sincronização (IP fixo) envia pelo número conectado nele.
alter table public.integrations add column if not exists wa_on boolean not null default false;
alter table public.integrations add column if not exists wa_hour text not null default '13:00';
alter table public.integrations add column if not exists wa_min numeric not null default 6;
alter table public.integrations add column if not exists wa_text text not null default '';
alter table public.integrations add column if not exists wa_status text;
alter table public.integrations add column if not exists wa_status_at timestamptz;
