-- Botão "Atualizar servidor agora" no app: o pedido vai para o servidor pela sync-servidor; o servidor informa a versão.
alter table public.integrations add column if not exists srv_update_req timestamptz;  -- pedido do app
alter table public.integrations add column if not exists srv_update_done timestamptz; -- servidor respondeu depois do pedido
alter table public.integrations add column if not exists srv_version text;            -- ex.: "9.3 · atendente 7.5"
alter table public.integrations add column if not exists srv_version_at timestamptz;
alter table public.integrations add column if not exists srv_msg text;
