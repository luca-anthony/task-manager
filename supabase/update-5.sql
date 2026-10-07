-- Optional one-time backfill: give existing, unfinished Classroom assignments a 4 PM day-before alert.
-- Change America/Chicago if your time zone is different.
update items
set remind_at = (((due_at at time zone 'America/Chicago')::date - 1 + time '16:00') at time zone 'America/Chicago')
where source = 'classroom' and done = false and remind_at is null and due_at is not null
  and (((due_at at time zone 'America/Chicago')::date - 1 + time '16:00') at time zone 'America/Chicago') > now();
