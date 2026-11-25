-- Lembrete de agendamento: antecedência diferente para os horários da tarde (ex.: manhã 1 hora antes; a partir das 13h, 2 horas antes).
alter table public.integrations add column if not exists cl_lead_pm integer;                    -- vazio = a mesma da manhã
alter table public.integrations add column if not exists cl_pm_from text not null default '13:00';
