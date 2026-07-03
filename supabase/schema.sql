-- Catmunity Supabase schema
-- Public UI reads cat_public_map for one stable pin per cat. The map now uses
-- the original canonical coordinates, while later duplicate sightings keep their
-- own approximate coordinates in user_cats/cat_sightings.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do update set public = excluded.public;

create table if not exists public.cats (
  id uuid primary key default gen_random_uuid(),
  name text,
  colour text,
  breed text,
  weight text,
  fun_facts text,
  remarks text,
  original_image_url text,
  cropped_image_url text,
  created_by uuid references auth.users(id) on delete set null,
  canonical_latitude double precision not null,
  canonical_longitude double precision not null,
  approximate_latitude double precision not null,
  approximate_longitude double precision not null,
  location_name text,
  area_name text,
  city text,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_cats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cat_id uuid not null references public.cats(id) on delete cascade,
  discovered_at timestamptz not null default now(),
  user_given_name text,
  user_notes text,
  is_unlocked boolean not null default true,
  sighting_area_name text,
  approximate_sighting_latitude double precision,
  approximate_sighting_longitude double precision,
  unique (user_id, cat_id)
);

create table if not exists public.cat_sightings (
  id uuid primary key default gen_random_uuid(),
  cat_id uuid not null references public.cats(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  approximate_latitude double precision not null,
  approximate_longitude double precision not null,
  area_name text,
  discovered_at timestamptz not null default now(),
  photo_url text,
  remarks text
);

create or replace view public.cat_public_map as
select
  cats.id,
  cats.name,
  cats.colour,
  cats.breed,
  cats.fun_facts,
  cats.cropped_image_url,
  cats.canonical_latitude as latitude,
  cats.canonical_longitude as longitude,
  cats.approximate_latitude,
  cats.approximate_longitude,
  cats.location_name,
  cats.area_name,
  cats.city,
  cats.country,
  count(user_cats.id)::integer as sighting_count,
  cats.created_at,
  cats.updated_at
from public.cats
left join public.user_cats on user_cats.cat_id = cats.id
group by cats.id;

grant select on public.cat_public_map to anon, authenticated;

alter table public.cats enable row level security;
alter table public.user_cats enable row level security;
alter table public.cat_sightings enable row level security;

drop policy if exists "Public can read approximate cat map" on public.cats;
drop policy if exists "Creators and catchers can read exact cat records" on public.cats;
create policy "Creators and catchers can read exact cat records"
on public.cats for select
using (
  auth.uid() = created_by
  or exists (
    select 1
    from public.user_cats
    where user_cats.cat_id = cats.id
      and user_cats.user_id = auth.uid()
  )
);

drop policy if exists "Creators can insert cats" on public.cats;
create policy "Creators can insert cats"
on public.cats for insert
with check (auth.uid() = created_by);

drop policy if exists "Creators can update own cats" on public.cats;
create policy "Creators can update own cats"
on public.cats for update
using (auth.uid() = created_by)
with check (auth.uid() = created_by);

drop policy if exists "Users can read own cat links" on public.user_cats;
create policy "Users can read own cat links"
on public.user_cats for select
using (auth.uid() = user_id);

drop policy if exists "Users can link cats to themselves" on public.user_cats;
create policy "Users can link cats to themselves"
on public.user_cats for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can read own sightings" on public.cat_sightings;
create policy "Users can read own sightings"
on public.cat_sightings for select
using (auth.uid() = user_id);

drop policy if exists "Users can create approximate sightings" on public.cat_sightings;
create policy "Users can create approximate sightings"
on public.cat_sightings for insert
with check (auth.uid() = user_id);

create index if not exists cats_approximate_location_idx
  on public.cats (approximate_latitude, approximate_longitude);

create index if not exists user_cats_user_id_idx
  on public.user_cats (user_id);

create index if not exists cat_sightings_cat_id_idx
  on public.cat_sightings (cat_id);

drop policy if exists "Public can read profile photos" on storage.objects;
create policy "Public can read profile photos"
on storage.objects for select
using (bucket_id = 'profile-photos');

drop policy if exists "Users can upload own profile photos" on storage.objects;
create policy "Users can upload own profile photos"
on storage.objects for insert
with check (
  bucket_id = 'profile-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can update own profile photos" on storage.objects;
create policy "Users can update own profile photos"
on storage.objects for update
using (
  bucket_id = 'profile-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'profile-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can delete own profile photos" on storage.objects;
create policy "Users can delete own profile photos"
on storage.objects for delete
using (
  bucket_id = 'profile-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);
