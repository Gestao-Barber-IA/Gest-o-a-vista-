-- Checklist › Horário de chegada → registro automático na Fiscalização (tipo Atraso).
--  • Amarelo "Chegou após o horário combinado": registra (ocorrência), sem somar para advertência.
--  • Vermelho "Chegou atrasado", contando no mês: 1º advertência, 2º reincidência, do 3º em diante penalidade.
-- Quem marca: dono, gestor (de área ou nível Gestor) ou líder; nunca o próprio profissional.
-- Funciona mesmo para o líder sem o acesso extra "Fiscalização". Pode rodar mais de uma vez.
drop function if exists public.registrar_atraso(text, date, text);
create or replace function public.registrar_atraso(p_barber text, p_day date, p_author text default '', p_tipo text default 'atraso')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid := my_company();
  lider boolean;
  n int;
  sev text;
  nota text;
  rid uuid;
begin
  if cid is null then raise exception 'Sem empresa.'; end if;
  select coalesce(c.settings->'org'->'access'->>my_barber() = 'lider', false) into lider from companies c where c.id = cid;
  if not (is_gestor() or ((can_edit_barber(p_barber) or lider) and p_barber is distinct from my_barber())) then
    raise exception 'Só o dono, o gestor ou o líder marcam o horário de chegada.';
  end if;
  if not exists (select 1 from barbers where company_id = cid and id = p_barber) then raise exception 'Profissional não encontrado.'; end if;
  if p_tipo = 'apos' then
    sev := 'ocorrencia';
    nota := 'Chegou após o horário combinado: sem bônus (marcado no Checklist › Horário de chegada).';
  else
    select count(*) into n from discipline
      where company_id = cid and barber_id = p_barber and kind in ('atraso', 'falta') and note like 'Chegou atrasado%'
        and date_trunc('month', day) = date_trunc('month', p_day);
    sev := case when n = 0 then 'advertencia' when n = 1 then 'reincidencia' else 'penalidade' end;
    nota := 'Chegou atrasado, depois do horário combinado (marcado no Checklist › Horário de chegada).';
  end if;
  insert into discipline (company_id, user_id, barber_id, day, severity, kind, note, author)
    values (cid, auth.uid(), p_barber, p_day, sev, 'atraso', nota, left(coalesce(p_author, ''), 80))
    returning id into rid;
  return jsonb_build_object('id', rid, 'severity', sev);
end $$;
grant execute on function public.registrar_atraso(text, date, text, text) to authenticated;

-- Desfazer a marcação: apaga o registro gerado (só quem marcou, ou o dono).
create or replace function public.desfazer_atraso(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from discipline where id = p_id and company_id = my_company() and kind in ('atraso', 'falta')
    and (note like 'Chegou atrasado%' or note like 'Chegou após o horário combinado%') and (is_gestor() or user_id = auth.uid());
  return found;
end $$;
grant execute on function public.desfazer_atraso(uuid) to authenticated;
