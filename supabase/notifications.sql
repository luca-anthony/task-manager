alter table items add column notified_at timestamptz;

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
alter table push_subscriptions enable row level security;
create policy "own subs" on push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Fill in YOUR-SITE and YOUR_CRON_SECRET, then run this part.
select cron.schedule('send-reminders', '* * * * *', $$
  select net.http_post(
    url := 'https://schooltaskmanager.vercel.app/api/send-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer oeiwjofjowjecqwieuncopqjwepoijfpoiqnwecinqpwoiejfqwnecpoijapoijsdnokef')
  );
$$);
