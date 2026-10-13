-- Run after schema.sql on a development Supabase project. Fixtures and the
-- cloned trigger use temporary objects only; the final ROLLBACK removes them.
-- This verifies the actual SQL trigger logic, rather than the client mock.
begin;

create temporary table workspace_schema_test_workspaces (like public.workspaces including defaults);
create temporary table workspace_schema_test_pages (like public.pages including defaults);
alter table workspace_schema_test_pages add primary key (id);
alter table workspace_schema_test_pages alter column workspace_id drop not null;

insert into workspace_schema_test_workspaces (id, user_id, name) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Pages'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Work');
insert into workspace_schema_test_pages (id, user_id, title, purged_at) values
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000001', 'Live', null),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', '', now());

create trigger pages_keep_purged before update on workspace_schema_test_pages
  for each row execute function public.keep_purged();
update workspace_schema_test_pages set workspace_id = user_id where workspace_id is null;
do $$ begin
  if not exists (select 1 from workspace_schema_test_pages where purged_at is not null and workspace_id is null) then
    raise exception 'Fixture did not reproduce the tombstone backfill bug';
  end if;
end $$;

drop trigger pages_keep_purged on workspace_schema_test_pages;
update workspace_schema_test_pages set workspace_id = user_id where workspace_id is null;
alter table workspace_schema_test_pages alter column workspace_id set not null;
create trigger pages_keep_purged before update on workspace_schema_test_pages
  for each row execute function public.keep_purged();
update workspace_schema_test_pages set purged_at = null where purged_at is not null;
do $$ begin
  if exists (select 1 from workspace_schema_test_pages where workspace_id is null)
     or not exists (select 1 from workspace_schema_test_pages where purged_at is not null) then
    raise exception 'Migration must fill tombstone membership and keep tombstone protection';
  end if;
end $$;

-- Clone the installed page trigger, changing only its namespace/table targets
-- so every query/write goes to the temporary fixtures rather than real notes.
do $$
declare v_source text;
begin
  v_source := pg_get_functiondef('public.guard_page_workspace()'::regprocedure);
  v_source := replace(v_source, 'FUNCTION public.guard_page_workspace()', 'FUNCTION pg_temp.guard_page_workspace()');
  v_source := replace(v_source, 'public.workspaces', 'pg_temp.workspace_schema_test_workspaces');
  v_source := replace(v_source, 'public.pages', 'pg_temp.workspace_schema_test_pages');
  execute v_source;
end $$;
create trigger pages_workspace_state before insert or update on workspace_schema_test_pages
  for each row execute function pg_temp.guard_page_workspace();

-- The production client omits workspace_id. Roots still get Pages.
insert into workspace_schema_test_pages (id, user_id, title) values
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'Legacy root');
insert into workspace_schema_test_pages (id, user_id, workspace_id, title) values
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Work root');
insert into workspace_schema_test_pages (id, user_id, parent_id, title) values
  ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000013', 'Legacy child');
do $$ begin
  if not exists (select 1 from workspace_schema_test_pages where title = 'Legacy root' and workspace_id = '00000000-0000-4000-8000-000000000001')
     or not exists (select 1 from workspace_schema_test_pages where title = 'Legacy child' and workspace_id = '00000000-0000-4000-8000-000000000002') then
    raise exception 'Legacy roots and children received incorrect workspace membership';
  end if;
end $$;

-- Removing Pages must not blank a Work title through BEFORE INSERT's upsert
-- path, or silently purge a new legacy root. Explicit purged membership from
-- the new client must still leave a tombstone.
update workspace_schema_test_workspaces set purged_at = now(), deleted_at = now()
  where id = '00000000-0000-4000-8000-000000000001';
insert into workspace_schema_test_pages (id, user_id, title) values
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', 'Renamed Work')
  on conflict (id) do update set title = excluded.title;
insert into workspace_schema_test_pages (id, user_id, title) values
  ('00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000001', 'Surviving legacy root');
insert into workspace_schema_test_pages (id, user_id, workspace_id, title) values
  ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Late explicit write');
do $$ begin
  if not exists (select 1 from workspace_schema_test_pages where title = 'Renamed Work' and workspace_id = '00000000-0000-4000-8000-000000000002' and purged_at is null)
     or not exists (select 1 from workspace_schema_test_pages where title = 'Surviving legacy root' and workspace_id = '00000000-0000-4000-8000-000000000002' and purged_at is null)
     or not exists (select 1 from workspace_schema_test_pages where id = '00000000-0000-4000-8000-000000000016' and purged_at is not null) then
    raise exception 'Legacy compatibility or permanent-deletion protection failed';
  end if;
end $$;

rollback;
