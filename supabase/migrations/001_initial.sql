-- Private schema: browser/API roles have no direct access, including credentials.
create schema if not exists app;
revoke all on schema app from public;
create table app.admins (user_id uuid primary key, created_at timestamptz not null default now());
create table app.clients (
 id uuid primary key default gen_random_uuid(), name text not null, email text not null,
 photo_url text not null default '', waba_id text not null, phone_id text not null unique,
 token_enc text not null, secret_enc text not null, verify_token text not null,
 group_id text not null default '', throughput integer not null check(throughput between 1 and 1000),
 plan_name text not null, monthly_limit integer not null check(monthly_limit>=0),
 monthly_fee numeric(12,2) not null check(monthly_fee>=0), overage_mode text not null check(overage_mode in ('block','charge')),
 overage_rate numeric(12,4) not null check(overage_rate>=0), cost_rate numeric(12,6) not null default 0 check(cost_rate>=0),
 due_day integer not null default 10 check(due_day between 1 and 28), active boolean not null default true,
 portal_hash text not null unique, next_dispatch_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table app.usage (
 client_id uuid references app.clients(id), period date not null, accepted integer not null default 0 check(accepted>=0),
 reserved integer not null default 0 check(reserved>=0), monthly_limit integer not null,
 monthly_fee numeric(12,2) not null, overage_rate numeric(12,4) not null, cost numeric(14,6) not null default 0,
 primary key(client_id,period)
);
create table app.campaigns (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references app.clients(id), name text not null,
 template_name text not null, language text not null, status text not null default 'pending' check(status in ('pending','running','paused','blocked','completed','cancelled')),
 scheduled_at timestamptz not null default now(), consent_confirmed boolean not null check(consent_confirmed),
 created_at timestamptz not null default now(), completed_at timestamptz,
 request_key uuid not null unique, source text not null default 'admin'
);
create table app.messages (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references app.campaigns(id),
 client_id uuid not null references app.clients(id), phone text not null, variables jsonb not null default '[]',
 state text not null default 'queued' check(state in ('queued','sending','accepted','failed','unknown','cancelled')),
 delivery text not null default 'pending' check(delivery in ('pending','sent','delivered','read','failed')),
 provider_id text unique, period date, cost_rate numeric(12,6), claimed_at timestamptz, accepted_at timestamptz,
 error text, unique(campaign_id,phone)
);
create index messages_queue on app.messages(client_id,state,campaign_id);
create index messages_metrics on app.messages(accepted_at,client_id);
create table app.webhook_events (
 event_key text primary key, client_id uuid not null references app.clients(id), provider_id text not null,
 status text not null, message_ref text, occurred_at timestamptz not null, processed_at timestamptz, created_at timestamptz not null default now()
);
create table app.suppressions (client_id uuid references app.clients(id), phone text not null, primary key(client_id,phone));
create table app.invoices (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references app.clients(id), period date not null,
 base_amount numeric(12,2) not null, overage_count integer not null, overage_amount numeric(12,2) not null,
 total numeric(12,2) not null, due_date date not null, status text not null default 'open' check(status in ('open','paid')),
 paid_at timestamptz, created_at timestamptz not null default now(), unique(client_id,period)
);
create table app.outbox (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('invoice','group')),
 reference_id uuid not null, payload jsonb not null, status text not null default 'pending' check(status in ('pending','sending','sent','review')),
 attempts integer not null default 0, first_attempt_at timestamptz, next_attempt_at timestamptz not null default now(),
 locked_at timestamptz, last_error text, provider_id text, unique(kind,reference_id)
);
create table app.audit (id bigint generated always as identity primary key, actor text not null, action text not null, target_id uuid, created_at timestamptz not null default now());

create function app.current_period() returns date language sql stable as $$
 select date_trunc('month',now() at time zone 'America/Sao_Paulo')::date
$$;
create function app.ensure_usage(p_client uuid) returns void language sql as $$
 insert into app.usage(client_id,period,monthly_limit,monthly_fee,overage_rate)
 select id,app.current_period(),monthly_limit,monthly_fee,overage_rate from app.clients where id=p_client
 on conflict do nothing
$$;
-- One row lock per customer makes quota reservation and rate pacing atomic across workers.
create function app.claim_message() returns jsonb language plpgsql as $$
declare c app.clients; u app.usage; m app.messages; campaign app.campaigns;
begin
 for c in select * from app.clients where active and next_dispatch_at<=clock_timestamp()
   and exists(select 1 from app.messages queued join app.campaigns p on p.id=queued.campaign_id
     where queued.client_id=app.clients.id and queued.state='queued' and p.status in ('running','blocked') and p.scheduled_at<=now())
   order by next_dispatch_at for update skip locked limit 32
 loop
  perform app.ensure_usage(c.id);
  select * into u from app.usage where client_id=c.id and period=app.current_period() for update;
  if c.overage_mode='block' and u.accepted+u.reserved>=u.monthly_limit then
   update app.campaigns set status='blocked' where client_id=c.id and status='running';
   update app.clients set next_dispatch_at=now()+interval '5 seconds' where id=c.id;
   continue;
  end if;
  select m0.* into m from app.messages m0 join app.campaigns p on p.id=m0.campaign_id
    where m0.client_id=c.id and m0.state='queued' and p.status in ('running','blocked') and p.scheduled_at<=now()
    order by p.created_at,m0.id for update of m0 skip locked limit 1;
  if not found then continue; end if;
  if exists(select 1 from app.suppressions where client_id=c.id and phone=m.phone) then
   update app.messages set state='cancelled',error='Contato removido: opt-out' where id=m.id;
   continue;
  end if;
  update app.messages set state='sending',period=u.period,cost_rate=c.cost_rate,claimed_at=now() where id=m.id returning * into m;
  update app.usage set reserved=reserved+1 where client_id=c.id and period=u.period;
  update app.clients set next_dispatch_at=clock_timestamp()+make_interval(secs=>1.0/c.throughput) where id=c.id;
  update app.campaigns set status='running' where id=m.campaign_id and status='blocked';
  select * into campaign from app.campaigns where id=m.campaign_id;
  return jsonb_build_object('message',to_jsonb(m),'client',to_jsonb(c),'campaign',to_jsonb(campaign));
 end loop;
 return null;
end $$;
create function app.finish_message(p_id uuid,p_state text,p_provider text default null,p_error text default null) returns void language plpgsql as $$
declare m app.messages;
begin
 if p_state not in ('accepted','failed','unknown') then raise exception 'Invalid state'; end if;
 select * into m from app.messages where id=p_id for update;
 if not found or m.state not in ('sending','unknown') then return; end if;
 if p_state='unknown' then
  update app.messages set state='unknown',error=p_error where id=p_id;
  return;
 end if;
 update app.messages set state=p_state,provider_id=coalesce(p_provider,provider_id),error=p_error,
   accepted_at=case when p_state='accepted' then now() else null end where id=p_id;
 update app.usage set reserved=reserved-1,accepted=accepted+case when p_state='accepted' then 1 else 0 end,
   cost=cost+case when p_state='accepted' then m.cost_rate else 0 end where client_id=m.client_id and period=m.period;
end $$;
-- Functions are private too. Application uses the database connection, never browser RPC.
revoke all on all tables in schema app from public;
revoke all on all functions in schema app from public;
