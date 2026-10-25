-- READBOOKS database setup for Supabase.
-- Run this ONCE: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Every table has row-level security (RLS) turned on.

create extension if not exists pgcrypto;

-- ---------- helper functions ----------
create or replace function public.is_verified() returns boolean
language sql security definer set search_path = public, auth stable as $$
  select coalesce((select email_confirmed_at is not null from auth.users where id = auth.uid()), false)
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  role text not null default 'reader' check (role in ('reader','owner')),
  created_at timestamptz not null default now()
);

create or replace function public.is_owner() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner')
$$;

-- First account ever created becomes the owner; everyone else is a reader.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), 'Reader'), 40),
    case when exists (select 1 from public.profiles) then 'reader' else 'owner' end
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- tables ----------
create table public.business_info (
  id int primary key default 1 check (id = 1),
  terms text not null default 'Information to be provided by the business owner.' check (char_length(terms) <= 8000),
  privacy_policy text not null default 'Information to be provided by the business owner.' check (char_length(privacy_policy) <= 8000),
  retention text not null default 'Information to be provided by the business owner.' check (char_length(retention) <= 2000),
  support_contact text not null default 'Information to be provided by the business owner.' check (char_length(support_contact) <= 2000),
  business_contact text not null default 'Information to be provided by the business owner.' check (char_length(business_contact) <= 2000)
);
insert into public.business_info (id) values (1);

create table public.books (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  file_path text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  page_count int check (page_count is null or page_count >= 1),
  last_page int not null default 1 check (last_page >= 1),
  last_opened timestamptz,
  created_at timestamptz not null default now(),
  constraint file_path_in_own_folder check (file_path like owner_id::text || '/%'),
  constraint last_page_in_range check (page_count is null or last_page <= page_count)
);
create index on public.books (owner_id, last_opened desc);

create table public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page int not null check (page >= 1),
  note text not null default '' check (char_length(note) <= 60),
  created_at timestamptz not null default now(),
  unique (book_id, page)
);

create table public.history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  type text not null check (type in ('added','opened','bookmark')),
  page int check (page is null or page >= 1),
  created_at timestamptz not null default now()
);
create index on public.history (owner_id, created_at desc);

-- ---------- server-side rules that the browser cannot skip ----------
-- Bookmark must be for a book the user owns, on a real page.
create or replace function public.check_bookmark() returns trigger
language plpgsql security definer set search_path = public as $$
declare b public.books;
begin
  select * into b from public.books where id = new.book_id;
  if b.id is null or b.owner_id <> auth.uid() then raise exception 'Not your book'; end if;
  if b.page_count is not null and new.page > b.page_count then raise exception 'Page is past the end of the book'; end if;
  return new;
end $$;
create trigger bookmark_check before insert or update on public.bookmarks
  for each row execute function public.check_bookmark();

-- History must be for the user's own book; keep only the latest 200 entries.
create or replace function public.check_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.books where id = new.book_id and owner_id = auth.uid()) then
    raise exception 'Not your book';
  end if;
  return new;
end $$;
create trigger history_check before insert on public.history
  for each row execute function public.check_history();

create or replace function public.trim_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.history where id in (
    select id from public.history where owner_id = new.owner_id
    order by created_at desc offset 200);
  return null;
end $$;
create trigger history_trim after insert on public.history
  for each row execute function public.trim_history();

-- Upload throttle: at most 20 books per hour per person.
create or replace function public.throttle_books() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.books where owner_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many uploads. Please try again in a few minutes.';
  end if;
  return new;
end $$;
create trigger books_throttle before insert on public.books
  for each row execute function public.throttle_books();

-- Owner can see only a COUNT of accounts, never anyone's content.
create or replace function public.account_count() returns int
language sql security definer set search_path = public stable as $$
  select case when public.is_owner() then (select count(*)::int from public.profiles) else null end
$$;

-- ---------- row-level security ----------
alter table public.profiles      enable row level security;
alter table public.business_info enable row level security;
alter table public.books         enable row level security;
alter table public.bookmarks     enable row level security;
alter table public.history       enable row level security;

-- profiles: read own; change display name only (role can never be changed from the app)
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- business_info: anyone may read (public privacy page); only the owner may edit
create policy bi_select on public.business_info for select to anon, authenticated using (true);
create policy bi_update_owner on public.business_info for update to authenticated using (public.is_owner()) with check (public.is_owner());
revoke all on public.business_info from anon, authenticated;
grant select on public.business_info to anon, authenticated;
grant update (terms, privacy_policy, retention, support_contact, business_contact) on public.business_info to authenticated;

-- books: own rows only; uploading requires a verified email
create policy books_select on public.books for select to authenticated using (owner_id = auth.uid());
create policy books_insert on public.books for insert to authenticated with check (owner_id = auth.uid() and public.is_verified());
create policy books_update on public.books for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy books_delete on public.books for delete to authenticated using (owner_id = auth.uid());
revoke all on public.books from anon, authenticated;
grant select, delete on public.books to authenticated;
grant insert (id, title, file_path, file_size, page_count) on public.books to authenticated;
grant update (title, page_count, last_page, last_opened) on public.books to authenticated;

-- bookmarks
create policy bm_select on public.bookmarks for select to authenticated using (owner_id = auth.uid());
create policy bm_insert on public.bookmarks for insert to authenticated with check (owner_id = auth.uid());
create policy bm_delete on public.bookmarks for delete to authenticated using (owner_id = auth.uid());
revoke all on public.bookmarks from anon, authenticated;
grant select, delete on public.bookmarks to authenticated;
grant insert (book_id, page, note) on public.bookmarks to authenticated;

-- history
create policy hist_select on public.history for select to authenticated using (owner_id = auth.uid());
create policy hist_insert on public.history for insert to authenticated with check (owner_id = auth.uid());
revoke all on public.history from anon, authenticated;
grant select on public.history to authenticated;
grant insert (book_id, type, page) on public.history to authenticated;

revoke all on function public.account_count() from public, anon;
grant execute on function public.account_count() to authenticated;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;
revoke all on function public.is_verified() from public, anon;
grant execute on function public.is_verified() to authenticated;

-- ---------- private file storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('books', 'books', false, 52428800, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 52428800, allowed_mime_types = array['application/pdf'];

-- Files live in a folder named after the user's id. Each user can touch only their own folder.
create policy books_files_select on storage.objects for select to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);
create policy books_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text and public.is_verified());
create policy books_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);
