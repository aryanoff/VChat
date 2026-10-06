-- ============================================================================
-- VCHAT PRODUCTION-GRADE USERNAME SYSTEM & IDENTITY MIGRATION
-- Migration: 20261006_vchat_username_identity.sql
-- Safe, idempotent incremental migration:
-- 1. Adds username identity columns to public.profiles
-- 2. Enforces case-insensitive uniqueness and validation constraints
-- 3. Backfills existing profiles with safe, unique usernames
-- 4. Creates reserved_usernames table and username_history reservation table
-- 5. Implements atomic 30-day cooldown username update RPC (update_user_username)
-- 6. Implements privacy-safe, search-ranked username discovery RPC (search_users_by_username)
-- 7. Implements public profile lookup RPC by username (get_public_profile_by_username)
-- 8. Upgrades handle_new_user() trigger to auto-assign unique usernames
-- 9. Safely removes obsolete lookup_user_by_mobile dependency
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Schema Extensions on public.profiles
-- ----------------------------------------------------------------------------
select public.vchat_add_column('profiles', 'username', 'text');
select public.vchat_add_column('profiles', 'username_changed_at', 'timestamptz');
select public.vchat_add_column('profiles', 'username_change_available_at', 'timestamptz');
select public.vchat_add_column('profiles', 'display_name', 'text');

-- Ensure display_name is populated from full_name or name if empty
update public.profiles
set display_name = coalesce(display_name, full_name, name, 'VChat User')
where display_name is null or trim(display_name) = '';

-- ----------------------------------------------------------------------------
-- 2. Reserved Usernames Table
-- ----------------------------------------------------------------------------
create table if not exists public.reserved_usernames (
  username text primary key
);

insert into public.reserved_usernames (username) values
  ('admin'),
  ('administrator'),
  ('support'),
  ('help'),
  ('security'),
  ('system'),
  ('official'),
  ('staff'),
  ('moderator'),
  ('mod'),
  ('vchat'),
  ('vchatadmin'),
  ('vchatsupport'),
  ('root'),
  ('owner'),
  ('billing'),
  ('contact'),
  ('abuse'),
  ('privacy'),
  ('terms'),
  ('api'),
  ('developer'),
  ('bot'),
  ('guest'),
  ('null'),
  ('undefined')
on conflict (username) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Username History Table (30-day anti-takeover reservation)
-- ----------------------------------------------------------------------------
create table if not exists public.username_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  old_username text not null,
  released_at timestamptz not null default now(),
  reserved_until timestamptz not null default (now() + interval '30 days')
);

create index if not exists username_history_old_username_idx 
  on public.username_history (lower(old_username));

create index if not exists username_history_user_id_idx 
  on public.username_history (user_id);

alter table public.username_history enable row level security;

-- Only authenticated users can view history, or manage via security definer RPC
create policy username_history_select_own on public.username_history
  for select to authenticated using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 4. Existing User Username Backfill
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  v_base text;
  v_candidate text;
  v_num int;
begin
  for r in
    select id, coalesce(display_name, full_name, name, 'user') as raw_name, email
    from public.profiles
    where username is null or trim(username) = ''
    order by updated_at asc nulls last
  loop
    -- Build base candidate from letters and numbers only
    v_base := lower(regexp_replace(r.raw_name, '[^a-zA-Z0-9]', '', 'g'));
    if length(v_base) < 3 then
      v_base := lower(regexp_replace(split_part(coalesce(r.email, 'user'), '@', 1), '[^a-zA-Z0-9]', '', 'g'));
    end if;
    if length(v_base) < 3 then
      v_base := 'vchat_user';
    end if;
    if length(v_base) > 14 then
      v_base := substr(v_base, 1, 14);
    end if;

    -- Avoid reserved usernames
    if exists (select 1 from public.reserved_usernames where username = v_base) then
      v_base := v_base || '_user';
    end if;

    v_candidate := v_base;
    v_num := 1000 + floor(random() * 9000)::int;

    -- Check collision against already assigned usernames
    while exists (
      select 1 from public.profiles
      where lower(username) = lower(v_candidate) and id <> r.id
    ) loop
      v_candidate := substr(v_base, 1, 13) || '_' || v_num::text;
      v_num := v_num + 1;
    end loop;

    -- Update profile with unique backfilled username
    update public.profiles
    set
      username = lower(v_candidate),
      username_changed_at = now(),
      username_change_available_at = now() -- allow backfilled users to choose their own immediately
    where id = r.id;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Canonical Lowercase Normalization & Unique Index
-- ----------------------------------------------------------------------------
update public.profiles
set username = lower(btrim(username))
where username is not null;

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username))
  where username is not null;

-- Text search / prefix index for fast discovery
create index if not exists profiles_username_prefix_idx
  on public.profiles (lower(username) text_pattern_ops);

create index if not exists profiles_display_name_prefix_idx
  on public.profiles (lower(display_name) text_pattern_ops);

-- ----------------------------------------------------------------------------
-- 6. Helper: Validate Username Format
-- ----------------------------------------------------------------------------
create or replace function public.vchat_validate_username(p_username text)
returns text
language plpgsql
immutable
as $$
declare
  u text;
begin
  u := lower(trim(coalesce(p_username, '')));
  if left(u, 1) = '@' then
    u := substr(u, 2);
  end if;

  if length(u) < 3 then
    return 'Username must be at least 3 characters.';
  end if;
  if length(u) > 20 then
    return 'Username cannot exceed 20 characters.';
  end if;
  if left(u, 1) = '.' or right(u, 1) = '.' then
    return 'Username cannot start or end with a period.';
  end if;
  if left(u, 1) = '_' or right(u, 1) = '_' then
    return 'Username cannot start or end with an underscore.';
  end if;
  if u like '%..%' then
    return 'Username cannot contain consecutive periods.';
  end if;
  if u !~ '^[a-z0-9_.]+$' then
    return 'Username can only contain lowercase letters, numbers, underscores, and periods.';
  end if;
  if u !~ '[a-z]' then
    return 'Username must contain at least one letter.';
  end if;

  return null; -- valid
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. RPC: Check Username Availability (Fast pre-check)
-- ----------------------------------------------------------------------------
create or replace function public.check_username_available(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleaned text;
  v_err text;
begin
  v_cleaned := lower(trim(coalesce(p_username, '')));
  if left(v_cleaned, 1) = '@' then
    v_cleaned := substr(v_cleaned, 2);
  end if;

  v_err := public.vchat_validate_username(v_cleaned);
  if v_err is not null then
    return jsonb_build_object('available', false, 'error', v_err, 'code', 'INVALID');
  end if;

  -- Check reserved
  if exists (select 1 from public.reserved_usernames where username = v_cleaned) then
    return jsonb_build_object('available', false, 'error', 'This username is reserved.', 'code', 'RESERVED');
  end if;

  -- Check current owner
  if auth.uid() is not null and exists (
    select 1 from public.profiles where id = auth.uid() and lower(username) = v_cleaned
  ) then
    return jsonb_build_object('available', true, 'is_current', true, 'code', 'CURRENT');
  end if;

  -- Check taken in profiles
  if exists (select 1 from public.profiles where lower(username) = v_cleaned) then
    return jsonb_build_object('available', false, 'error', 'That username is already taken.', 'code', 'TAKEN');
  end if;

  -- Check 30-day reservation in username_history
  if exists (
    select 1 from public.username_history
    where lower(old_username) = v_cleaned
      and reserved_until > now()
      and user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    return jsonb_build_object('available', false, 'error', 'This username was recently released and is temporarily reserved.', 'code', 'RESERVED_HISTORY');
  end if;

  return jsonb_build_object('available', true, 'username', v_cleaned, 'code', 'OK');
end;
$$;

grant execute on function public.check_username_available(text) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 8. RPC: Atomic Username Update with 30-day Cooldown Enforcement
-- ----------------------------------------------------------------------------
create or replace function public.update_user_username(p_new_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_cleaned text;
  v_validation_err text;
  v_current_username text;
  v_change_available_at timestamptz;
  v_next_available_at timestamptz;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  v_cleaned := lower(trim(coalesce(p_new_username, '')));
  if left(v_cleaned, 1) = '@' then
    v_cleaned := substr(v_cleaned, 2);
  end if;

  -- Validate format
  v_validation_err := public.vchat_validate_username(v_cleaned);
  if v_validation_err is not null then
    return jsonb_build_object('success', false, 'error', v_validation_err, 'code', 'INVALID');
  end if;

  -- Check reserved
  if exists (select 1 from public.reserved_usernames where username = v_cleaned) then
    return jsonb_build_object('success', false, 'error', 'This username is reserved and cannot be claimed.', 'code', 'RESERVED');
  end if;

  -- Fetch current profile state
  select username, username_change_available_at
  into v_current_username, v_change_available_at
  from public.profiles
  where id = v_user_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Profile not found.', 'code', 'NOT_FOUND');
  end if;

  -- If identical, no change needed
  if v_current_username is not null and lower(v_current_username) = v_cleaned then
    return jsonb_build_object('success', true, 'username', v_cleaned, 'unchanged', true);
  end if;

  -- 30-Day Cooldown Enforcement
  if v_change_available_at is not null and now() < v_change_available_at then
    return jsonb_build_object(
      'success', false,
      'error', 'You can change your username again on ' || to_char(v_change_available_at, 'FMMonth FMDD, YYYY') || '.',
      'code', 'COOLDOWN_ACTIVE',
      'available_at', v_change_available_at
    );
  end if;

  -- Check if username is taken in profiles
  if exists (
    select 1 from public.profiles
    where lower(username) = v_cleaned and id <> v_user_id
  ) then
    return jsonb_build_object('success', false, 'error', 'That username is already taken.', 'code', 'TAKEN');
  end if;

  -- Check if username is reserved in history by another user
  if exists (
    select 1 from public.username_history
    where lower(old_username) = v_cleaned
      and reserved_until > now()
      and user_id <> v_user_id
  ) then
    return jsonb_build_object('success', false, 'error', 'This username was recently released and is temporarily reserved.', 'code', 'RESERVED_HISTORY');
  end if;

  -- Record old username in history if it existed
  if v_current_username is not null and trim(v_current_username) <> '' then
    insert into public.username_history (user_id, old_username, released_at, reserved_until)
    values (v_user_id, lower(v_current_username), now(), now() + interval '30 days');
  end if;

  -- Apply 30-day cooldown for next change
  v_next_available_at := now() + interval '30 days';

  update public.profiles
  set
    username = v_cleaned,
    username_changed_at = now(),
    username_change_available_at = v_next_available_at,
    updated_at = now()
  where id = v_user_id;

  return jsonb_build_object(
    'success', true,
    'username', v_cleaned,
    'username_changed_at', now(),
    'username_change_available_at', v_next_available_at
  );
end;
$$;

grant execute on function public.update_user_username(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. RPC: Privacy-Safe Ranked Username Search
-- Only returns safe public fields: id, username, display_name, avatar_url, about
-- Excludes caller and blocked contacts
-- ----------------------------------------------------------------------------
create or replace function public.search_users_by_username(p_query text, p_limit int default 15)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  about text,
  match_rank int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
  v_clean_query text;
  v_limit int;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  v_clean_query := lower(trim(coalesce(p_query, '')));
  if left(v_clean_query, 1) = '@' then
    v_clean_query := substr(v_clean_query, 2);
  end if;

  if length(v_clean_query) < 2 then
    return;
  end if;

  v_limit := least(greatest(coalesce(p_limit, 15), 1), 30);

  return query
  select
    p.id,
    p.username,
    coalesce(p.display_name, p.full_name, p.name, 'VChat User') as display_name,
    p.avatar_url,
    coalesce(p.about, p.bio, 'Available on VChat') as about,
    case
      -- Exact username match gets highest priority (1)
      when lower(p.username) = v_clean_query then 1
      -- Username prefix match gets second priority (2)
      when lower(p.username) like v_clean_query || '%' then 2
      -- Display name prefix match gets third priority (3)
      when lower(coalesce(p.display_name, p.full_name, '')) like v_clean_query || '%' then 3
      -- Anywhere substring match gets fourth priority (4)
      else 4
    end as match_rank
  from public.profiles p
  where p.id <> v_caller
    and p.username is not null
    and (
      lower(p.username) like '%' || v_clean_query || '%'
      or lower(coalesce(p.display_name, p.full_name, '')) like '%' || v_clean_query || '%'
    )
    and not public.vchat_is_blocked(v_caller, p.id)
    and not public.vchat_is_blocked(p.id, v_caller)
  order by
    match_rank asc,
    p.username asc
  limit v_limit;
end;
$$;

grant execute on function public.search_users_by_username(text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. RPC: Public Profile Lookup by Username (Safe projection)
-- ----------------------------------------------------------------------------
create or replace function public.get_public_profile_by_username(p_username text)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  about text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleaned text;
begin
  v_cleaned := lower(trim(coalesce(p_username, '')));
  if left(v_cleaned, 1) = '@' then
    v_cleaned := substr(v_cleaned, 2);
  end if;

  return query
  select
    p.id,
    p.username,
    coalesce(p.display_name, p.full_name, p.name, 'VChat User') as display_name,
    p.avatar_url,
    coalesce(p.about, p.bio, 'Available on VChat') as about
  from public.profiles p
  where lower(p.username) = v_cleaned
  limit 1;
end;
$$;

grant execute on function public.get_public_profile_by_username(text) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 11. Upgrade Auth Trigger: Handle New Users with Automatic Unique Username
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_mobile text;
  v_base_username text;
  v_username text;
  v_num int;
begin
  v_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(coalesce(new.email, 'user'), '@', 1)
  );

  v_mobile := regexp_replace(
    coalesce(new.raw_user_meta_data->>'mobile', new.raw_user_meta_data->>'phone', ''),
    '\D',
    '',
    'g'
  );
  if length(v_mobile) = 12 and left(v_mobile, 2) = '91' then
    v_mobile := substr(v_mobile, 3);
  end if;
  if length(v_mobile) <> 10 then
    v_mobile := null;
  end if;

  -- Generate candidate username from raw name or email prefix
  v_base_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', v_name), '[^a-zA-Z0-9_]', '', 'g'));
  if length(v_base_username) < 3 then
    v_base_username := lower(regexp_replace(split_part(coalesce(new.email, 'user'), '@', 1), '[^a-zA-Z0-9_]', '', 'g'));
  end if;
  if length(v_base_username) < 3 then
    v_base_username := 'vchat_' || substr(md5(new.id::text), 1, 4);
  end if;
  if length(v_base_username) > 14 then
    v_base_username := substr(v_base_username, 1, 14);
  end if;

  -- Avoid reserved names
  if exists (select 1 from public.reserved_usernames where username = v_base_username) then
    v_base_username := v_base_username || '_user';
  end if;

  v_username := v_base_username;
  v_num := 1000 + floor(random() * 9000)::int;

  -- Guarantee collision-free assignment
  while exists (select 1 from public.profiles where lower(username) = lower(v_username)) loop
    v_username := substr(v_base_username, 1, 13) || '_' || v_num::text;
    v_num := v_num + 1;
  end loop;

  insert into public.profiles (
    id, full_name, display_name, name, username, mobile, phone, email, avatar_url, about,
    email_verified, username_changed_at, username_change_available_at
  )
  values (
    new.id,
    v_name,
    v_name,
    v_name,
    v_username,
    v_mobile,
    v_mobile,
    new.email,
    new.raw_user_meta_data->>'avatar_url',
    'Hey there! I am using VChat.',
    coalesce((new.email_confirmed_at is not null), false),
    now(),
    now() -- let new user customize username immediately
  )
  on conflict (id) do update
    set
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      display_name = coalesce(public.profiles.display_name, excluded.display_name),
      email = coalesce(public.profiles.email, excluded.email),
      mobile = coalesce(public.profiles.mobile, excluded.mobile),
      avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
      username = coalesce(public.profiles.username, excluded.username);

  begin
    insert into public.user_settings (user_id)
    values (new.id)
    on conflict do nothing;
  exception when others then
    begin
      insert into public.user_settings (id)
      values (new.id)
      on conflict do nothing;
    exception when others then
      null;
    end;
  end;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 12. Safely Deprecate / Drop Obsolete lookup_user_by_mobile
-- ----------------------------------------------------------------------------
drop function if exists public.lookup_user_by_mobile(text);

-- Comment confirming successful completion
comment on table public.profiles is 'VChat user profiles with canonical unique lowercase username and display name';
