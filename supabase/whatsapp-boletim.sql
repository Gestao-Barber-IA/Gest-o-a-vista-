-- Boletim do dono: resumo do dia no WhatsApp (faturamento, atendente IA, confirmações, vagas, agenda cheia, planos, amanhã).
alter table public.integrations add column if not exists bo_on boolean not null default false;
alter table public.integrations add column if not exists bo_hour text not null default '20:30';   -- horário de envio
alter table public.integrations add column if not exists bo_phone text not null default '';       -- WhatsApp do dono (vazio = o do relatório semanal)
alter table public.integrations add column if not exists bo_sent_on date;                         -- último dia enviado
alter table public.integrations add column if not exists bo_force boolean not null default false; -- "mandar agora" pelo app
alter table public.integrations add column if not exists bo_status text;
alter table public.integrations add column if not exists bo_status_at timestamptz;
