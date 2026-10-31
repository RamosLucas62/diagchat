create table app.admin_sessions (
 token_hash text primary key,user_id uuid not null references app.admins(user_id) on delete cascade,
 access_enc text not null,refresh_enc text not null,access_expires_at timestamptz not null,
 expires_at timestamptz not null,created_at timestamptz not null default now()
);
create index admin_sessions_expiry on app.admin_sessions(expires_at);
revoke all on app.admin_sessions from public;
