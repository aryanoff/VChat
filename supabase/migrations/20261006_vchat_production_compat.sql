-- VChat production compatibility layer (IDEMPOTENT)
-- Safe for an existing Step 2 schema: does not DROP tables or wipe data.
-- Run in Supabase SQL Editor after reviewing.
--
-- This file:
-- 1. Adds missing columns used by the app
-- 2. Creates profile + settings trigger
-- 3. Tightens RLS
-- 4. Adds privacy-safe RPCs
-- 5. Prepares storage buckets and realtime

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.vchat_add_column(p_table text, p_column text, p_type text)
returns void
language plpgsql
as $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = p_table
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = p_column
  ) then
    execute format('alter table public.%I add column %I %s', p_table, p_column, p_type);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Compatibility columns (no-ops if already present)
-- ---------------------------------------------------------------------------
select public.vchat_add_column('profiles', 'full_name', 'text');
select public.vchat_add_column('profiles', 'display_name', 'text');
select public.vchat_add_column('profiles', 'name', 'text');
select public.vchat_add_column('profiles', 'about', 'text');
select public.vchat_add_column('profiles', 'bio', 'text');
select public.vchat_add_column('profiles', 'mobile', 'text');
select public.vchat_add_column('profiles', 'phone', 'text');
select public.vchat_add_column('profiles', 'email', 'text');
select public.vchat_add_column('profiles', 'avatar_url', 'text');
select public.vchat_add_column('profiles', 'last_seen_at', 'timestamptz');
select public.vchat_add_column('profiles', 'mobile_verified', 'boolean default false');
select public.vchat_add_column('profiles', 'mobile_verified_at', 'timestamptz');
select public.vchat_add_column('profiles', 'email_verified', 'boolean default false');
select public.vchat_add_column('profiles', 'email_verified_at', 'timestamptz');
select public.vchat_add_column('profiles', 'updated_at', 'timestamptz default now()');

select public.vchat_add_column('user_settings', 'user_id', 'uuid');
select public.vchat_add_column('user_settings', 'notifications_enabled', 'boolean default true');
select public.vchat_add_column('user_settings', 'theme', 'text');
select public.vchat_add_column('user_settings', 'updated_at', 'timestamptz default now()');

select public.vchat_add_column('conversations', 'is_group', 'boolean default false');
select public.vchat_add_column('conversations', 'type', 'text');
select public.vchat_add_column('conversations', 'title', 'text');
select public.vchat_add_column('conversations', 'created_by', 'uuid');
select public.vchat_add_column('conversations', 'direct_key', 'text');
select public.vchat_add_column('conversations', 'last_message_at', 'timestamptz');
select public.vchat_add_column('conversations', 'last_message_preview', 'text');
select public.vchat_add_column('conversations', 'updated_at', 'timestamptz default now()');

select public.vchat_add_column('conversation_members', 'role', 'text default ''member''');
select public.vchat_add_column('conversation_members', 'joined_at', 'timestamptz default now()');
select public.vchat_add_column('conversation_members', 'last_read_at', 'timestamptz');
select public.vchat_add_column('conversation_members', 'muted', 'boolean default false');

select public.vchat_add_column('messages', 'message_type', 'text default ''text''');
select public.vchat_add_column('messages', 'content', 'text');
select public.vchat_add_column('messages', 'client_id', 'text');
select public.vchat_add_column('messages', 'edited_at', 'timestamptz');
select public.vchat_add_column('messages', 'deleted_at', 'timestamptz');
select public.vchat_add_column('messages', 'updated_at', 'timestamptz');

select public.vchat_add_column('attachments', 'storage_path', 'text');
select public.vchat_add_column('attachments', 'filename', 'text');
select public.vchat_add_column('attachments', 'mime_type', 'text');
select public.vchat_add_column('attachments', 'size_bytes', 'bigint');
select public.vchat_add_column('attachments', 'conversation_id', 'uuid');

select public.vchat_add_column('notifications', 'type', 'text');
select public.vchat_add_column('notifications', 'title', 'text');
select public.vchat_add_column('notifications', 'body', 'text');
select public.vchat_add_column('notifications', 'read_at', 'timestamptz');
select public.vchat_add_column('notifications', 'data', 'jsonb');

select public.vchat_add_column('message_reads', 'user_id', 'uuid');
select public.vchat_add_column('message_reads', 'read_at', 'timestamptz default now()');
select public.vchat_add_column('blocked_users', 'blocker_id', 'uuid');
select public.vchat_add_column('blocked_users', 'blocked_id', 'uuid');

select public.vchat_add_column('contact_submissions', 'full_name', 'text');
select public.vchat_add_column('contact_submissions', 'name', 'text');
select public.vchat_add_column('contact_submissions', 'email', 'text');
select public.vchat_add_column('contact_submissions', 'mobile', 'text');
select public.vchat_add_column('contact_submissions', 'topic', 'text');
select public.vchat_add_column('contact_submissions', 'message', 'text');
select public.vchat_add_column('contact_submissions', 'user_id', 'uuid');

-- OTP challenges (hash stored, not plaintext)
create table if not exists public.mobile_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mobile text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.app_runtime_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.app_runtime_config(key, value)
values ('dev_mobile_otp', 'true')
on conflict (key) do nothing;

create unique index if not exists profiles_mobile_unique
  on public.profiles (mobile)
  where mobile is not null and length(btrim(mobile)) = 10;

create unique index if not exists conversations_direct_key_unique
  on public.conversations (direct_key)
  where direct_key is not null;

create unique index if not exists conversation_members_unique
  on public.conversation_members (conversation_id, user_id);

create unique index if not exists message_reads_unique
  on public.message_reads (message_id, user_id);

create unique index if not exists blocked_users_unique
  on public.blocked_users (blocker_id, blocked_id);

-- ---------------------------------------------------------------------------
-- Profile helper
-- ---------------------------------------------------------------------------
create or replace function public.vchat_profile_name(p public.profiles)
returns text
language sql
immutable
as $$
  select coalesce(nullif(p.full_name, ''), nullif(p.display_name, ''), nullif(p.name, ''), 'VChat User');
$$;

create or replace function public.vchat_is_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.vchat_is_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocked_users
    where (blocker_id = p_a and blocked_id = p_b)
       or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

-- ---------------------------------------------------------------------------
-- Auth trigger: profiles + user_settings
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_mobile text;
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

  insert into public.profiles (id, full_name, display_name, name, mobile, phone, email, avatar_url, about, email_verified)
  values (
    new.id,
    v_name,
    v_name,
    v_name,
    v_mobile,
    v_mobile,
    new.email,
    new.raw_user_meta_data->>'avatar_url',
    'Hey there! I am using VChat.',
    coalesce((new.email_confirmed_at is not null), false)
  )
  on conflict (id) do update
    set
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      email = coalesce(public.profiles.email, excluded.email),
      mobile = coalesce(public.profiles.mobile, excluded.mobile),
      avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;
alter table public.attachments enable row level security;
alter table public.blocked_users enable row level security;
alter table public.notifications enable row level security;
alter table public.contact_submissions enable row level security;
alter table public.mobile_otp_challenges enable row level security;
alter table public.app_runtime_config enable row level security;

-- Drop known overly-broad policies if present (names from common templates)
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles','user_settings','conversations','conversation_members','messages',
        'message_reads','attachments','blocked_users','notifications','contact_submissions',
        'mobile_otp_challenges','app_runtime_config'
      )
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles: users may read/update only their own row (directory search is RPC)
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = auth.uid());

create policy settings_all_own on public.user_settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy conversations_select_member on public.conversations
  for select to authenticated
  using (public.vchat_is_member(id));
create policy conversations_update_member on public.conversations
  for update to authenticated
  using (public.vchat_is_member(id))
  with check (public.vchat_is_member(id));
create policy conversations_insert_auth on public.conversations
  for insert to authenticated
  with check (created_by = auth.uid() or created_by is null);

create policy members_select_own_convos on public.conversation_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.vchat_is_member(conversation_id)
  );
create policy members_insert_self on public.conversation_members
  for insert to authenticated
  with check (user_id = auth.uid() or public.vchat_is_member(conversation_id));
create policy members_update_self on public.conversation_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy messages_select_member on public.messages
  for select to authenticated
  using (public.vchat_is_member(conversation_id) and deleted_at is null);
create policy messages_insert_self on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.vchat_is_member(conversation_id)
  );
create policy messages_update_self on public.messages
  for update to authenticated
  using (sender_id = auth.uid() and public.vchat_is_member(conversation_id))
  with check (sender_id = auth.uid() and public.vchat_is_member(conversation_id));

create policy reads_select_member on public.message_reads
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.messages m
      where m.id = message_id and public.vchat_is_member(m.conversation_id)
    )
  );
create policy reads_insert_self on public.message_reads
  for insert to authenticated
  with check (user_id = auth.uid());
create policy reads_update_self on public.message_reads
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy attachments_select_member on public.attachments
  for select to authenticated
  using (
    public.vchat_is_member(conversation_id)
    or exists (
      select 1 from public.messages m
      where m.id = message_id and public.vchat_is_member(m.conversation_id)
    )
  );
create policy attachments_insert_member on public.attachments
  for insert to authenticated
  with check (
    public.vchat_is_member(conversation_id)
    or exists (
      select 1 from public.messages m
      where m.id = message_id and m.sender_id = auth.uid()
    )
  );

create policy blocked_select_own on public.blocked_users
  for select to authenticated using (blocker_id = auth.uid() or blocked_id = auth.uid());
create policy blocked_insert_own on public.blocked_users
  for insert to authenticated with check (blocker_id = auth.uid() and blocked_id <> auth.uid());
create policy blocked_delete_own on public.blocked_users
  for delete to authenticated using (blocker_id = auth.uid());

create policy notifications_own on public.notifications
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy contact_insert_anyone on public.contact_submissions
  for insert to anon, authenticated
  with check (true);
create policy contact_select_none on public.contact_submissions
  for select to authenticated
  using (false);

create policy otp_own on public.mobile_otp_challenges
  for select to authenticated using (user_id = auth.uid());

-- app_runtime_config: no client access
create policy runtime_config_no_select on public.app_runtime_config
  for select to authenticated using (false);

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.lookup_user_by_mobile(p_mobile text)
returns table (
  id uuid,
  display_name text,
  about text,
  avatar_url text,
  mobile text,
  last_seen_at timestamptz,
  mobile_verified boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mobile text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_mobile := regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g');
  if length(v_mobile) = 12 and left(v_mobile, 2) = '91' then
    v_mobile := substr(v_mobile, 3);
  end if;
  if length(v_mobile) <> 10 then
    return;
  end if;

  return query
  select
    p.id,
    public.vchat_profile_name(p),
    coalesce(p.about, p.bio),
    p.avatar_url,
    p.mobile,
    p.last_seen_at,
    coalesce(p.mobile_verified, p.mobile_verified_at is not null)
  from public.profiles p
  where (p.mobile = v_mobile or p.phone = v_mobile)
    and p.id <> auth.uid()
    and not public.vchat_is_blocked(auth.uid(), p.id)
  limit 1;
end;
$$;

create or replace function public.get_or_create_direct_conversation(p_other_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_key text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_other_id is null or p_other_id = v_me then
    raise exception 'Invalid user';
  end if;
  if public.vchat_is_blocked(v_me, p_other_id) then
    raise exception 'You cannot start a chat with this user';
  end if;
  if not exists (select 1 from public.profiles where id = p_other_id) then
    raise exception 'User not found';
  end if;

  v_key := least(v_me::text, p_other_id::text) || ':' || greatest(v_me::text, p_other_id::text);
  perform pg_advisory_xact_lock(hashtext(v_key));

  select c.id into v_id
  from public.conversations c
  where c.direct_key = v_key
  limit 1;

  if v_id is null then
    select c.id into v_id
    from public.conversations c
    where coalesce(c.is_group, false) = false
      and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = v_me)
      and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = p_other_id)
      and (select count(*) from public.conversation_members m where m.conversation_id = c.id) = 2
    limit 1;
  end if;

  if v_id is null then
    insert into public.conversations (is_group, type, created_by, direct_key, last_message_at)
    values (false, 'direct', v_me, v_key, now())
    returning id into v_id;

    insert into public.conversation_members (conversation_id, user_id)
    values (v_id, v_me), (v_id, p_other_id)
    on conflict do nothing;
  else
    update public.conversations set direct_key = coalesce(direct_key, v_key) where id = v_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.list_my_conversations()
returns table (
  conversation_id uuid,
  is_group boolean,
  title text,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count bigint,
  peer_id uuid,
  peer_name text,
  peer_about text,
  peer_avatar text,
  peer_last_seen timestamptz,
  muted boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select distinct on (c.id)
    c.id,
    coalesce(c.is_group, false),
    c.title,
    c.last_message_at,
    c.last_message_preview,
    (
      select count(*)
      from public.messages m
      where m.conversation_id = c.id
        and m.deleted_at is null
        and m.sender_id <> auth.uid()
        and m.created_at > coalesce(cm.last_read_at, 'epoch'::timestamptz)
    ) as unread_count,
    p.id,
    public.vchat_profile_name(p),
    coalesce(p.about, p.bio),
    p.avatar_url,
    p.last_seen_at,
    coalesce(cm.muted, false)
  from public.conversation_members cm
  join public.conversations c on c.id = cm.conversation_id
  left join public.conversation_members other
    on other.conversation_id = c.id and other.user_id <> auth.uid()
  left join public.profiles p on p.id = other.user_id
  where cm.user_id = auth.uid()
  order by c.id, coalesce(c.last_message_at, c.updated_at, c.created_at) desc nulls last;
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.vchat_is_member(p_conversation_id) then
    raise exception 'Not a member';
  end if;

  update public.conversation_members
  set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid();

  insert into public.message_reads (message_id, user_id, read_at)
  select m.id, auth.uid(), now()
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.sender_id <> auth.uid()
    and m.deleted_at is null
  on conflict (message_id, user_id) do update set read_at = excluded.read_at;
end;
$$;

create or replace function public.send_chat_message(
  p_conversation_id uuid,
  p_content text,
  p_message_type text default 'text',
  p_client_id text default null
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messages;
  v_preview text;
  v_other uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.vchat_is_member(p_conversation_id) then
    raise exception 'Not a member';
  end if;

  select other.user_id into v_other
  from public.conversation_members other
  where other.conversation_id = p_conversation_id and other.user_id <> auth.uid()
  limit 1;

  if v_other is not null and public.vchat_is_blocked(auth.uid(), v_other) then
    raise exception 'You cannot message this user';
  end if;

  if p_message_type = 'text' and length(btrim(coalesce(p_content, ''))) = 0 then
    raise exception 'Message cannot be empty';
  end if;
  if length(coalesce(p_content, '')) > 4000 then
    raise exception 'Message is too long';
  end if;

  insert into public.messages (conversation_id, sender_id, content, message_type, client_id)
  values (p_conversation_id, auth.uid(), btrim(p_content), coalesce(nullif(p_message_type, ''), 'text'), p_client_id)
  returning * into v_msg;

  v_preview := left(coalesce(v_msg.content, v_msg.message_type), 120);

  update public.conversations
  set last_message_at = v_msg.created_at,
      last_message_preview = v_preview,
      updated_at = now()
  where id = p_conversation_id;

  if v_other is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (
      v_other,
      'new_message',
      'New message',
      v_preview,
      jsonb_build_object('conversation_id', p_conversation_id, 'message_id', v_msg.id)
    );
  end if;

  return v_msg;
end;
$$;

create or replace function public.update_my_profile(p_full_name text, p_about text, p_avatar_url text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.profiles;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_full_name is not null and (length(btrim(p_full_name)) < 2 or length(p_full_name) > 80) then
    raise exception 'Invalid name';
  end if;
  if p_about is not null and length(p_about) > 280 then
    raise exception 'About is too long';
  end if;

  update public.profiles
  set
    full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
    display_name = coalesce(nullif(btrim(p_full_name), ''), display_name),
    name = coalesce(nullif(btrim(p_full_name), ''), name),
    about = coalesce(p_about, about),
    bio = coalesce(p_about, bio),
    avatar_url = coalesce(p_avatar_url, avatar_url),
    updated_at = now()
  where id = auth.uid()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.touch_last_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

create or replace function public.send_mobile_otp()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mobile text;
  v_code text;
  v_dev boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select coalesce(mobile, phone) into v_mobile from public.profiles where id = auth.uid();
  if v_mobile is null or length(v_mobile) <> 10 then
    raise exception 'Add a valid mobile number to your profile first';
  end if;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  insert into public.mobile_otp_challenges (user_id, mobile, code_hash, expires_at)
  values (auth.uid(), v_mobile, crypt(v_code, gen_salt('bf')), now() + interval '10 minutes');

  select coalesce(value, 'false') = 'true' into v_dev
  from public.app_runtime_config
  where key = 'dev_mobile_otp';

  if coalesce(v_dev, false) then
    return jsonb_build_object(
      'sent', true,
      'channel', 'development_mock',
      'dev_code', v_code,
      'mobile', v_mobile
    );
  end if;

  return jsonb_build_object(
    'sent', true,
    'channel', 'pending_sms_provider',
    'mobile', v_mobile
  );
end;
$$;

create or replace function public.verify_mobile_otp(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mobile_otp_challenges;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_code is null or length(regexp_replace(p_code, '\D', '', 'g')) <> 6 then
    raise exception 'Enter the 6-digit code';
  end if;

  select * into v_row
  from public.mobile_otp_challenges
  where user_id = auth.uid()
    and verified_at is null
    and expires_at > now()
  order by created_at desc
  limit 1;

  if v_row.id is null then
    raise exception 'No active mobile verification code. Request a new one.';
  end if;

  if v_row.attempts >= 5 then
    raise exception 'Too many attempts. Request a new code.';
  end if;

  update public.mobile_otp_challenges set attempts = attempts + 1 where id = v_row.id;

  if v_row.code_hash <> crypt(regexp_replace(p_code, '\D', '', 'g'), v_row.code_hash) then
    raise exception 'Incorrect mobile code';
  end if;

  update public.mobile_otp_challenges set verified_at = now() where id = v_row.id;
  update public.profiles
  set mobile_verified = true, mobile_verified_at = now()
  where id = auth.uid();

  return jsonb_build_object('verified', true);
end;
$$;

create or replace function public.submit_contact(
  p_full_name text,
  p_email text,
  p_mobile text,
  p_topic text,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if length(btrim(coalesce(p_full_name, ''))) < 2 then raise exception 'Invalid name'; end if;
  if p_email !~* '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' then raise exception 'Invalid email'; end if;
  if length(regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g')) <> 10 then raise exception 'Invalid mobile'; end if;
  if length(btrim(coalesce(p_topic, ''))) < 2 then raise exception 'Select a topic'; end if;
  if length(btrim(coalesce(p_message, ''))) < 10 then raise exception 'Message is too short'; end if;

  insert into public.contact_submissions (full_name, name, email, mobile, topic, message, user_id)
  values (
    btrim(p_full_name),
    btrim(p_full_name),
    lower(btrim(p_email)),
    regexp_replace(p_mobile, '\D', '', 'g'),
    btrim(p_topic),
    btrim(p_message),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.get_peer_read_at(p_conversation_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(last_read_at)
  from public.conversation_members
  where conversation_id = p_conversation_id
    and user_id <> auth.uid();
$$;

grant execute on function public.lookup_user_by_mobile(text) to authenticated;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
grant execute on function public.list_my_conversations() to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.send_chat_message(uuid, text, text, text) to authenticated;
grant execute on function public.update_my_profile(text, text, text) to authenticated;
grant execute on function public.touch_last_seen() to authenticated;
grant execute on function public.send_mobile_otp() to authenticated;
grant execute on function public.verify_mobile_otp(text) to authenticated;
grant execute on function public.submit_contact(text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_peer_read_at(uuid) to authenticated;
grant execute on function public.vchat_is_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select to public
  using (bucket_id = 'avatars');

drop policy if exists avatars_own_write on storage.objects;
create policy avatars_own_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_own_update on storage.objects;
create policy avatars_own_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists chat_files_member_read on storage.objects;
create policy chat_files_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.vchat_is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists chat_files_member_write on storage.objects;
create policy chat_files_member_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and public.vchat_is_member(((storage.foldername(name))[1])::uuid)
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null; when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.conversations;
  exception when duplicate_object then null; when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.conversation_members;
  exception when duplicate_object then null; when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.message_reads;
  exception when duplicate_object then null; when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null; when others then null;
  end;
end $$;

notify pgrst, 'reload schema';
