alter table push_subscriptions add column tz text;
alter publication supabase_realtime add table items;  -- live updates between devices
