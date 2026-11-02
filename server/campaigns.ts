import {query,transaction} from './db.js';
import {templates} from './meta.js';
import {templateSignature} from './import-plan.js';
export async function listCampaigns(clientId?:string){
 return query(`with scoped as (
  select p.*,coalesce(p.report_group_id,p.import_batch_id,p.id) as group_id from app.campaigns p
  where ($1::uuid is null or p.client_id=$1)
 ), groups as (
  select group_id as id,client_id,coalesce(max(report_name),(array_agg(name order by scheduled_at,created_at,name,id))[1]) as name,
   string_agg(distinct template_name,', ' order by template_name) as template_name,count(*)::int as segment_count,
   min(scheduled_at) as scheduled_at,max(scheduled_at) as scheduled_until,min(created_at) as created_at,
   case when bool_and(status='cancelled') then 'cancelled'
    when bool_and(status in ('completed','cancelled')) then 'completed'
    when bool_or(status='running') then 'running' when bool_or(status='blocked') then 'blocked'
    when bool_or(status='paused') then 'paused' else 'pending' end as status
  from scoped group by group_id,client_id
 ), totals as (
  select p.group_id,count(m.id)::int as total,count(*) filter(where m.state='accepted')::int as sent,
   count(*) filter(where m.delivery in ('delivered','read'))::int as delivered,count(*) filter(where m.delivery='read')::int as read,
   count(*) filter(where m.state='failed' or m.delivery='failed')::int as failed,count(*) filter(where m.state='unknown')::int as uncertain
  from scoped p left join app.messages m on m.campaign_id=p.id group by p.group_id
 ) select g.*,c.name as client_name,t.total,t.sent,t.delivered,t.read,t.failed,t.uncertain from groups g
 join app.clients c on c.id=g.client_id join totals t on t.group_id=g.id order by g.created_at desc,g.id limit 100`,[clientId||null]);
}
export async function campaignAction(id:string,action:'approve'|'pause'|'resume'|'cancel',actor:string){
 const [target]=await query('select client_id,coalesce(report_group_id,import_batch_id,id) as group_id from app.campaigns where id=$1 or coalesce(report_group_id,import_batch_id,id)=$1 limit 1',[id]);if(!target)return false;
 const allowed={approve:['pending'],pause:['running','blocked'],resume:['paused','blocked'],cancel:['pending','running','paused','blocked']}[action];
 const [client]=await query('select * from app.clients where id=$1',[target.client_id]);
 const available=['approve','resume'].includes(action)?await templates(client):[];
 await transaction(async db=>{
  const [locked]=(await db.query('select * from app.clients where id=$1 for update',[target.client_id])).rows;
  if(['approve','resume'].includes(action)&&!locked.active)throw new Error('Ative o cliente antes de iniciar.');
  if(['approve','resume'].includes(action)&&(locked.token_enc!==client.token_enc||locked.waba_id!==client.waba_id))throw new Error('A campanha mudou de estado. Atualize a página.');
  const children=(await db.query('select * from app.campaigns where coalesce(report_group_id,import_batch_id,id)=$1 order by id for update',[target.group_id])).rows.filter(p=>allowed.includes(p.status));
  if(!children.length)throw new Error('A campanha mudou de estado. Atualize a página.');
  if(['approve','resume'].includes(action))for(const p of children){const t=available.find(t=>t.name===p.template_name&&t.language===p.language&&t.supported);if(!t)throw new Error('Template indisponível na Meta.');if(p.import_template_signature&&p.import_template_signature!==templateSignature(t))throw new Error('O template mudou desde a importação. Reimporte a planilha com o perfil atualizado antes de enviar.');}
  const ids=children.map(p=>p.id);await db.query('update app.campaigns set status=$2 where id=any($1::uuid[])',[ids,{approve:'running',pause:'paused',resume:'running',cancel:'cancelled'}[action]]);
  if(action==='cancel')await db.query("update app.messages set state='cancelled' where campaign_id=any($1::uuid[]) and state='queued'",[ids]);
  await db.query('insert into app.audit(actor,action,target_id) values($1,$2,$3)',[actor,`campaign.${action}`,target.group_id]);
 });return true;
}
