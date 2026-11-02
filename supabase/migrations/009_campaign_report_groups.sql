-- Report grouping survives expiration/deletion of the uploaded workbook.
alter table app.campaigns add column report_group_id uuid;
alter table app.campaigns add column report_name text;
alter table app.campaigns add column report_finalized_at timestamptz;
with names as (
 select import_batch_id,(array_agg(name order by scheduled_at,created_at,name,id))[1] as name
 from app.campaigns where import_batch_id is not null group by import_batch_id
)
update app.campaigns p set report_group_id=p.import_batch_id,report_name=n.name from names n where n.import_batch_id=p.import_batch_id;
create index campaigns_report_group on app.campaigns((coalesce(report_group_id,id)));

-- Do not retroactively notify old finished requests. Unsent segment notices can
-- still be replaced by one consolidated notice during the upgrade.
with finished as (
 select coalesce(report_group_id,id) as id from app.campaigns
 group by coalesce(report_group_id,id) having bool_and(status in ('completed','cancelled'))
)
update app.campaigns p set report_finalized_at=now() from finished f
where coalesce(p.report_group_id,p.id)=f.id and not exists(
 select 1 from app.outbox o join app.campaigns child on child.id=o.reference_id
 where o.kind='group' and coalesce(child.report_group_id,child.id)=f.id
 and child.report_group_id is not null and o.status='pending' and o.first_attempt_at is null
);
