-- Step 5: logins and roles.

alter table users add column must_change_password boolean not null default false;
alter table users add column last_login_at timestamptz;
create unique index users_email_ci on users (lower(email));
create index sessions_user on sessions (user_id);
create index sessions_expires on sessions (expires_at);

-- Failed logins, to slow down password guessing.
create table login_attempts (
  id         bigserial primary key,
  email      text not null,
  ip         text,
  succeeded  boolean not null,
  at         timestamptz not null default now()
);
create index login_attempts_email_at on login_attempts (lower(email), at desc);
