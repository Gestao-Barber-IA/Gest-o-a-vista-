-- Fiscalização para o líder: o dono liga o acesso extra "Fiscalização" no líder (org.extras[id].disc).
-- O líder passa a ver e registrar ocorrências da equipe, nunca as próprias. Apagar continua só com o dono.
-- Pode rodar mais de uma vez.
create or replace function public.lider_disc(p_barber text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((leader_extra()->>'disc')::boolean, false) and p_barber is distinct from my_barber()
$$;
grant execute on function public.lider_disc(text) to authenticated;

drop policy if exists disc_read on public.discipline;
drop policy if exists disc_ins on public.discipline;
drop policy if exists disc_upd on public.discipline;
create policy disc_read on public.discipline for select
  using (company_id = my_company() and (is_gestor() or can_edit_barber(barber_id) or lider_disc(barber_id)));
create policy disc_ins on public.discipline for insert to authenticated
  with check (company_id = my_company() and user_id = auth.uid() and (is_gestor() or can_edit_barber(barber_id) or lider_disc(barber_id)));
create policy disc_upd on public.discipline for update
  using (company_id = my_company() and (is_gestor() or can_edit_barber(barber_id) or lider_disc(barber_id)))
  with check (company_id = my_company() and (is_gestor() or can_edit_barber(barber_id) or lider_disc(barber_id)));
