alter table lists add column grp text;          -- group name, e.g. 'Classes'
alter table lists add column external_id text;  -- Google course id, so renaming never duplicates a course list
create unique index lists_external on lists (user_id, external_id) where external_id is not null;

-- Put your existing Classroom course lists into a "Classes" group
update lists set grp = 'Classes'
where id in (select distinct list_id from items where source = 'classroom' and list_id is not null);
