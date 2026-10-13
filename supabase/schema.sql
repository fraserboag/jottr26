-- Jottr schema.
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Safe to re-run: every statement is idempotent.
-- Run the entire file. One transaction prevents a failed migration from
-- leaving new constraints, removed triggers or replaced RPCs half-installed.
begin;

-- ---------------------------------------------------------------------------
-- pages: page metadata. Synced last-writer-wins on the server's updated_at.
-- The blob lives in page_docs so realtime events and list queries stay small.
-- ---------------------------------------------------------------------------
create table if not exists public.pages (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null default '',
  -- Deliberately not a foreign key: a child can reach the server before its
  -- parent when several pages are created offline. The client keeps the tree
  -- honest and treats a dangling parent_id as a root page.
  parent_id   uuid,
  sort_key    text not null default 'a0',
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Set when a page is deleted for good. The row stays behind as a tombstone:
-- devices pull by updated_at, and a row that no longer existed could never
-- tell them to drop their copy. See purge_pages below.
alter table public.pages add column if not exists purged_at timestamptz;

alter table public.pages add column if not exists is_favorite boolean not null default false;

-- Workspaces live within an account. Its auth UUID is the stable identity of
-- the initial Pages workspace. The page trigger resolves legacy inserts.
create table if not exists public.workspaces (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'Pages' check (length(btrim(name)) between 1 and 80),
  deleted_at timestamptz,
  purged_at timestamptz,
  state_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
alter table public.workspaces add column if not exists sort_key text not null default '';
-- Remove retired workspace colour metadata from existing installations.
alter table public.workspaces drop column if exists color;
create unique index if not exists workspaces_active_name_idx
  on public.workspaces (user_id, lower(btrim(name))) where deleted_at is null and purged_at is null;
create index if not exists workspaces_user_updated_idx on public.workspaces (user_id, updated_at);

insert into public.workspaces (id, user_id, created_at)
select id, id, created_at from auth.users on conflict (id) do nothing;

alter table public.pages add column if not exists workspace_id uuid;
-- Missing membership identifies a legacy write. The BEFORE INSERT trigger
-- supplies it before NOT NULL is checked, including partial metadata upserts.
alter table public.pages alter column workspace_id drop default;
alter table public.pages add column if not exists workspace_deletion_id uuid;
-- The old trigger returns NULL for purged rows, silently skipping their
-- backfill. Temporarily remove it under this transaction's table lock; it is
-- recreated below. A failure rolls back its removal along with the migration.
drop trigger if exists pages_keep_purged on public.pages;
update public.pages set workspace_id = user_id where workspace_id is null;
alter table public.pages alter column workspace_id set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pages_workspace_owner_fk' and conrelid = 'public.pages'::regclass) then
    alter table public.pages add constraint pages_workspace_owner_fk
      foreign key (workspace_id, user_id) references public.workspaces (id, user_id);
  end if;
end $$;

-- Receipts make a retried lifecycle request harmless, even if the user has
-- since restored or deleted the workspace again on a different device.
create table if not exists public.workspace_operations (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id uuid not null,
  applied boolean not null,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.workspace_operations add column if not exists source_workspace_id uuid;

alter table public.workspaces enable row level security;
alter table public.workspace_operations enable row level security;
drop policy if exists workspaces_select on public.workspaces;
drop policy if exists workspaces_insert on public.workspaces;
drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_select on public.workspaces for select using ((select auth.uid()) = user_id);
create policy workspaces_insert on public.workspaces for insert with check ((select auth.uid()) = user_id);
create policy workspaces_update on public.workspaces for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists workspace_operations_select on public.workspace_operations;
drop policy if exists workspace_operations_insert on public.workspace_operations;
create policy workspace_operations_select on public.workspace_operations for select using ((select auth.uid()) = user_id);
create policy workspace_operations_insert on public.workspace_operations for insert with check ((select auth.uid()) = user_id);
grant select, insert, update on public.workspaces to authenticated;
grant select, insert on public.workspace_operations to authenticated;

create or replace function public.ensure_default_workspace()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to use spaces'; end if;
  -- Never recreate a deleted/purged initial workspace.
  insert into public.workspaces (id, user_id) values (auth.uid(), auth.uid())
    on conflict (id) do nothing;
end;
$$;
revoke execute on function public.ensure_default_workspace() from public, anon;
grant execute on function public.ensure_default_workspace() to authenticated;

create or replace function public.create_signup_workspace()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspaces (id, user_id, created_at) values (new.id, new.id, new.created_at)
    on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.create_signup_workspace() from public, anon, authenticated;
drop trigger if exists users_create_workspace on auth.users;
create trigger users_create_workspace after insert on auth.users
  for each row execute function public.create_signup_workspace();

-- ---------------------------------------------------------------------------
-- page_docs: the Yjs document, base64 of Y.encodeStateAsUpdate(doc).
-- `version` is a compare-and-swap token, not a clock. See push_page_doc below.
-- ---------------------------------------------------------------------------
create table if not exists public.page_docs (
  page_id    uuid primary key references public.pages (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ydoc       text not null default '',
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

create index if not exists pages_user_updated_idx on public.pages (user_id, updated_at);
-- The live-page scan that reconciles deletions: your unpurged rows, by id.
-- Nothing reads pages by parent on the server; the tree is built on the device.
drop index if exists public.pages_user_parent_idx;
create index if not exists pages_user_live_idx on public.pages (user_id, id) where purged_at is null;
create index if not exists page_docs_user_updated_idx on public.page_docs (user_id, updated_at);

-- updated_at is stamped by the server so clients never have to trust their own
-- clock when deciding what they have already pulled.
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pages_touch_updated_at on public.pages;
create trigger pages_touch_updated_at
  before update on public.pages
  for each row execute function public.touch_updated_at();

drop trigger if exists workspaces_touch_updated_at on public.workspaces;
create trigger workspaces_touch_updated_at before update on public.workspaces
  for each row execute function public.touch_updated_at();

create or replace function public.guard_workspace_state()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.purged_at is not null then return null; end if;
    if (new.deleted_at is distinct from old.deleted_at or new.purged_at is distinct from old.purged_at
        or new.state_token is distinct from old.state_token)
       and coalesce(current_setting('jottr.workspace_operation', true), '') <> 'yes' then
      raise exception 'Space state requires an explicit space operation';
    end if;
  elsif new.deleted_at is not null or new.purged_at is not null or new.state_token is not null then
    raise exception 'New spaces must be active';
  end if;
  return new;
end;
$$;
drop trigger if exists workspaces_guard_state on public.workspaces;
create trigger workspaces_guard_state before insert or update on public.workspaces
  for each row execute function public.guard_workspace_state();

create or replace function public.guard_page_workspace()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_workspace public.workspaces;
  v_parent_workspace uuid;
  v_existing_workspace uuid;
begin
  if tg_op = 'INSERT' then
    -- BEFORE INSERT also runs for ON CONFLICT updates. Preserve an existing
    -- page's workspace even when an old client omits workspace_id, otherwise
    -- default-workspace deletion could mutate the upsert's title/deletion.
    select workspace_id into v_existing_workspace from public.pages
      where id = new.id and user_id = new.user_id;
    if v_existing_workspace is not null then new.workspace_id := v_existing_workspace; end if;
    if v_existing_workspace is null and new.parent_id is not null then
      select workspace_id into v_parent_workspace from public.pages where id = new.parent_id and user_id = new.user_id;
      if found then new.workspace_id := v_parent_workspace; end if;
    end if;
  end if;
  if tg_op = 'UPDATE' and old.workspace_id is not null and new.workspace_id is distinct from old.workspace_id
     and coalesce(current_setting('jottr.page_move', true), '') <> 'yes' then
    raise exception 'Space transfers require an explicit page move';
  end if;
  if new.workspace_id is null then
    if new.parent_id is not null then
      select workspace_id into new.workspace_id from public.pages
        where id = new.parent_id and user_id = new.user_id;
    end if;
    if new.workspace_id is null then
      -- Legacy roots use Pages while it is active, or a surviving workspace
      -- if it was deleted. Never silently purge a new legacy root page.
      select id into new.workspace_id from public.workspaces
        where user_id = new.user_id and deleted_at is null and purged_at is null
        order by (id = new.user_id) desc, created_at, id limit 1;
    end if;
  end if;
  select * into v_workspace from public.workspaces where id = new.workspace_id and user_id = new.user_id for share;
  if not found then raise exception 'Space is not available for this account'; end if;
  if v_workspace.purged_at is not null then
    new.purged_at := coalesce(new.purged_at, now());
    new.deleted_at := coalesce(new.deleted_at, now());
    new.title := '';
  elsif v_workspace.deleted_at is not null then
    if new.deleted_at is null then
      new.deleted_at := v_workspace.deleted_at;
      new.workspace_deletion_id := v_workspace.state_token;
    elsif new.workspace_deletion_id is not null then
      if tg_op = 'INSERT' then
        new.deleted_at := v_workspace.deleted_at;
        new.workspace_deletion_id := v_workspace.state_token;
      elsif old.deleted_at is null then
        new.deleted_at := v_workspace.deleted_at;
        new.workspace_deletion_id := v_workspace.state_token;
      elsif new.workspace_deletion_id is distinct from old.workspace_deletion_id then
        -- Concurrent workspace deletions must tag late notes with the accepted
        -- deletion, while preserving notes already in Trash before it.
        new.deleted_at := old.deleted_at;
        new.workspace_deletion_id := old.workspace_deletion_id;
      end if;
    end if;
  elsif new.workspace_deletion_id is not null and new.workspace_deletion_id is distinct from v_workspace.state_token then
    -- A pending local delete has not reached the server yet. The workspace
    -- operation will trash these pages atomically if it is accepted.
    if tg_op = 'INSERT' then
      new.deleted_at := null;
      new.workspace_deletion_id := null;
    elsif new.workspace_deletion_id is distinct from old.workspace_deletion_id then
      new.deleted_at := old.deleted_at;
      new.workspace_deletion_id := old.workspace_deletion_id;
    end if;
  end if;
  if new.parent_id is not null and coalesce(current_setting('jottr.page_move', true), '') <> 'yes' then
    select workspace_id into v_parent_workspace from public.pages where id = new.parent_id and user_id = new.user_id;
    if found and v_parent_workspace <> new.workspace_id then raise exception 'Parent belongs to another space'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists pages_workspace_state on public.pages;
create trigger pages_workspace_state before insert or update on public.pages
  for each row execute function public.guard_page_workspace();

create or replace function public.apply_workspace_operation(
  p_operation_id uuid, p_workspace_id uuid, p_action text, p_expected_state uuid, p_page_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_workspace public.workspaces;
  v_page public.pages;
  v_receipt public.workspace_operations;
  v_reason text;
  v_applied boolean := false;
begin
  if auth.uid() is null then raise exception 'Sign in to use spaces'; end if;
  -- Serialise lifecycle changes for an account so two devices cannot each
  -- delete what they believe is the second-to-last active workspace.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 0));
  select * into v_receipt from public.workspace_operations where id = p_operation_id;
  if found then return jsonb_build_object('applied', v_receipt.applied, 'reason', v_receipt.reason); end if;
  select * into v_workspace from public.workspaces where id = p_workspace_id and user_id = auth.uid() for update;
  if not found or v_workspace.purged_at is not null then
    v_reason := 'This space has been permanently deleted.';
  elsif v_workspace.state_token is distinct from p_expected_state then
    v_reason := 'This space changed on another device. Your view has been refreshed.';
  elsif p_action = 'delete' and (select count(*) from public.workspaces where deleted_at is null and purged_at is null) <= 1 then
    v_reason := 'Keep at least one space. Another device changed your spaces.';
  elsif p_action in ('restore', 'restorePage') and exists (
    select 1 from public.workspaces where id <> p_workspace_id and deleted_at is null and purged_at is null
      and lower(btrim(name)) = lower(btrim(v_workspace.name))
  ) then
    v_reason := 'A space with this name already exists. Rename it before restoring this space.';
  elsif (p_action = 'delete' and v_workspace.deleted_at is null)
     or (p_action in ('restore', 'restorePage', 'purge') and v_workspace.deleted_at is not null) then
    perform pg_catalog.set_config('jottr.workspace_operation', 'yes', true);
    if p_action = 'delete' then
      update public.workspaces set deleted_at = now(), state_token = p_operation_id where id = p_workspace_id;
      update public.pages set deleted_at = now(), workspace_deletion_id = p_operation_id
        where workspace_id = p_workspace_id and deleted_at is null and purged_at is null;
    elsif p_action = 'restore' then
      update public.workspaces set deleted_at = null, state_token = p_operation_id where id = p_workspace_id;
      update public.pages set deleted_at = null, workspace_deletion_id = null
        where workspace_id = p_workspace_id and workspace_deletion_id = v_workspace.state_token and purged_at is null;
    elsif p_action = 'restorePage' then
      select * into v_page from public.pages where id = p_page_id and workspace_id = p_workspace_id and purged_at is null;
      update public.workspaces set deleted_at = null, state_token = p_operation_id where id = p_workspace_id;
      if v_page.id is not null then
        update public.pages set deleted_at = null, workspace_deletion_id = null where id = v_page.id;
        update public.pages set parent_id = null where id = p_page_id and exists (
          select 1 from public.pages parent where parent.id = v_page.parent_id and parent.deleted_at is not null
        );
      end if;
    else
      update public.workspaces set purged_at = now(), state_token = p_operation_id where id = p_workspace_id;
      perform 1 from public.pages where workspace_id = p_workspace_id order by id for update;
      delete from public.page_docs where page_id in (select id from public.pages where workspace_id = p_workspace_id);
      update public.pages set purged_at = now(), title = '' where workspace_id = p_workspace_id and purged_at is null;
    end if;
    perform pg_catalog.set_config('jottr.workspace_operation', '', true);
    v_applied := true;
  else
    v_reason := 'Space is no longer in the expected state.';
  end if;
  insert into public.workspace_operations (id, workspace_id, applied, reason)
    values (p_operation_id, p_workspace_id, v_applied, v_reason);
  return jsonb_build_object('applied', v_applied, 'reason', v_reason);
end;
$$;
revoke execute on function public.apply_workspace_operation(uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.apply_workspace_operation(uuid, uuid, text, uuid, uuid) to authenticated;

-- Preserve IDs/documents while transferring the complete subtree atomically.
-- Workspace locks also stop new children arriving halfway through a move.
create or replace function public.move_page_tree(
  p_operation_id uuid, p_page_id uuid, p_source_workspace_id uuid,
  p_workspace_id uuid, p_parent_id uuid, p_sort_key text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_page public.pages;
  v_parent public.pages;
  v_receipt public.workspace_operations;
  v_ids uuid[];
  v_reason text;
  v_applied boolean := false;
  v_source uuid := p_source_workspace_id;
begin
  if auth.uid() is null then raise exception 'Sign in to move pages'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 0));
  select * into v_receipt from public.workspace_operations where id = p_operation_id;
  if found then
    return jsonb_build_object('applied', v_receipt.applied, 'reason', v_receipt.reason, 'source_workspace_id', v_receipt.source_workspace_id);
  end if;
  perform 1 from public.workspaces where id in (p_source_workspace_id, p_workspace_id) order by id for update;
  select * into v_page from public.pages where id = p_page_id and user_id = auth.uid();
  if v_page.id is not null then v_source := v_page.workspace_id; end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id and user_id = auth.uid() and deleted_at is null and purged_at is null)
     or not exists (select 1 from public.workspaces where id = p_source_workspace_id and user_id = auth.uid() and deleted_at is null and purged_at is null) then
    v_reason := 'A space is no longer available. The page has been kept in its original space.';
  elsif v_page.id is not null and (v_page.purged_at is not null or v_page.deleted_at is not null or v_page.workspace_id <> p_source_workspace_id) then
    v_reason := 'This page moved or was deleted on another device. Your view has been refreshed.';
  else
    if p_parent_id is not null then select * into v_parent from public.pages where id = p_parent_id and user_id = auth.uid(); end if;
    if v_parent.id is not null and (v_parent.workspace_id <> p_workspace_id or v_parent.deleted_at is not null or v_parent.purged_at is not null) then
      v_reason := 'The destination page is no longer available.';
    else
      with recursive subtree(id) as (
        select id from public.pages where id = p_page_id and purged_at is null
        union
        select p.id from public.pages p join subtree s on p.parent_id = s.id
          where p.workspace_id = p_source_workspace_id and p.purged_at is null
      ) select array_agg(id) into v_ids from subtree;
      if p_parent_id = p_page_id or p_parent_id = any (coalesce(v_ids, '{}'::uuid[])) then
        v_reason := 'A page cannot be moved inside its own subtree.';
      else
        -- A page not uploaded yet will be inserted by the subsequent metadata
        -- push with its destination membership; no document is created here.
        if v_page.id is not null then
          perform 1 from public.pages where id = any(v_ids) order by id for update;
          perform pg_catalog.set_config('jottr.page_move', 'yes', true);
          update public.pages set workspace_id = p_workspace_id, workspace_deletion_id = null where id = any(v_ids);
          update public.pages set parent_id = p_parent_id, sort_key = p_sort_key where id = p_page_id;
          perform pg_catalog.set_config('jottr.page_move', '', true);
        end if;
        v_applied := true;
      end if;
    end if;
  end if;
  insert into public.workspace_operations (id, workspace_id, source_workspace_id, applied, reason)
    values (p_operation_id, p_workspace_id, v_source, v_applied, v_reason);
  return jsonb_build_object('applied', v_applied, 'reason', v_reason, 'source_workspace_id', v_source);
end;
$$;
revoke execute on function public.move_page_tree(uuid, uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.move_page_tree(uuid, uuid, uuid, uuid, uuid, text) to authenticated;

-- A tombstone is final. A device that has not heard about the purge yet may
-- still push its old copy of the row; skipping the update keeps the page dead
-- and never errors, so that device's sync carries on and pulls the tombstone.
-- Named to sort before pages_touch_updated_at, so the skip wins.
create or replace function public.keep_purged()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.purged_at is not null then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists pages_keep_purged on public.pages;
create trigger pages_keep_purged
  before update on public.pages
  for each row execute function public.keep_purged();

drop trigger if exists page_docs_touch_updated_at on public.page_docs;
create trigger page_docs_touch_updated_at
  before update on public.page_docs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security. There is no sharing in Jottr, so every policy is the
-- same sentence: you can only ever touch your own rows. A document also has to
-- belong to a page of yours, when written and when rewritten: the foreign key
-- alone does not check that, since foreign key checks bypass RLS, and a
-- document someone else inserted for your page, or moved onto it by changing
-- its page_id, would leave you unable to save it. auth.uid() is wrapped in a
-- select so Postgres works it out once per query, not again for every row.
-- ---------------------------------------------------------------------------
alter table public.pages enable row level security;
alter table public.page_docs enable row level security;

drop policy if exists pages_select on public.pages;
drop policy if exists pages_insert on public.pages;
drop policy if exists pages_update on public.pages;
drop policy if exists pages_delete on public.pages;
create policy pages_select on public.pages for select using ((select auth.uid()) = user_id);
create policy pages_insert on public.pages for insert with check ((select auth.uid()) = user_id);
create policy pages_update on public.pages for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy pages_delete on public.pages for delete using ((select auth.uid()) = user_id);

drop policy if exists page_docs_select on public.page_docs;
drop policy if exists page_docs_insert on public.page_docs;
drop policy if exists page_docs_update on public.page_docs;
drop policy if exists page_docs_delete on public.page_docs;
create policy page_docs_select on public.page_docs for select using ((select auth.uid()) = user_id);
create policy page_docs_insert on public.page_docs for insert with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.pages as p
     where p.id = page_docs.page_id and p.user_id = (select auth.uid()) and p.purged_at is null
  )
);
create policy page_docs_update on public.page_docs for update using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.pages as p
     where p.id = page_docs.page_id and p.user_id = (select auth.uid()) and p.purged_at is null
  )
);
create policy page_docs_delete on public.page_docs for delete using ((select auth.uid()) = user_id);

-- A saved document stamps its page row. Realtime carries only pages (see the
-- end of this file), so this small row is how other devices hear that the
-- document changed, instead of being sent the whole blob.
create or replace function public.page_doc_saved(p_page_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.pages set updated_at = now() where id = p_page_id;
$$;

-- ---------------------------------------------------------------------------
-- push_page_doc: compare-and-swap write of a Yjs state blob.
--
-- On success only the new version comes back: the client already holds the
-- blob it sent, and echoing it would double the data every save costs. So does
-- saved_at, the stamp the save left on the page row, which lets the client
-- recognise its own save when realtime hands it straight back.
--
-- The client sends the version it last saw. If the server has moved on, nothing
-- is written and the current blob comes back with applied = false; the client
-- merges it into its own doc (Yjs merges are commutative and idempotent, so no
-- edit can be lost) and pushes again at the new version. This is the whole
-- conflict story: there is no last-writer-wins anywhere near document content.
--
-- security invoker, so RLS still applies inside the function.
--
-- Dropped and recreated rather than replaced, because saved_at changed what it
-- returns, which `create or replace` refuses to do. The transaction means no
-- push ever arrives to find the function missing.
-- ---------------------------------------------------------------------------
drop function if exists public.push_page_doc(uuid, text, bigint);

create function public.push_page_doc(
  p_page_id      uuid,
  p_ydoc         text,
  p_base_version bigint
)
returns table (ydoc text, version bigint, applied boolean, saved_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ydoc    text;
  v_version bigint;
  v_saved   timestamptz;
begin
  -- Deleted for good, or never here: there is nothing to write the document
  -- into. Version 0 with applied = true tells the client to drop its copy.
  -- Use the same workspace -> page -> document lock order as a purge. A
  -- document push that started before deletion must not recreate its blob.
  perform 1 from public.workspaces as w
    where w.id = (select p.workspace_id from public.pages p where p.id = p_page_id)
      and w.purged_at is null for share;
  if not found then
    return query select ''::text, 0::bigint, true, null::timestamptz;
    return;
  end if;
  perform 1 from public.pages as p where p.id = p_page_id and p.purged_at is null for update;
  if not found then
    return query select ''::text, 0::bigint, true, null::timestamptz;
    return;
  end if;

  if p_base_version <= 0 then
    insert into public.page_docs as d (page_id, ydoc, version)
    values (p_page_id, p_ydoc, 1)
    on conflict (page_id) do nothing
    returning d.version into v_version;

    if found then
      perform public.page_doc_saved(p_page_id);
      select p.updated_at into v_saved from public.pages as p where p.id = p_page_id;
      return query select ''::text, v_version, true, v_saved;
      return;
    end if;
  else
    update public.page_docs as d
       set ydoc = p_ydoc, version = d.version + 1
     where d.page_id = p_page_id
       and d.version = p_base_version
    returning d.version into v_version;

    if found then
      perform public.page_doc_saved(p_page_id);
      select p.updated_at into v_saved from public.pages as p where p.id = p_page_id;
      return query select ''::text, v_version, true, v_saved;
      return;
    end if;
  end if;

  -- Rejected: hand back whatever the server currently holds so the client can
  -- merge and retry. A missing row (deleted, or not visible) reports version 0,
  -- which the client treats as "insert next time".
  select d.ydoc, d.version into v_ydoc, v_version
    from public.page_docs as d
   where d.page_id = p_page_id;

  return query select coalesce(v_ydoc, ''), coalesce(v_version, 0::bigint), false, null::timestamptz;
end;
$$;

grant execute on function public.push_page_doc(uuid, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- purge_pages: delete pages for good, leaving a tombstone for other devices.
--
-- The document and title go; the row keeps only its id and purged_at, and the
-- update stamps a fresh updated_at so every device's next pull sees it. Ids
-- the server never had get a tombstone too, in case another device is still
-- holding the page and has not pushed it yet.
-- ---------------------------------------------------------------------------
create or replace function public.purge_pages(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.workspaces w where w.id in (
    select workspace_id from public.pages where id = any (p_ids)
  ) order by w.id for share;
  perform 1 from public.pages where id = any (p_ids) order by id for update;
  delete from public.page_docs where page_id = any (p_ids);

  update public.pages
     set purged_at = now(), deleted_at = coalesce(deleted_at, now()), title = ''
   where id = any (p_ids) and purged_at is null;

  insert into public.pages (id, purged_at, deleted_at)
  select id, now(), now() from unnest(p_ids) as id
  on conflict (id) do nothing;
end;
$$;

grant execute on function public.purge_pages(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime. Clients treat these events purely as a hint to go and pull; the
-- authoritative read is always a REST query, so a dropped socket or a truncated
-- payload can never cost you data.
-- ---------------------------------------------------------------------------
-- Filtered realtime (user_id=eq.…) only matches on UPDATE and DELETE when the
-- old row carries every column, which is not the default. Without this, cross
-- device updates silently fall back to the 45-second poll.
alter table public.pages replica identity full;
alter table public.workspaces replica identity full;

-- page_docs is deliberately left out. Its rows hold whole documents, and
-- realtime would push each one, old and new, to every device on every save;
-- page_doc_saved stamps the page row instead. Earlier versions of this file
-- published it, so undo that on re-run.
alter table public.page_docs replica identity default;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pages'
  ) then
    alter publication supabase_realtime add table public.pages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspaces'
  ) then
    alter publication supabase_realtime add table public.workspaces;
  end if;
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'page_docs'
  ) then
    alter publication supabase_realtime drop table public.page_docs;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Sign-up alerts: email the owner each time someone confirms a new account.
--
-- signInWithOtp creates the auth.users row as soon as a code is requested, so
-- this waits for email_confirmed_at to be set. Typos and abandoned attempts
-- never confirm, so they don't send an alert. The email itself is sent by the notify-signup
-- Edge Function (supabase/functions).
--
-- Nothing in here may ever raise: this runs inside sign-in, and an error
-- would stop anyone signing in. With the Vault secrets missing it does
-- nothing, and pg_net queues the request, so a slow or broken function never
-- holds sign-in up either.
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  if new.email_confirmed_at is null
     or (tg_op = 'UPDATE' and old.email_confirmed_at is not null) then
    return new;
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'signup_alert_secret';
  if v_url is null or v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url     := rtrim(v_url, '/') || '/functions/v1/notify-signup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-signup-alert-secret', v_secret
    ),
    body    := jsonb_build_object(
      'email', new.email,
      'total', (select count(*) from auth.users where email_confirmed_at is not null)
    )
  );
  return new;
exception when others then
  raise warning 'notify_signup failed: %', sqlerrm;
  return new;
end;
$$;

revoke execute on function public.notify_signup() from public, anon, authenticated;

drop trigger if exists users_notify_signup on auth.users;
create trigger users_notify_signup
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.notify_signup();

commit;
