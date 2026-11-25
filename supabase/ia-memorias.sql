-- Memória do cliente (atendente IA): o que o cliente contou de útil para os próximos atendimentos. Pela chave do
-- telefone (hash), sem o número; só o nome e os 4 últimos dígitos para a equipe reconhecer. O gestor vê, corrige e apaga.
create table if not exists public.ia_memorias (
  company_id uuid not null references public.companies(id) on delete cascade,
  chave text not null,
  nome text not null default '',
  fone4 text not null default '',
  notas jsonb not null default '[]'::jsonb,   -- [{ t, em }]
  atualizado timestamptz not null default now(),
  app_em timestamptz,                          -- última correção feita no app (vale sobre o servidor)
  primary key (company_id, chave)
);
alter table public.ia_memorias enable row level security;
grant select, update on public.ia_memorias to authenticated;
grant all on public.ia_memorias to service_role;
drop policy if exists ia_memorias_ver on public.ia_memorias;
create policy ia_memorias_ver on public.ia_memorias for select using (company_id = my_company() and is_gestor());
drop policy if exists ia_memorias_editar on public.ia_memorias;
create policy ia_memorias_editar on public.ia_memorias for update using (company_id = my_company() and is_gestor()) with check (company_id = my_company() and is_gestor());
