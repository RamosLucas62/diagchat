alter table app.usage add column plan_name text not null default '';
update app.usage u set plan_name=c.plan_name from app.clients c where c.id=u.client_id;
alter table app.invoices add column plan_name text not null default '';
update app.invoices i set plan_name=coalesce(u.plan_name,c.plan_name) from app.clients c left join app.usage u on u.client_id=c.id where c.id=i.client_id and (u.period=i.period or u.period is null);
create or replace function app.ensure_usage(p_client uuid) returns void language sql as $$
 insert into app.usage(client_id,period,monthly_limit,monthly_fee,overage_rate,plan_name)
 select id,app.current_period(),monthly_limit,monthly_fee,overage_rate,plan_name from app.clients where id=p_client
 on conflict do nothing
$$;
revoke all on function app.ensure_usage(uuid) from public;
create table app.invoice_reports (
 invoice_id uuid primary key references app.invoices(id) on delete cascade,
 snapshot jsonb not null,pdf_base64 text not null,sha256 text not null,
 created_at timestamptz not null default now(),check(length(pdf_base64)<3000000)
);
revoke all on app.invoice_reports from public;
