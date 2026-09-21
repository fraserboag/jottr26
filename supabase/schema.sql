-- Jottr schema.
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Safe to re-run: every statement is idempotent.

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
create index if not exists pages_user_parent_idx on public.pages (user_id, parent_id);
create index if not exists page_docs_user_updated_idx on public.page_docs (user_id, updated_at);

-- updated_at is stamped by the server so clients never have to trust their own
-- clock when deciding what they have already pulled.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pages_touch_updated_at on public.pages;
create trigger pages_touch_updated_at
  before update on public.pages
  for each row execute function public.touch_updated_at();

drop trigger if exists page_docs_touch_updated_at on public.page_docs;
create trigger page_docs_touch_updated_at
  before update on public.page_docs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security. There is no sharing in Jottr, so every policy is the
-- same sentence: you can only ever touch your own rows.
-- ---------------------------------------------------------------------------
alter table public.pages enable row level security;
alter table public.page_docs enable row level security;

drop policy if exists pages_select on public.pages;
drop policy if exists pages_insert on public.pages;
drop policy if exists pages_update on public.pages;
drop policy if exists pages_delete on public.pages;
create policy pages_select on public.pages for select using (auth.uid() = user_id);
create policy pages_insert on public.pages for insert with check (auth.uid() = user_id);
create policy pages_update on public.pages for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy pages_delete on public.pages for delete using (auth.uid() = user_id);

drop policy if exists page_docs_select on public.page_docs;
drop policy if exists page_docs_insert on public.page_docs;
drop policy if exists page_docs_update on public.page_docs;
drop policy if exists page_docs_delete on public.page_docs;
create policy page_docs_select on public.page_docs for select using (auth.uid() = user_id);
create policy page_docs_insert on public.page_docs for insert with check (auth.uid() = user_id);
create policy page_docs_update on public.page_docs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy page_docs_delete on public.page_docs for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- push_page_doc: compare-and-swap write of a Yjs state blob.
--
-- The client sends the version it last saw. If the server has moved on, nothing
-- is written and the current blob comes back with applied = false; the client
-- merges it into its own doc (Yjs merges are commutative and idempotent, so no
-- edit can be lost) and pushes again at the new version. This is the whole
-- conflict story: there is no last-writer-wins anywhere near document content.
--
-- security invoker, so RLS still applies inside the function.
-- ---------------------------------------------------------------------------
create or replace function public.push_page_doc(
  p_page_id      uuid,
  p_ydoc         text,
  p_base_version bigint
)
returns table (ydoc text, version bigint, applied boolean)
language plpgsql
security invoker
as $$
declare
  v_ydoc    text;
  v_version bigint;
begin
  if p_base_version <= 0 then
    insert into public.page_docs as d (page_id, ydoc, version)
    values (p_page_id, p_ydoc, 1)
    on conflict (page_id) do nothing
    returning d.ydoc, d.version into v_ydoc, v_version;

    if found then
      return query select v_ydoc, v_version, true;
      return;
    end if;
  else
    update public.page_docs as d
       set ydoc = p_ydoc, version = d.version + 1
     where d.page_id = p_page_id
       and d.version = p_base_version
    returning d.ydoc, d.version into v_ydoc, v_version;

    if found then
      return query select v_ydoc, v_version, true;
      return;
    end if;
  end if;

  -- Rejected: hand back whatever the server currently holds so the client can
  -- merge and retry. A missing row (deleted, or not visible) reports version 0,
  -- which the client treats as "insert next time".
  select d.ydoc, d.version into v_ydoc, v_version
    from public.page_docs as d
   where d.page_id = p_page_id;

  return query select coalesce(v_ydoc, ''), coalesce(v_version, 0::bigint), false;
end;
$$;

grant execute on function public.push_page_doc(uuid, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime. Clients treat these events purely as a hint to go and pull; the
-- authoritative read is always a REST query, so a dropped socket or a truncated
-- payload can never cost you data.
-- ---------------------------------------------------------------------------
-- Filtered realtime (user_id=eq.…) only matches on UPDATE and DELETE when the
-- old row carries every column, which is not the default. Without this, cross
-- device updates silently fall back to the 45-second poll.
alter table public.pages replica identity full;
alter table public.page_docs replica identity full;

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
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'page_docs'
  ) then
    alter publication supabase_realtime add table public.page_docs;
  end if;
end
$$;
