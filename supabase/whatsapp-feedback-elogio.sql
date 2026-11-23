-- Pedido de feedback: resposta da atendente IA quando o cliente elogia e parabéns para o profissional no WhatsApp dele.
alter table public.integrations add column if not exists fb_reply text not null default '';
alter table public.integrations add column if not exists fb_pro_text text not null default '';
