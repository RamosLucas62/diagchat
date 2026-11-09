-- Row failures are durable outcomes, not messages awaiting a provider attempt.
-- Keep the original worksheet and Excel row even after the source workbook expires.
create table app.import_failures (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references app.campaigns(id),
 client_id uuid not null references app.clients(id),
 report_group_id uuid not null,
 sheet_name text not null,
 row_number integer not null check(row_number>0),
 code text not null check(code in ('PHONE_INVALID','TIME_MISSING','TIME_INVALID')),
 message text not null,
 period date not null default app.current_period(),
 created_at timestamptz not null default now(),
 unique(report_group_id,sheet_name,row_number)
);
create index import_failures_campaign on app.import_failures(campaign_id,sheet_name,row_number);
create index import_failures_period on app.import_failures(client_id,period);
create index import_failures_created on app.import_failures(created_at,client_id);
alter table app.import_failures enable row level security;
revoke all on app.import_failures from public;
