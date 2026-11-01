-- Uploaded files live in the database (no separate file storage service to pay for).
-- Only the server uses this table, through the owner role.
create table file_blobs (
  key         text primary key,
  data        bytea not null,
  size_bytes  int not null,
  created_at  timestamptz not null default now()
);
revoke all on file_blobs from dd_app;
