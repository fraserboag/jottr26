-- Requires the existing workspace schema. Apply to the test database first.
-- Only adds ordering and atomic note transfers; does not backfill production pages.
begin;

alter table public.workspaces add column if not exists sort_key text not null default '';
alter table public.workspace_operations add column if not exists source_workspace_id uuid;

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

commit;
