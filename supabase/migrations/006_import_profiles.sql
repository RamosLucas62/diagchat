create table app.import_profiles (
 client_id uuid primary key references app.clients(id) on delete cascade,
 config jsonb not null,version integer not null default 1,updated_at timestamptz not null default now()
);
create table app.import_batches (
 id uuid primary key default gen_random_uuid(),client_id uuid not null references app.clients(id) on delete cascade,
 request_key uuid not null,file_name text not null,file_base64 text not null,
 chosen_template text not null default '',revision integer not null default 0,profile_version integer not null default 0,
 status text not null check(status in ('ready','review','submitted')),result jsonb not null,
 overrides jsonb not null default '{}',ignored_rows jsonb not null default '[]',
 campaign_ids jsonb not null default '[]',requested_at timestamptz,consent_at timestamptz,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '7 days',
 unique(client_id,request_key),check(length(file_base64)<=14000000)
);
create index import_batches_review on app.import_batches(created_at desc) where requested_at is not null;
alter table app.campaigns add column import_batch_id uuid references app.import_batches(id) on delete set null;
alter table app.campaigns add column import_segment text;
alter table app.campaigns add column import_template_signature text;
create unique index campaigns_import_segment on app.campaigns(import_batch_id,import_segment);
alter table app.messages add column source_rows jsonb not null default '[]';
revoke all on app.import_profiles,app.import_batches from public;
