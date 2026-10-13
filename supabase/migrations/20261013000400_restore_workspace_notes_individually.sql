-- Recover a deleted workspace by restoring only the requested note.
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
