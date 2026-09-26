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

-- Set when a page is deleted for good. The row stays behind as a tombstone:
-- devices pull by updated_at, and a row that no longer existed could never
-- tell them to drop their copy. See purge_pages below.
alter table public.pages add column if not exists purged_at timestamptz;

alter table public.pages add column if not exists is_favorite boolean not null default false;

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

-- A tombstone is final. A device that has not heard about the purge yet may
-- still push its old copy of the row; skipping the update keeps the page dead
-- and never errors, so that device's sync carries on and pulls the tombstone.
-- Named to sort before pages_touch_updated_at, so the skip wins.
create or replace function public.keep_purged()
returns trigger language plpgsql as $$
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
-- belong to a page of yours: the foreign key alone does not check that, since
-- foreign key checks bypass RLS, and a document someone else inserted for your
-- page would leave you unable to save it.
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
create policy page_docs_insert on public.page_docs for insert with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.pages as p
     where p.id = page_docs.page_id and p.user_id = auth.uid()
  )
);
create policy page_docs_update on public.page_docs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy page_docs_delete on public.page_docs for delete using (auth.uid() = user_id);

-- A saved document stamps its page row. Realtime carries only pages (see the
-- end of this file), so this small row is how other devices hear that the
-- document changed, instead of being sent the whole blob.
create or replace function public.page_doc_saved(p_page_id uuid)
returns void
language sql
security invoker
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
begin;

drop function if exists public.push_page_doc(uuid, text, bigint);

create function public.push_page_doc(
  p_page_id      uuid,
  p_ydoc         text,
  p_base_version bigint
)
returns table (ydoc text, version bigint, applied boolean, saved_at timestamptz)
language plpgsql
security invoker
as $$
declare
  v_ydoc    text;
  v_version bigint;
  v_saved   timestamptz;
begin
  -- Deleted for good, or never here: there is nothing to write the document
  -- into. Version 0 with applied = true tells the client to drop its copy.
  if not exists (
    select 1 from public.pages as p
     where p.id = p_page_id and p.purged_at is null
  ) then
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

commit;

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
as $$
begin
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
