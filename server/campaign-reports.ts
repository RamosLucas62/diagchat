import type {DB} from './db.js';
import {groupReport} from './group-report.js';
// Called under the maintenance advisory lock. One imported request is one reporting group,
// even when templates, repeated phones or schedules require multiple queue campaigns.
export async function queueCampaignReports(db:DB){
 // Hold legacy per-segment notices before any outbox sender can pick them up,
 // including while other segments of the same request are still running.
 await db.query(`update app.outbox o set status='held',last_error='Aviso de lote substituído pelo relatório consolidado da solicitação.'
  from app.campaigns p where o.kind='group' and o.reference_id=p.id and p.report_group_id is not null
  and p.report_group_id<>p.id and o.status='pending' and o.first_attempt_at is null`);
 const finalize=async(id:string)=>{await db.query('update app.campaigns set report_finalized_at=coalesce(report_finalized_at,now()) where coalesce(report_group_id,id)=$1',[id]);};
 const groups=(await db.query(`with groups as (
  select coalesce(report_group_id,id) as id,client_id,coalesce(max(report_name),min(name)) as name,
   now() as completed_at,bool_and(status in ('completed','cancelled')) as finished,bool_and(report_finalized_at is not null) as finalized
  from app.campaigns group by coalesce(report_group_id,id),client_id
 ) select g.* from groups g where g.finished and not g.finalized
 and not exists(select 1 from app.outbox o where o.kind='group' and o.reference_id=g.id)
 and not exists(select 1 from app.messages m join app.campaigns p on p.id=m.campaign_id
  where coalesce(p.report_group_id,p.id)=g.id and m.state in ('queued','sending','unknown'))`)).rows;
 for(const group of groups){
  // Upgrade compatibility: suppress obsolete unsent segment notices. If a provider attempt
  // already happened, do not send an additional report for that old request.
  const legacy=(await db.query(`select o.* from app.outbox o join app.campaigns p on p.id=o.reference_id
   where o.kind='group' and coalesce(p.report_group_id,p.id)=$1 and o.reference_id<>$1`,[group.id])).rows;
  if(legacy.some(item=>item.first_attempt_at||['sent','sending','review'].includes(item.status))){await finalize(group.id);continue;}
  const [row]=(await db.query(`select c.name,c.group_id,c.overage_mode,coalesce(u.accepted,0) as accepted,
   coalesce(u.reserved,0) as reserved,coalesce(u.monthly_limit,c.monthly_limit) as monthly_limit,
   coalesce(u.period,app.current_period())::text as period,
   (select count(*)::int from app.messages m join app.campaigns p on p.id=m.campaign_id where coalesce(p.report_group_id,p.id)=$2) as total,
   (select count(*)::int from app.messages m join app.campaigns p on p.id=m.campaign_id where coalesce(p.report_group_id,p.id)=$2 and m.state='accepted') as sent,
   (select count(*)::int from app.messages m join app.campaigns p on p.id=m.campaign_id where coalesce(p.report_group_id,p.id)=$2 and m.state='failed') as failed,
   (select count(*)::int from app.messages m join app.campaigns p on p.id=m.campaign_id where coalesce(p.report_group_id,p.id)=$2 and m.state='cancelled') as cancelled
   from app.clients c left join app.usage u on u.client_id=c.id and u.period=app.current_period() where c.id=$1`,[group.client_id,group.id])).rows;
  if(row?.group_id)await db.query(`insert into app.outbox(kind,reference_id,payload) values('group',$1,$2) on conflict do nothing`,[group.id,JSON.stringify({number:row.group_id,text:groupReport({clientName:row.name,campaignName:group.name,completedAt:group.completed_at,period:row.period,total:row.total,sent:row.sent,failed:row.failed,cancelled:row.cancelled,accepted:row.accepted,reserved:row.reserved,monthlyLimit:row.monthly_limit,overageMode:row.overage_mode})})]);
  await finalize(group.id);
 }
}
