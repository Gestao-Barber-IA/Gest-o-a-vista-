-- Sonhos dos profissionais e Unidades (lojas). Pode rodar mais de uma vez.
alter table public.barbers add column if not exists dream jsonb;
alter table public.barbers add column if not exists unit text;
alter table public.barbers drop constraint if exists barbers_unit_len;
alter table public.barbers add constraint barbers_unit_len check (unit is null or char_length(unit) <= 40);
-- O profissional pode trocar a própria foto e o próprio sonho; nome, função, unidade e situação só o gestor.
create or replace function public.guard_barber() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_gestor() and (new.name is distinct from old.name or new.active is distinct from old.active
      or new.role is distinct from old.role or new.instagram is distinct from old.instagram or new.company_id is distinct from old.company_id
      or new.unit is distinct from old.unit) then
    raise exception 'O profissional só pode trocar a própria foto e o próprio sonho.';
  end if;
  return new;
end $$;
