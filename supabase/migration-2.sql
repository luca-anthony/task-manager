alter table items
  add column ends_at timestamptz,
  add column all_day boolean not null default false,
  add column repeat_rule text not null default 'none'
    check (repeat_rule in ('none','daily','weekdays','weekends','weekly','monthly','custom')),
  add column repeat_days int[];
