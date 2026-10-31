import { config } from './config.js';
import { query,transaction } from './db.js';
import { sendMeta } from './meta.js';
import {queueInvoiceEmail} from './billing.js';
import {ensureInvoiceReport,reportAttachment} from './reports.js';
export async function dispatchOne() {
 const [{job}]=await query('select app.claim_message() as job');if(!job)return false;
 let result;try{result=await sendMeta(job);}catch{result={state:'unknown',id:null,error:'Resposta incerta. Aguardando webhook; não reenviar automaticamente.'};}
 await query('select app.finish_message($1,$2,$3,$4)',[job.message.id,result.state,result.id,result.error]);return true;
}
export async function maintenance() {
 await query(`update app.messages set state='unknown',error='Processo interrompido; aguardando confirmação da Meta.' where state='sending' and claimed_at<now()-interval '2 minutes'`);
 await transaction(async db=>{
  // Serialized monthly closing and completion: two workers cannot queue the same notice.
  await db.query('select pg_advisory_xact_lock(827462)');
  await db.query(`insert into app.usage(client_id,period,monthly_limit,monthly_fee,overage_rate,plan_name) select id,app.current_period(),monthly_limit,monthly_fee,overage_rate,plan_name from app.clients where active on conflict do nothing`);
  const completed=(await db.query(`update app.campaigns p set status='completed',completed_at=now() where status in ('running','blocked') and not exists(select 1 from app.messages m where m.campaign_id=p.id and m.state in ('queued','sending','unknown')) returning *`)).rows;
  for(const p of completed){
   const [row]=(await db.query(`select c.name,c.group_id,c.overage_mode,u.accepted,u.monthly_limit,(select count(*) from app.messages where campaign_id=$2 and state='accepted')::int as sent,(select count(*) from app.messages where campaign_id=$2 and state='failed')::int as failed,(select count(*) from app.messages where campaign_id=$2 and state='cancelled')::int as cancelled from app.clients c left join app.usage u on u.client_id=c.id and u.period=app.current_period() where c.id=$1`,[p.client_id,p.id])).rows;
   if(row.group_id)await db.query(`insert into app.outbox(kind,reference_id,payload) values('group',$1,$2) on conflict do nothing`,[p.id,JSON.stringify({number:row.group_id,text:`✅ Disparo concluído — ${row.name}\nCampanha: ${p.name}\nAceitos pela Meta: ${row.sent}\nFalhas de envio: ${row.failed}\nCancelados: ${row.cancelled}\nConsumo do mês: ${row.accepted}\nSaldo do plano: ${Math.max(0,row.monthly_limit-row.accepted)}\nExcedentes: ${Math.max(0,row.accepted-row.monthly_limit)}\nEntregas e leituras continuam sendo atualizadas no portal.`})]);
  }
  const invoices=(await db.query(`insert into app.invoices(client_id,period,base_amount,overage_count,overage_amount,total,due_date,plan_name)
   select u.client_id,u.period,u.monthly_fee,greatest(0,u.accepted-u.monthly_limit),round(greatest(0,u.accepted-u.monthly_limit)*u.overage_rate,2),u.monthly_fee+round(greatest(0,u.accepted-u.monthly_limit)*u.overage_rate,2),(u.period+interval '1 month')::date+c.due_day-1,coalesce(nullif(u.plan_name,''),c.plan_name)
   from app.usage u join app.clients c on c.id=u.client_id where u.period<app.current_period() and u.reserved=0 on conflict do nothing returning *`)).rows;
  for(const invoice of invoices){await ensureInvoiceReport(db,invoice.id);await queueInvoiceEmail(db,invoice.id,true);}
 });
 // Inbox reconciliation also handles webhook arriving before the HTTP response is persisted.
 const events=await query('select * from app.webhook_events where processed_at is null order by created_at limit 100');
 for(const event of events)await transaction(async db=>{
  const [m]=(await db.query('select * from app.messages where client_id=$1 and (provider_id=$2 or id::text=$3) for update',[event.client_id,event.provider_id,event.message_ref])).rows;if(!m)return;
  if(['sending','unknown'].includes(m.state))await db.query('select app.finish_message($1,\'accepted\',$2)',[m.id,event.provider_id]);
  const ranks:Record<string,number>={pending:0,sent:1,failed:2,delivered:3,read:4};
  if((ranks[event.status]||0)>(ranks[m.delivery]||0))await db.query('update app.messages set delivery=$2 where id=$1',[m.id,event.status]);
  await db.query('update app.webhook_events set processed_at=now() where event_key=$1',[event.event_key]);
 });
 await query(`update app.outbox set status=case when kind='invoice' and first_attempt_at>now()-interval '23 hours' then 'pending' else 'review' end,last_error='Execução interrompida; verificar provedor.' where status='sending' and locked_at<now()-interval '2 minutes'`);
}
export async function processOutbox() {
 const [item]=await query(`update app.outbox set status='sending',locked_at=now(),attempts=attempts+1 where id=(select id from app.outbox where status='pending' and next_attempt_at<=now() order by next_attempt_at for update skip locked limit 1) returning *`);if(!item)return;
 if(item.kind==='invoice'){
  const [state]=await query(`select i.status,coalesce(s.auto_send,true) as auto_send from app.invoices i left join app.billing_email_settings s on s.client_id=i.client_id where i.id=$1`,[item.reference_id]);
  // Some legacy/manual outbox records may no longer have an invoice: hold rather than send orphaned bills.
  if(!state||state.status==='paid'||(item.automatic&&!state.auto_send)){
   await query("update app.outbox set status='held',last_error=$2 where id=$1",[item.id,!state?'Cobrança não encontrada.':state.status==='paid'?'Cobrança já paga.':'Envio automático desativado para este cliente.']);return;
  }
 }
 const ready=item.kind==='invoice'?config.resend&&config.from:config.evolution&&config.evolutionKey&&config.evolutionInstance;
 if(!ready){await query(`update app.outbox set status='pending',next_attempt_at=now()+interval '5 minutes',last_error='Configuração da integração pendente' where id=$1`,[item.id]);return;}
 if(item.kind==='invoice'&&item.first_attempt_at&&Date.now()-new Date(item.first_attempt_at).getTime()>23*3600000){await query(`update app.outbox set status='review',last_error='Janela de idempotência encerrada; confira o Resend antes de reenviar.' where id=$1`,[item.id]);return;}
 if(item.kind==='invoice'&&!item.first_attempt_at&&!item.payload.attachments?.length){try{const report=await transaction(db=>ensureInvoiceReport(db,item.reference_id));item.payload.attachments=[reportAttachment(report)];}catch{await query("update app.outbox set status='review',last_error='Não foi possível gerar o relatório mensal. Nenhum e-mail foi enviado.' where id=$1",[item.id]);return;}}
 if(item.kind==='invoice'&&!item.payload.from)item.payload.from=config.from;
 await query('update app.outbox set first_attempt_at=coalesce(first_attempt_at,now()),payload=$2 where id=$1',[item.id,JSON.stringify(item.payload)]);
 try{
  const response=await fetch(item.kind==='invoice'?'https://api.resend.com/emails':`${config.evolution}/message/sendText/${encodeURIComponent(config.evolutionInstance!)}`,{method:'POST',headers:item.kind==='invoice'?{Authorization:`Bearer ${config.resend}`,'Content-Type':'application/json','Idempotency-Key':`invoice/${item.reference_id}`}:{apikey:config.evolutionKey!,'Content-Type':'application/json'},body:JSON.stringify(item.payload),signal:AbortSignal.timeout(20000)});
  const body:any=await response.json();if(!response.ok)throw new Error(`Provedor HTTP ${response.status}`);
  await query(`update app.outbox set status='sent',provider_id=$2,last_error=null where id=$1`,[item.id,body.id||body.key?.id||null]);
 }catch(e){const retry=item.kind==='invoice'&&item.attempts<8;await query(`update app.outbox set status=$2,last_error=$3,next_attempt_at=now()+interval '10 minutes' where id=$1`,[item.id,retry?'pending':'review',e instanceof Error?e.message:'Falha de comunicação']);}
}
