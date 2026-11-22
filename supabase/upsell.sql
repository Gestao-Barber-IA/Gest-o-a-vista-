-- Ofertas no final do agendamento (upsell): usadas pelo totem da recepção e pela Sofia no WhatsApp.
-- upsell: [{ texto, valor, servicos ("Nome na AppBarber" ou "A + B"), quando (palavras do serviço escolhido; vazio = sempre) }]
alter table public.integrations add column if not exists upsell jsonb not null default '[]'::jsonb;
-- Serviços da AppBarber (código e nome), enviados pelo servidor: o app sugere os nomes certos ao montar as ofertas.
alter table public.integrations add column if not exists ab_services jsonb;
