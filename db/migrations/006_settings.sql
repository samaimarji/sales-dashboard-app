-- Step 4: settings.

-- Combining two records of the same rep: the extra record points at the one kept.
alter table people add column merged_into_id int references people(id) on delete set null;
create index people_merged_into on people (merged_into_id);
