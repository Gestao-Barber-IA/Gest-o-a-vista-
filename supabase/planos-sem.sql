-- Profissionais que não fecham planos mensais (ex.: o dono, por causa da agenda e da gestão): a venda automática
-- de planos não convida quem costuma cortar com eles.
alter table public.integrations add column if not exists pl_sem jsonb not null default '[]'::jsonb;
