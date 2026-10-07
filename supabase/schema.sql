create table lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  color text not null default '#6366f1',
  created_at timestamptz default now(),
  unique (user_id, name)
);

create table items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  list_id uuid references lists on delete set null,
  title text not null,
  notes text,
  type text not null default 'task' check (type in ('task','event','assignment')),
  source text not null default 'manual',      -- manual | classroom | makemusic
  external_id text,                           -- used later to dedupe synced items
  due_at timestamptz,
  remind_at timestamptz,
  done boolean not null default false,
  created_at timestamptz default now(),
  unique (user_id, source, external_id)
);
create index on items (user_id, due_at);
create index on items (remind_at) where done = false;

alter table lists enable row level security;
alter table items enable row level security;
create policy "own lists" on lists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own items" on items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
