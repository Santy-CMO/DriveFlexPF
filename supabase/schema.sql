-- DriveFlex: inventario, disponibilidad y pedidos de renta.
-- Ejecutar una sola vez en Supabase > SQL Editor.
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  model text not null,
  category text not null check (category in ('economico', 'sedan', 'suv')),
  year smallint not null check (year between 1980 and 2100),
  daily_price numeric(10,2) not null check (daily_price >= 0),
  unit_code text not null unique,
  status text not null default 'active' check (status in ('active', 'maintenance', 'inactive')),
  created_at timestamptz not null default now()
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id),
  customer_name text not null check (char_length(customer_name) between 2 and 120),
  customer_email text not null check (char_length(customer_email) <= 254),
  customer_phone text not null check (char_length(customer_phone) between 7 and 25),
  pickup_date date not null,
  return_date date not null,
  daily_price numeric(10,2) not null check (daily_price >= 0),
  total_price numeric(12,2) not null check (total_price >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rented', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  check (return_date > pickup_date),
  check (return_date <= pickup_date + 30)
);

-- Impide traslapes en una misma unidad, incluso ante dos solicitudes simultáneas.
do $$ begin
  alter table public.reservations
    add constraint reservations_vehicle_dates_no_overlap
    exclude using gist (
      vehicle_id with =,
      daterange(pickup_date, return_date, '[)') with &&
    ) where (status in ('pending', 'confirmed', 'rented'));
exception when duplicate_object then null;
end $$;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_version (
  id integer primary key check (id = 1),
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.inventory_version (id) values (1) on conflict (id) do nothing;

create or replace function public.is_driveflex_admin()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()) $$;

-- Controla stock por modelo: las reservas pendientes/confirmadas/en curso bloquean fechas.
create or replace function public.get_catalog_stock()
returns table(model text, category text, year smallint, daily_price numeric, total_units bigint, available_today bigint)
language sql stable security definer set search_path = public
as $$
  select v.model, v.category, max(v.year), min(v.daily_price), count(*)::bigint,
         count(*) filter (where not exists (
           select 1 from public.reservations r
           where r.vehicle_id = v.id
             and r.status in ('pending', 'confirmed', 'rented')
             and daterange(r.pickup_date, r.return_date, '[)') @> current_date
         ))::bigint
  from public.vehicles v
  where v.status = 'active'
  group by v.model, v.category
  order by v.category, v.model
$$;

create or replace function public.get_unavailable_dates(p_model text, p_from date, p_to date)
returns table(unavailable_date date)
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_from < current_date or p_to < p_from or p_to > p_from + 180 then
    raise exception 'Rango de fechas inválido';
  end if;
  return query
    select d::date
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
    where exists (select 1 from public.vehicles v where v.model = p_model and v.status = 'active')
      and not exists (
        select 1 from public.vehicles v
        where v.model = p_model and v.status = 'active'
          and not exists (
            select 1 from public.reservations r
            where r.vehicle_id = v.id and r.status in ('pending', 'confirmed', 'rented')
              and daterange(r.pickup_date, r.return_date, '[)') @> d::date
          )
      );
end $$;

-- Inserción atómica: serializa reservas del mismo modelo y deja que la restricción
-- de exclusión sea la última defensa contra duplicados/solicitudes concurrentes.
create or replace function public.create_reservation(
  p_model text, p_pickup_date date, p_return_date date,
  p_customer_name text, p_customer_email text, p_customer_phone text
)
returns table(reservation_id uuid, total_price numeric, vehicle_model text)
language plpgsql security definer set search_path = public
as $$
declare selected_vehicle public.vehicles%rowtype; new_id uuid;
begin
  if p_pickup_date < current_date or p_return_date <= p_pickup_date
     or p_return_date > p_pickup_date + 30 then
    raise exception 'Las fechas deben ser futuras y la renta debe durar entre 1 y 30 días';
  end if;
  if char_length(trim(p_customer_name)) not between 2 and 120
     or char_length(trim(p_customer_email)) not between 5 and 254
     or char_length(trim(p_customer_phone)) not between 7 and 25 then
    raise exception 'Revisa los datos de contacto';
  end if;

  perform pg_advisory_xact_lock(hashtext('driveflex:' || p_model));
  select v.* into selected_vehicle
  from public.vehicles v
  where v.model = p_model and v.status = 'active'
    and not exists (
      select 1 from public.reservations r
      where r.vehicle_id = v.id and r.status in ('pending', 'confirmed', 'rented')
        and daterange(r.pickup_date, r.return_date, '[)') && daterange(p_pickup_date, p_return_date, '[)')
    )
  order by v.id
  limit 1
  for update;

  if not found then raise exception 'No hay unidades disponibles para esas fechas. Actualiza el calendario e inténtalo de nuevo.'; end if;

  insert into public.reservations (
    vehicle_id, customer_name, customer_email, customer_phone,
    pickup_date, return_date, daily_price, total_price
  ) values (
    selected_vehicle.id, trim(p_customer_name), lower(trim(p_customer_email)), trim(p_customer_phone),
    p_pickup_date, p_return_date, selected_vehicle.daily_price,
    selected_vehicle.daily_price * (p_return_date - p_pickup_date)
  ) returning id into new_id;

  return query select new_id,
    selected_vehicle.daily_price * (p_return_date - p_pickup_date), selected_vehicle.model;
end $$;

create or replace function public.admin_update_reservation_status(p_reservation_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public
as $$
declare m text;
begin
  if not public.is_driveflex_admin() then raise exception 'No autorizado'; end if;
  if p_status not in ('pending', 'confirmed', 'rented', 'completed', 'cancelled') then
    raise exception 'Estado inválido';
  end if;
  select v.model into m from public.reservations r join public.vehicles v on v.id = r.vehicle_id
  where r.id = p_reservation_id;
  if m is null then raise exception 'Pedido no encontrado'; end if;
  perform pg_advisory_xact_lock(hashtext('driveflex:' || m));
  update public.reservations set status = p_status where id = p_reservation_id;
end $$;

create or replace function public.bump_inventory_version()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.inventory_version set version = version + 1, updated_at = now() where id = 1;
  return coalesce(new, old);
end $$;
drop trigger if exists reservations_inventory_changed on public.reservations;
create trigger reservations_inventory_changed after insert or update or delete on public.reservations
for each row execute function public.bump_inventory_version();
drop trigger if exists vehicles_inventory_changed on public.vehicles;
create trigger vehicles_inventory_changed after insert or update or delete on public.vehicles
for each row execute function public.bump_inventory_version();

alter table public.vehicles enable row level security;
alter table public.reservations enable row level security;
alter table public.admin_users enable row level security;
alter table public.inventory_version enable row level security;
drop policy if exists vehicles_admin_read on public.vehicles;
create policy vehicles_admin_read on public.vehicles for select to authenticated using (public.is_driveflex_admin());
drop policy if exists reservations_admin_read on public.reservations;
create policy reservations_admin_read on public.reservations for select to authenticated using (public.is_driveflex_admin());
drop policy if exists inventory_version_public_read on public.inventory_version;
create policy inventory_version_public_read on public.inventory_version for select to anon, authenticated using (true);

revoke all on public.vehicles, public.reservations, public.admin_users, public.inventory_version from anon, authenticated;
grant select on public.vehicles, public.reservations to authenticated;
grant select on public.inventory_version to anon, authenticated;
grant execute on function public.get_catalog_stock() to anon, authenticated;
grant execute on function public.get_unavailable_dates(text, date, date) to anon, authenticated;
grant execute on function public.create_reservation(text, date, date, text, text, text) to anon, authenticated;
grant execute on function public.admin_update_reservation_status(uuid, text) to authenticated;
grant execute on function public.is_driveflex_admin() to authenticated;

-- Datos iniciales de demostración: dos unidades por modelo. Cambia las unidades/precios
-- para reflejar tu flota real; unit_code es un identificador interno, no una placa.
insert into public.vehicles (model, category, year, daily_price, unit_code) values
 ('Nissan March', 'economico', 2022, 450, 'ECO-MAR-01'), ('Nissan March', 'economico', 2023, 450, 'ECO-MAR-02'),
 ('Chevrolet Aveo', 'economico', 2022, 480, 'ECO-AVE-01'), ('Chevrolet Aveo', 'economico', 2023, 480, 'ECO-AVE-02'),
 ('Toyota Camry', 'sedan', 2022, 850, 'SED-CAM-01'), ('Toyota Camry', 'sedan', 2023, 850, 'SED-CAM-02'),
 ('Mazda 6', 'sedan', 2022, 880, 'SED-MAZ-01'), ('Mazda 6', 'sedan', 2023, 880, 'SED-MAZ-02'),
 ('Mazda CX-5', 'suv', 2022, 1200, 'SUV-CX5-01'), ('Mazda CX-5', 'suv', 2023, 1200, 'SUV-CX5-02'),
 ('Chevrolet Suburban', 'suv', 2022, 1650, 'SUV-SUB-01'), ('Chevrolet Suburban', 'suv', 2023, 1650, 'SUV-SUB-02')
on conflict (unit_code) do nothing;

-- Realtime: la tabla no contiene pedidos ni datos personales, solo una versión pública.
do $$ begin
  alter publication supabase_realtime add table public.inventory_version;
exception when duplicate_object then null;
end $$;
-- El dashboard escucha cambios de pedidos; RLS limita los eventos a administradores.
do $$ begin
  alter publication supabase_realtime add table public.reservations;
exception when duplicate_object then null;
end $$;
