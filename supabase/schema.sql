-- Catmunity Supabase schema
-- Public UI reads cat_public_map for one stable pin per cat. The map now uses
-- the original canonical coordinates, while later duplicate sightings keep their
-- own approximate coordinates in user_cats/cat_sightings.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('cat-photos', 'cat-photos', true)
on conflict (id) do update set public = excluded.public;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  display_name text not null,
  avatar_url text,
  bio text,
  public_profile boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
add column if not exists username text;

create table if not exists public.user_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists public.cats (
  id uuid primary key default gen_random_uuid(),
  name text,
  colour text,
  breed text,
  weight text,
  behavior text,
  gender text,
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
  discovery_method text,
  user_given_name text,
  user_notes text,
  colour text,
  breed text,
  weight text,
  behavior text,
  gender text,
  fun_facts text,
  remarks text,
  original_image_url text,
  cropped_image_url text,
  photo_urls text[] not null default '{}',
  is_unlocked boolean not null default false,
  sighting_area_name text,
  approximate_sighting_latitude double precision,
  approximate_sighting_longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, cat_id)
);

create table if not exists public.user_favorite_cats (
  user_id uuid not null references auth.users(id) on delete cascade,
  cat_id uuid not null references public.cats(id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, cat_id),
  unique (user_id, position),
  check (position >= 0 and position < 3)
);

grant select on public.user_favorite_cats to anon, authenticated;
grant insert, update, delete on public.user_favorite_cats to authenticated;

alter table public.cats
add column if not exists behavior text,
add column if not exists gender text;

alter table public.user_cats
add column if not exists discovery_method text,
add column if not exists colour text,
add column if not exists breed text,
add column if not exists weight text,
add column if not exists behavior text,
add column if not exists gender text,
add column if not exists fun_facts text,
add column if not exists remarks text,
add column if not exists original_image_url text,
add column if not exists cropped_image_url text,
add column if not exists photo_urls text[] not null default '{}',
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

alter table public.user_cats
alter column is_unlocked set default false;

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

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cat_id uuid references public.cats(id) on delete set null,
  caption text not null default '',
  image_url text,
  image_urls text[] not null default '{}',
  location_name text,
  mentions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.community_posts
add column if not exists image_urls text[] not null default '{}';

create table if not exists public.post_likes (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  image_urls text[] not null default '{}',
  mentions text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.comments
add column if not exists image_urls text[] not null default '{}';

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  type text not null,
  title text not null,
  body text,
  related_post_id uuid references public.community_posts(id) on delete cascade,
  related_cat_id uuid references public.cats(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.cat_streaks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_streak integer not null default 0 check (current_streak >= 0),
  best_streak integer not null default 0 check (best_streak >= 0),
  last_qualified_date date,
  last_qualified_cat_id uuid references public.cats(id) on delete set null,
  streak_started_on date,
  paw_passes_used_this_month integer not null default 0 check (paw_passes_used_this_month >= 0 and paw_passes_used_this_month <= 5),
  paw_pass_month date,
  updated_at timestamptz not null default now()
);

create table if not exists public.cat_streak_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cat_id uuid not null references public.cats(id) on delete cascade,
  sighting_id uuid not null references public.cat_sightings(id) on delete cascade,
  local_date date not null,
  timezone text not null default 'Asia/Kuala_Lumpur',
  event_type text not null default 'qualified',
  previous_streak integer not null default 0,
  streak_after integer not null,
  paw_passes_used integer not null default 0,
  created_at timestamptz not null default now(),
  unique (sighting_id),
  unique (user_id, local_date)
);

create or replace view public.cat_streak_public as
select
  cat_streaks.user_id,
  cat_streaks.current_streak,
  cat_streaks.best_streak,
  cat_streaks.last_qualified_date,
  cat_streaks.updated_at
from public.cat_streaks
join public.profiles on profiles.id = cat_streaks.user_id
where profiles.public_profile = true;

grant select on public.cat_streak_public to anon, authenticated;
grant select on public.cat_streaks to authenticated;
grant select on public.cat_streak_events to authenticated;

create or replace function public.process_cat_streak(
  p_sighting_id uuid,
  p_timezone text default 'Asia/Kuala_Lumpur'
)
returns table (
  advanced boolean,
  current_streak integer,
  best_streak integer,
  previous_streak integer,
  paw_passes_remaining integer,
  paw_passes_used integer,
  streak_broken boolean,
  local_date date,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_cat_id uuid;
  v_sighting_user_id uuid;
  v_discovered_at timestamptz;
  v_local_date date;
  v_month date;
  v_streak public.cat_streaks%rowtype;
  v_days_since integer;
  v_missing_days integer := 0;
  v_previous_streak integer := 0;
  v_current integer := 0;
  v_best integer := 0;
  v_used_month integer := 0;
  v_paw_used integer := 0;
  v_broken boolean := false;
  v_inserted_event_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select user_id, cat_id, discovered_at
  into v_sighting_user_id, v_cat_id, v_discovered_at
  from public.cat_sightings
  where id = p_sighting_id;

  if v_sighting_user_id is distinct from v_user_id then
    raise exception 'Sighting does not belong to current user';
  end if;

  v_local_date := (v_discovered_at at time zone coalesce(nullif(p_timezone, ''), 'Asia/Kuala_Lumpur'))::date;
  v_month := date_trunc('month', v_local_date)::date;

  insert into public.cat_streaks (user_id, paw_pass_month)
  values (v_user_id, v_month)
  on conflict (user_id) do nothing;

  select *
  into v_streak
  from public.cat_streaks
  where user_id = v_user_id
  for update;

  if v_streak.paw_pass_month is distinct from v_month then
    v_streak.paw_pass_month := v_month;
    v_streak.paw_passes_used_this_month := 0;
  end if;

  v_previous_streak := coalesce(v_streak.current_streak, 0);
  v_current := v_previous_streak;
  v_best := coalesce(v_streak.best_streak, 0);
  v_used_month := coalesce(v_streak.paw_passes_used_this_month, 0);

  if exists (
    select 1
    from public.cat_streak_events
    where user_id = v_user_id
      and local_date = v_local_date
  ) then
    update public.cat_streaks
    set paw_pass_month = v_month,
        paw_passes_used_this_month = v_used_month,
        updated_at = now()
    where user_id = v_user_id;

    return query select false, v_current, v_best, v_previous_streak, 5 - v_used_month, 0, false, v_local_date, 'already_counted_today';
    return;
  end if;

  if v_streak.last_qualified_cat_id is not null
    and v_streak.last_qualified_cat_id = v_cat_id
  then
    update public.cat_streaks
    set paw_pass_month = v_month,
        paw_passes_used_this_month = v_used_month,
        updated_at = now()
    where user_id = v_user_id;

    return query select false, v_current, v_best, v_previous_streak, 5 - v_used_month, 0, false, v_local_date, 'same_cat_as_previous_streak_day';
    return;
  end if;

  if v_streak.last_qualified_date is null or v_previous_streak = 0 then
    v_current := 1;
    v_broken := false;
    v_streak.streak_started_on := v_local_date;
  else
    v_days_since := v_local_date - v_streak.last_qualified_date;

    if v_days_since <= 0 then
      return query select false, v_current, v_best, v_previous_streak, 5 - v_used_month, 0, false, v_local_date, 'older_than_last_streak_day';
      return;
    elsif v_days_since = 1 then
      v_current := v_previous_streak + 1;
    else
      v_missing_days := v_days_since - 1;
      if v_missing_days <= (5 - v_used_month) then
        v_paw_used := v_missing_days;
        v_used_month := v_used_month + v_paw_used;
        v_current := v_previous_streak + 1;
      else
        v_broken := true;
        v_current := 1;
        v_streak.streak_started_on := v_local_date;
      end if;
    end if;
  end if;

  v_best := greatest(v_best, v_current);

  insert into public.cat_streak_events (
    user_id,
    cat_id,
    sighting_id,
    local_date,
    timezone,
    previous_streak,
    streak_after,
    paw_passes_used
  )
  values (
    v_user_id,
    v_cat_id,
    p_sighting_id,
    v_local_date,
    coalesce(nullif(p_timezone, ''), 'Asia/Kuala_Lumpur'),
    v_previous_streak,
    v_current,
    v_paw_used
  )
  on conflict (user_id, local_date) do nothing
  returning id into v_inserted_event_id;

  if v_inserted_event_id is null then
    return query select false, v_previous_streak, v_best, v_previous_streak, 5 - v_used_month, 0, false, v_local_date, 'already_counted_today';
    return;
  end if;

  update public.cat_streaks
  set current_streak = v_current,
      best_streak = v_best,
      last_qualified_date = v_local_date,
      last_qualified_cat_id = v_cat_id,
      streak_started_on = coalesce(v_streak.streak_started_on, v_local_date),
      paw_passes_used_this_month = v_used_month,
      paw_pass_month = v_month,
      updated_at = now()
  where user_id = v_user_id;

  return query select true, v_current, v_best, v_previous_streak, 5 - v_used_month, v_paw_used, v_broken, v_local_date, 'advanced';
end;
$$;

revoke all on function public.process_cat_streak(uuid, text) from public;
revoke all on function public.process_cat_streak(uuid, text) from anon;
grant execute on function public.process_cat_streak(uuid, text) to authenticated;

drop view if exists public.public_user_cat_map;
drop view if exists public.cat_public_map;

create or replace view public.cat_public_map as
select
  cats.id,
  cats.name,
  cats.colour,
  cats.breed,
  cats.weight,
  cats.behavior,
  cats.gender,
  cats.fun_facts,
  cats.remarks,
  cats.original_image_url,
  cats.cropped_image_url,
  cats.created_by,
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

create or replace view public.public_user_cat_map as
select
  user_cats.user_id as profile_user_id,
  user_cats.discovered_at,
  cats.id,
  coalesce(user_cats.user_given_name, cats.name) as name,
  coalesce(user_cats.colour, cats.colour) as colour,
  coalesce(user_cats.breed, cats.breed) as breed,
  coalesce(user_cats.weight, cats.weight) as weight,
  coalesce(user_cats.behavior, cats.behavior) as behavior,
  coalesce(user_cats.gender, cats.gender) as gender,
  coalesce(user_cats.fun_facts, cats.fun_facts) as fun_facts,
  coalesce(user_cats.remarks, user_cats.user_notes, cats.remarks) as remarks,
  coalesce(user_cats.original_image_url, cats.original_image_url) as original_image_url,
  coalesce(user_cats.cropped_image_url, cats.cropped_image_url) as cropped_image_url,
  cats.created_by,
  cats.canonical_latitude as latitude,
  cats.canonical_longitude as longitude,
  cats.approximate_latitude,
  cats.approximate_longitude,
  cats.location_name,
  cats.area_name,
  cats.city,
  cats.country,
  cats.created_at,
  cats.updated_at,
  user_cats.photo_urls,
  cats.original_image_url as canonical_original_image_url,
  cats.cropped_image_url as canonical_cropped_image_url
from public.user_cats
join public.cats on cats.id = user_cats.cat_id
join public.profiles on profiles.id = user_cats.user_id
where user_cats.is_unlocked = true
  and profiles.public_profile = true;

grant select on public.public_user_cat_map to anon, authenticated;

alter table public.cats enable row level security;
alter table public.profiles enable row level security;
alter table public.user_follows enable row level security;
alter table public.user_favorite_cats enable row level security;
alter table public.user_cats enable row level security;
alter table public.cat_sightings enable row level security;
alter table public.community_posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.comments enable row level security;
alter table public.notifications enable row level security;
alter table public.cat_streaks enable row level security;
alter table public.cat_streak_events enable row level security;

drop policy if exists "Users can read public profiles" on public.profiles;
create policy "Users can read public profiles"
on public.profiles for select
using (public_profile = true or auth.uid() = id);

drop policy if exists "Users can create own profile" on public.profiles;
create policy "Users can create own profile"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Users can read own follows" on public.user_follows;
drop policy if exists "Public can read follows" on public.user_follows;
create policy "Public can read follows"
on public.user_follows for select
using (true);

drop policy if exists "Users can follow profiles" on public.user_follows;
create policy "Users can follow profiles"
on public.user_follows for insert
with check (auth.uid() = follower_id);

drop policy if exists "Users can unfollow profiles" on public.user_follows;
create policy "Users can unfollow profiles"
on public.user_follows for delete
using (auth.uid() = follower_id);

drop policy if exists "Public can read favourite cats" on public.user_favorite_cats;
create policy "Public can read favourite cats"
on public.user_favorite_cats for select
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = user_favorite_cats.user_id
      and (profiles.public_profile = true or profiles.id = (select auth.uid()))
  )
);

drop policy if exists "Users can favourite own unlocked cats" on public.user_favorite_cats;
create policy "Users can favourite own unlocked cats"
on public.user_favorite_cats for insert
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.user_cats
    where user_cats.user_id = user_favorite_cats.user_id
      and user_cats.cat_id = user_favorite_cats.cat_id
      and user_cats.is_unlocked = true
  )
);

drop policy if exists "Users can update own favourite cats" on public.user_favorite_cats;
create policy "Users can update own favourite cats"
on public.user_favorite_cats for update
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.user_cats
    where user_cats.user_id = user_favorite_cats.user_id
      and user_cats.cat_id = user_favorite_cats.cat_id
      and user_cats.is_unlocked = true
  )
);

drop policy if exists "Users can remove own favourite cats" on public.user_favorite_cats;
create policy "Users can remove own favourite cats"
on public.user_favorite_cats for delete
using ((select auth.uid()) = user_id);

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
drop policy if exists "Unlocked users can update discovered cats" on public.cats;
create policy "Unlocked users can update discovered cats"
on public.cats for update
using (
  auth.uid() = created_by
  or exists (
    select 1
    from public.user_cats
    where user_cats.cat_id = cats.id
      and user_cats.user_id = auth.uid()
      and user_cats.is_unlocked = true
  )
)
with check (
  auth.uid() = created_by
  or exists (
    select 1
    from public.user_cats
    where user_cats.cat_id = cats.id
      and user_cats.user_id = auth.uid()
      and user_cats.is_unlocked = true
  )
);

drop policy if exists "Creators can delete own cats" on public.cats;
create policy "Creators can delete own cats"
on public.cats for delete
using (auth.uid() = created_by);

drop policy if exists "Users can read own cat links" on public.user_cats;
create policy "Users can read own cat links"
on public.user_cats for select
using (auth.uid() = user_id);

drop policy if exists "Users can link cats to themselves" on public.user_cats;
create policy "Users can link cats to themselves"
on public.user_cats for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own cat links" on public.user_cats;
create policy "Users can update own cat links"
on public.user_cats for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can remove own cat links" on public.user_cats;
create policy "Users can remove own cat links"
on public.user_cats for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read own sightings" on public.cat_sightings;
drop policy if exists "Anyone can read approximate sightings" on public.cat_sightings;
create policy "Anyone can read approximate sightings"
on public.cat_sightings for select
using (true);

drop policy if exists "Users can create approximate sightings" on public.cat_sightings;
create policy "Users can create approximate sightings"
on public.cat_sightings for insert
with check (auth.uid() = user_id);

drop policy if exists "Anyone can read community posts" on public.community_posts;
create policy "Anyone can read community posts"
on public.community_posts for select
using (true);

drop policy if exists "Users can create own community posts" on public.community_posts;
create policy "Users can create own community posts"
on public.community_posts for insert
with check (
  auth.uid() = user_id
  and (
    cat_id is null
    or exists (
      select 1
      from public.user_cats
      where user_cats.cat_id = community_posts.cat_id
        and user_cats.user_id = auth.uid()
        and user_cats.is_unlocked = true
    )
  )
);

drop policy if exists "Users can update own community posts" on public.community_posts;
create policy "Users can update own community posts"
on public.community_posts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own community posts" on public.community_posts;
create policy "Users can delete own community posts"
on public.community_posts for delete
using (auth.uid() = user_id);

drop policy if exists "Anyone can read post likes" on public.post_likes;
create policy "Anyone can read post likes"
on public.post_likes for select
using (true);

drop policy if exists "Users can like posts" on public.post_likes;
create policy "Users can like posts"
on public.post_likes for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can unlike posts" on public.post_likes;
create policy "Users can unlike posts"
on public.post_likes for delete
using (auth.uid() = user_id);

drop policy if exists "Anyone can read comments" on public.comments;
create policy "Anyone can read comments"
on public.comments for select
using (true);

drop policy if exists "Users can create comments" on public.comments;
create policy "Users can create comments"
on public.comments for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own comments" on public.comments;
create policy "Users can update own comments"
on public.comments for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own comments" on public.comments;
drop policy if exists "Users and post owners can delete comments" on public.comments;
create policy "Users and post owners can delete comments"
on public.comments for delete
using (
  (select auth.uid()) = user_id
  or exists (
    select 1
    from public.community_posts
    where community_posts.id = comments.post_id
      and community_posts.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can read own notifications" on public.notifications;
create policy "Users can read own notifications"
on public.notifications for select
using (auth.uid() = user_id);

drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications"
on public.notifications for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Authenticated users can create notifications" on public.notifications;
create policy "Authenticated users can create notifications"
on public.notifications for insert
with check (auth.uid() = actor_user_id);

drop policy if exists "Users can read own cat streak details" on public.cat_streaks;
create policy "Users can read own cat streak details"
on public.cat_streaks for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users can update own cat streak through RPC" on public.cat_streaks;
create policy "Users can update own cat streak through RPC"
on public.cat_streaks for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can create own cat streak through RPC" on public.cat_streaks;
create policy "Users can create own cat streak through RPC"
on public.cat_streaks for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read own cat streak events" on public.cat_streak_events;
create policy "Users can read own cat streak events"
on public.cat_streak_events for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create own cat streak events through RPC" on public.cat_streak_events;
create policy "Users can create own cat streak events through RPC"
on public.cat_streak_events for insert
with check ((select auth.uid()) = user_id);

create index if not exists cats_approximate_location_idx
  on public.cats (approximate_latitude, approximate_longitude);

create index if not exists profiles_display_name_idx
  on public.profiles (display_name);

create unique index if not exists profiles_username_unique_idx
  on public.profiles (lower(username))
  where username is not null;

create index if not exists profiles_username_idx
  on public.profiles (username);

create index if not exists user_follows_follower_id_idx
  on public.user_follows (follower_id);

create index if not exists user_follows_following_id_idx
  on public.user_follows (following_id);

create index if not exists user_favorite_cats_user_position_idx
  on public.user_favorite_cats (user_id, position);

create index if not exists user_cats_user_id_idx
  on public.user_cats (user_id);

create index if not exists cat_sightings_cat_id_idx
  on public.cat_sightings (cat_id);

create index if not exists community_posts_user_id_idx
  on public.community_posts (user_id);

create index if not exists community_posts_cat_id_idx
  on public.community_posts (cat_id);

create index if not exists post_likes_post_id_idx
  on public.post_likes (post_id);

create index if not exists comments_post_id_idx
  on public.comments (post_id);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, is_read, created_at desc);

create index if not exists cat_streak_events_user_date_idx
  on public.cat_streak_events (user_id, local_date desc);

drop policy if exists "Public can read profile photos" on storage.objects;
create policy "Public can read profile photos"
on storage.objects for select
using (bucket_id = 'profile-photos');

drop policy if exists "Public can read cat photos" on storage.objects;
create policy "Public can read cat photos"
on storage.objects for select
using (bucket_id = 'cat-photos');

drop policy if exists "Users can upload own profile photos" on storage.objects;
create policy "Users can upload own profile photos"
on storage.objects for insert
with check (
  bucket_id = 'profile-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can upload own cat photos" on storage.objects;
create policy "Users can upload own cat photos"
on storage.objects for insert
with check (
  bucket_id = 'cat-photos'
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

drop policy if exists "Users can update own cat photos" on storage.objects;
create policy "Users can update own cat photos"
on storage.objects for update
using (
  bucket_id = 'cat-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'cat-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can delete own profile photos" on storage.objects;
create policy "Users can delete own profile photos"
on storage.objects for delete
using (
  bucket_id = 'profile-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can delete own cat photos" on storage.objects;
create policy "Users can delete own cat photos"
on storage.objects for delete
using (
  bucket_id = 'cat-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);
