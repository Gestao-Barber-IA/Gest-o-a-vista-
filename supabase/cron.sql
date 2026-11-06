-- Gestão Barber IA — agendamento diário da limpeza das fotos das provas.
-- Rode depois de publicar a função "limpar-provas". Troque SEU_PROJECT_REF pelo do projeto.
-- Roda todo dia às 3h15 (horário de Brasília = 6h15 UTC).
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  perform cron.unschedule('limpar-provas');
exception when others then null;
end $$;

select cron.schedule(
  'limpar-provas',
  '15 6 * * *',
  $$ select net.http_post(
       url := 'https://SEU_PROJECT_REF.supabase.co/functions/v1/limpar-provas',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
