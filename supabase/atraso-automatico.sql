-- Checklist › Horário de chegada: o botão vermelho "Chegou atrasado" gera sozinho um registro na Fiscalização.
-- Tipo: falta. Gravidade no mês: 1ª vez ocorrência, 2ª reincidência, 3ª em diante penalidade.
-- Quem marca: dono, gestor (de área ou nível Gestor) ou líder; nunca o próprio profissional.
-- Funciona mesmo para o líder sem o acesso extra "Fiscalização" (ele só não vê a página). Pode rodar mais de uma vez.
create or replace function public.registrar_atraso(p_barber text, p_day date, p_author text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid := my_company();
  lider boolean;
  n int;
  sev text;
  rid uuid;
begin
  if cid is null then raise exception 'Sem empresa.'; end if;
  select coalesce(c.settings->'org'->'access'->>my_barber() = 'lider', false) into lider from companies c where c.id = cid;
  if not (is_gestor() or ((can_edit_barber(p_barber) or lider) and p_barber is distinct from my_barber())) then
    raise exception 'Só o dono, o gestor ou o líder marcam o horário de chegada.';
  end if;
  if not exists (select 1 from barbers where company_id = cid and id = p_barber) then raise exception 'Profissional não encontrado.'; end if;
  select count(*) into n from discipline
    where company_id = cid and barber_id = p_barber and kind = 'falta'
      and date_trunc('month', day) = date_trunc('month', p_day);
  sev := case when n = 0 then 'ocorrencia' when n = 1 then 'reincidencia' else 'penalidade' end;
  insert into discipline (company_id, user_id, barber_id, day, severity, kind, note, author)
    values (cid, auth.uid(), p_barber, p_day, sev, 'falta',
      'Chegou atrasado, depois do horário combinado (marcado no Checklist › Horário de chegada).', left(coalesce(p_author, ''), 80))
    returning id into rid;
  return jsonb_build_object('id', rid, 'severity', sev);
end $$;
grant execute on function public.registrar_atraso(text, date, text) to authenticated;

-- Desfazer a marcação vermelha: apaga o registro gerado (só quem marcou, ou o dono).
create or replace function public.desfazer_atraso(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from discipline where id = p_id and company_id = my_company() and kind = 'falta'
    and note like 'Chegou atrasado, depois do horário combinado%' and (is_gestor() or user_id = auth.uid());
  return found;
end $$;
grant execute on function public.desfazer_atraso(uuid) to authenticated;
