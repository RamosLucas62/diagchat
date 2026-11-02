alter table app.invoices drop constraint invoices_status_check;
alter table app.invoices add constraint invoices_status_check check(status in ('open','paid','refunded','partially_refunded','disputed'));
alter table app.clients add column asaas_customer_id text not null default '';
create unique index clients_asaas_customer_unique on app.clients(asaas_customer_id) where asaas_customer_id<>'';
create table app.asaas_settings (
 id boolean primary key default true check(id), enabled boolean not null default false,
 fiscal jsonb not null default '{}', updated_at timestamptz not null default now()
);
insert into app.asaas_settings(id) values(true);
create table app.asaas_billing (
 invoice_id uuid primary key references app.invoices(id),
 environment text not null check(environment in ('sandbox','production')),
 customer_id text not null, fiscal jsonb not null,
 status text not null default 'pending' check(status in ('pending','working','waiting','ready','review')),
 payment_id text unique, nf_id text unique, payment_attempted boolean not null default false, nf_attempted boolean not null default false,
 payment_status text, nf_status text, bank_slip_url text, invoice_url text, nf_pdf_url text, nf_xml_url text, nf_number text,
 boleto_pdf text, nf_pdf text, confirmed_at timestamptz, received_at timestamptz,
 gross_value numeric(12,2), net_value numeric(12,2), refund_value numeric(12,2) not null default 0,
 client_payment_date date, next_attempt_at timestamptz not null default now(), locked_at timestamptz,
 last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table app.asaas_events (
 event_id text primary key, event text not null, resource_id text not null,
 environment text not null, received_at timestamptz not null default now(), processed_at timestamptz,
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(), last_error text
);
create index asaas_events_pending on app.asaas_events(next_attempt_at) where processed_at is null;
alter table app.asaas_settings enable row level security;
alter table app.asaas_billing enable row level security;
alter table app.asaas_events enable row level security;

revoke all on app.asaas_settings,app.asaas_billing,app.asaas_events from public;
