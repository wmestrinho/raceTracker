-- raceTracker Supabase schema plan
-- Generated for the v1.7.0 live-data MVP planning pass.
-- Apply only after reviewing RLS/data-api exposure in Supabase Studio.

create extension if not exists pgcrypto;

create table if not exists public.tracks (
  id text primary key,
  name text not null,
  short_name text,
  latitude numeric(10,7) not null,
  longitude numeric(10,7) not null,
  timezone text not null default 'America/New_York',
  priority text not null default 'normal',
  weather_provider text not null default 'Open-Meteo',
  weather_api text not null default 'https://api.open-meteo.com/v1/forecast',
  official_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_sources (
  id text primary key,
  name text not null,
  provider_type text not null,
  source_url text not null,
  track_id text references public.tracks(id) on delete set null,
  confidence text not null default 'candidate',
  ingestion_status text not null default 'candidate',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  source_id text references public.event_sources(id) on delete set null,
  track_id text not null references public.tracks(id) on delete restrict,
  name text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  date_label text,
  status text not null default 'source-needed',
  registration_status text not null default 'provider-needed',
  registration_url text,
  source_url text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_id)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete set null,
  name text not null,
  class_name text,
  transponder text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.karts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete set null,
  driver_id uuid references public.drivers(id) on delete set null,
  label text not null,
  chassis text,
  engine text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.mechanics (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text,
  email text,
  role text,
  created_at timestamptz not null default now()
);

create table if not exists public.registration_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  kart_id uuid references public.karts(id) on delete set null,
  source_id text references public.event_sources(id) on delete set null,
  source_row_id text,
  driver_name text not null,
  class_name text,
  kart_number text,
  status text not null default 'entered',
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workshop_tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  kart_id uuid references public.karts(id) on delete set null,
  mechanic_id uuid references public.mechanics(id) on delete set null,
  owner_name text,
  task text not null,
  due_at timestamptz,
  due_label text,
  priority text not null default 'warn',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text,
  name text not null,
  category text,
  quantity_on_hand integer not null default 0,
  reorder_level integer not null default 0,
  location text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.setup_notes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  track_id text references public.tracks(id) on delete set null,
  kart_id uuid references public.karts(id) on delete set null,
  driver_id uuid references public.drivers(id) on delete set null,
  session_label text,
  note text not null,
  weather_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.weather_snapshots (
  id uuid primary key default gen_random_uuid(),
  track_id text not null references public.tracks(id) on delete cascade,
  observed_at timestamptz not null,
  temperature_f numeric,
  apparent_temperature_f numeric,
  wind_mph numeric,
  wind_gust_mph numeric,
  precipitation_in numeric,
  weather_code integer,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (track_id, observed_at)
);

create table if not exists public.telemetry_exports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  kart_id uuid references public.karts(id) on delete set null,
  provider text not null,
  export_url text,
  summary jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_events_track_starts_at on public.events(track_id, starts_at);
create index if not exists idx_events_source_external on public.events(source_id, external_id);
create index if not exists idx_registration_entries_event_class on public.registration_entries(event_id, class_name);
create index if not exists idx_workshop_tasks_event_status on public.workshop_tasks(event_id, status);
create index if not exists idx_weather_snapshots_track_observed on public.weather_snapshots(track_id, observed_at desc);

alter table public.tracks enable row level security;
alter table public.event_sources enable row level security;
alter table public.events enable row level security;
alter table public.teams enable row level security;
alter table public.drivers enable row level security;
alter table public.karts enable row level security;
alter table public.mechanics enable row level security;
alter table public.registration_entries enable row level security;
alter table public.workshop_tasks enable row level security;
alter table public.inventory_items enable row level security;
alter table public.setup_notes enable row level security;
alter table public.weather_snapshots enable row level security;
alter table public.telemetry_exports enable row level security;

-- Public prototype read model: browser can read non-sensitive operational context.
-- Tighten this before storing private customer/driver contact data.
create policy if not exists "public read tracks" on public.tracks for select to anon using (true);
create policy if not exists "public read event sources" on public.event_sources for select to anon using (true);
create policy if not exists "public read events" on public.events for select to anon using (true);
create policy if not exists "public read weather snapshots" on public.weather_snapshots for select to anon using (true);

-- Authenticated/operator write model placeholder. Replace with tenant/team ownership
-- predicates before multi-client production use.
create policy if not exists "authenticated write tracks" on public.tracks for all to authenticated using (true) with check (true);
create policy if not exists "authenticated write event sources" on public.event_sources for all to authenticated using (true) with check (true);
create policy if not exists "authenticated write events" on public.events for all to authenticated using (true) with check (true);
create policy if not exists "authenticated write registrations" on public.registration_entries for all to authenticated using (true) with check (true);
create policy if not exists "authenticated write workshop" on public.workshop_tasks for all to authenticated using (true) with check (true);

-- Grants are required for the Data API in projects with explicit API grants.
grant select on table public.tracks, public.event_sources, public.events, public.weather_snapshots to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on schema public to anon, authenticated;

insert into public.tracks (id, name, short_name, latitude, longitude, timezone, priority, official_url, notes)
values
  ('new-castle-motorsports-park', 'New Castle Motorsports Park', 'New Castle, IN', 39.8496829, -85.4080572, 'America/Indiana/Indianapolis', 'primary', 'https://newcastlemotorsportspark.com/schedule', 'Default high-frequency track for raceTracker planning.'),
  ('trackhouse-motorplex', 'Trackhouse Motorplex', 'Mooresville, NC', 35.6408237, -80.7912472, 'America/New_York', 'primary', 'https://trackhousemotorplex.com/events/', 'Default high-frequency track for raceTracker planning.')
on conflict (id) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  timezone = excluded.timezone,
  priority = excluded.priority,
  official_url = excluded.official_url,
  notes = excluded.notes,
  updated_at = now();

insert into public.event_sources (id, name, provider_type, source_url, track_id, confidence, ingestion_status, notes)
values
  ('ncmp-official-schedule', 'NCMP Official Schedule', 'official-site', 'https://newcastlemotorsportspark.com/schedule', 'new-castle-motorsports-park', 'high', 'candidate', 'Official page exposes 2026 NCMP schedule PDF and KRA raceday schedule PDF.'),
  ('route66-raceselect', 'Route 66 Sprint Series Race Select', 'raceselect', 'https://raceselect.com/route66/2026', 'new-castle-motorsports-park', 'medium', 'candidate', 'Route 66 schedule links registration through Race Select.'),
  ('uspks-raceselect', 'USPKS Race Select', 'raceselect', 'https://raceselect.com/uspks/2026', null, 'medium', 'candidate', 'USPKS schedule links registration through Race Select; validate track/event match per round.'),
  ('trackhouse-official-events', 'Trackhouse Official Events', 'official-site', 'https://trackhousemotorplex.com/events/', 'trackhouse-motorplex', 'high', 'candidate', 'Official Trackhouse events page.'),
  ('trackhouse-motorsportreg', 'Trackhouse Motorplex MotorsportReg Venue', 'motorsportreg', 'https://www.motorsportreg.com/venues/trackhouse-motorplex-mooresville-nc', 'trackhouse-motorplex', 'high', 'candidate', 'MotorsportReg venue page exists for Trackhouse Motorplex.'),
  ('trackhouse-clubspeed', 'Trackhouse Clubspeed Booking/Timing', 'clubspeed', 'https://bookings.clubspeed.com/MM/MMMooresville', 'trackhouse-motorplex', 'medium', 'candidate', 'Trackhouse site links Clubspeed booking and timing pages; likely relevant for rentals/timing, not necessarily competitive registration.')
on conflict (id) do update set
  name = excluded.name,
  provider_type = excluded.provider_type,
  source_url = excluded.source_url,
  track_id = excluded.track_id,
  confidence = excluded.confidence,
  ingestion_status = excluded.ingestion_status,
  notes = excluded.notes,
  updated_at = now();

-- ── Auth + mechanic sign-off sheets (v1.17.0) ──────────────────────────────
-- Real per-user identity, replacing the client-side name-picker in main.js.
-- Login is Supabase Auth magic-link email, sent only via signInWithOtp with
-- shouldCreateUser:false — the allowlist is "an auth.users row already exists,"
-- created by hand in Supabase Studio (Authentication -> Add user) alongside a
-- matching profiles row. There is deliberately no insert/update policy here
-- for `authenticated`: provisioning is admin-side only.

create table if not exists public.entities (
  id text primary key,
  name text not null,
  short_name text not null
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  role text,
  clearance text not null, -- 'admin' | 'staff' today; intentionally no CHECK so
                            -- driver/parent accounts can be added later without
                            -- a migration.
  shift text,
  specialty text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pretech_mechanic_signoffs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  entity_id text not null references public.entities(id),
  kart text,
  notes text,
  items jsonb not null default '{}'::jsonb,
  complete boolean not null default false,
  signoff_date date not null,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- One sign-off per mechanic per BUSINESS per day, not one globally — a
  -- mechanic servicing both fleets in a day certifies each separately, the
  -- same "never blend the two businesses" boundary billing already enforces.
  -- This is also what lets the workshop crew table split cleanly by the
  -- active entity switcher instead of showing a stale cross-business status.
  unique (profile_id, entity_id, signoff_date)
);

create index if not exists idx_pretech_signoffs_date on public.pretech_mechanic_signoffs(signoff_date);

alter table public.entities enable row level security;
alter table public.profiles enable row level security;
alter table public.pretech_mechanic_signoffs enable row level security;

create or replace function public.current_user_is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and clearance = 'admin' and active
  );
$$;

create policy if not exists "public read entities" on public.entities
  for select to anon, authenticated using (true);

-- The full roster (name/role/clearance) is readable by any signed-in staff
-- member, same as today's openly-fetchable mechanics.json (actually a privacy
-- *improvement*, since that file is public even to logged-out visitors). This
-- is what lets the workshop crew table list mechanics who have NOT signed off
-- yet, not just the ones who have. What stays admin-only is signoff *history*
-- (see the pretech_mechanic_signoffs policies below), which is the actually
-- sensitive/audit-relevant data.
create policy if not exists "authenticated read profiles" on public.profiles
  for select to authenticated using (true);

create policy if not exists "select own, today, or admin signoffs" on public.pretech_mechanic_signoffs
  for select to authenticated using (
    profile_id = auth.uid()
    or signoff_date = current_date
    or public.current_user_is_admin()
  );
create policy if not exists "insert own signoff" on public.pretech_mechanic_signoffs
  for insert to authenticated with check (profile_id = auth.uid());
create policy if not exists "update own signoff" on public.pretech_mechanic_signoffs
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

grant select on table public.entities to anon;
grant select, insert, update on table public.profiles, public.pretech_mechanic_signoffs to authenticated;

insert into public.entities (id, name, short_name) values
  ('evolution-kart-school', 'Evolution Kart School', 'Evolution'),
  ('the-kart-depot', 'The Kart Depot', 'TKD')
on conflict (id) do update set
  name = excluded.name,
  short_name = excluded.short_name;
