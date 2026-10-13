-- Remove retired workspace colour metadata from existing installations.
begin;

alter table public.workspaces drop column if exists color;

commit;
