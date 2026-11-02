import {ensureAsaasBilling} from './asaas.js';
import {recordError,safeErrorText} from './error-log.js';
import {queueCampaignReports} from './campaign-reports.js';
import { config } from './config.js';
import { query,transaction } from './db.js';
import { sendMeta } from './meta.js';
import {queueInvoiceEmail} from './billing.js';
import {ensureInvoiceReport,reportAttachment} from './reports.js';
export async function dispatchOne() {
 const [{job}]=await query('select app.claim_message() as job');if(!job)return false;
 let result;try{result=await sendMeta(job);}catch(e){result={state:'unknown',id:null,error:'Resposta incerta. Aguardando webhook; não reenviar automaticamente. '+safeErrorText(e)};}
 await query('select app.finish_message($1,$2,$3,$4)',[job.message.id,result.state,result.id,result.error]);if(result.state!=='accepted')await recordError({source:'meta',operation:'Enviar mensagem pela Cloud API',code:result.state,error:result.error,clientId:job.client.id,campaignId:job.campaign.id});return true;
}
export async function maintenance() {
 await query('delete from app.import_batches where expires_at<now()');
 const interrupted=await query(`update app.messages set state='unknown',error='Processo interrompido; aguardando confirmação da Meta.' where state='sending' and claimed_at<now()-interval '2 minutes' returning client_id,campaign_id`);for(const item of interrupted)await recordError({source:'worker',operation:'Recuperação de mensagem interrompida',code:'MESSAGE_UNKNOWN',error:'Processo interrompido; aguardando confirmação da Meta, sem reenvio automático.',clientId:item.client_id,campaignId:item.campaign_id});
 await transaction(async db=>{
  // Serialized monthly closing and completion: two workers cannot queue the same notice.
  await db.query('select pg_advisory_xact_lock(827462)');
  await db.query(`insert into app.usage(client_id,period,monthly_limit,monthly_fee,overage_rate,plan_name) select id,app.current_period(),monthly_limit,monthly_fee,overage_rate,plan_name from app.clients where active on conflict do nothing`);
  await db.query(`update app.campaigns p set status='completed',completed_at=now() where status in ('running','blocked') and not exists(select 1 from app.messages m where m.campaign_id=p.id and m.state in ('queued','sending','unknown'))`);
  await queueCampaignReports(db);
  const invoices=(await db.query(`insert into app.invoices(client_id,period,base_amount,overage_count,overage_amount,total,due_date,plan_name,late_interest_rate,late_interest_basis)
   select u.client_id,u.period,u.monthly_fee,greatest(0,u.accepted-u.monthly_limit),round(greatest(0,u.accepted-u.monthly_limit)*u.overage_rate,2),u.monthly_fee+round(greatest(0,u.accepted-u.monthly_limit)*u.overage_rate,2),(u.period+interval '1 month')::date+c.due_day-1,coalesce(nullif(u.plan_name,''),c.plan_name),c.late_interest_rate,c.late_interest_basis
   from app.usage u join app.clients c on c.id=u.client_id where u.period<app.current_period() and u.reserved=0 on conflict do nothing returning *`)).rows;
  for(const invoice of invoices){await ensureAsaasBilling(db,invoice);await ensureInvoiceReport(db,invoice.id);await queueInvoiceEmail(db,invoice.id,true);}
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
 const [item]=await query(`update app.outbox set status='sending',locked_at=now() where id=(select id from app.outbox where status='pending' and next_attempt_at<=now() order by next_attempt_at for update skip locked limit 1) returning *`);if(!item)return;
 if(item.kind==='invoice'){
  const [state]=await query(`select i.status,a.payment_status,coalesce(s.auto_send,true) as auto_send from app.invoices i left join app.asaas_billing a on a.invoice_id=i.id left join app.billing_email_settings s on s.client_id=i.client_id where i.id=$1`,[item.reference_id]);
  // Some legacy/manual outbox records may no longer have an invoice: hold rather than send orphaned bills.
  if(!state||(state.status!=='open'&&!(state.status==='paid'&&['CONFIRMED','RECEIVED','DUNNING_RECEIVED'].includes(state.payment_status)))||(item.automatic&&!state.auto_send)){
   await query("update app.outbox set status='held',last_error=$2 where id=$1",[item.id,!state?'Cobrança não encontrada.':state.status!=='open'?'Cobrança não está aberta para envio.':'Envio automático desativado para este cliente.']);return;
  }
 }
 if(item.kind==='invoice'&&!item.first_attempt_at){
  const documents=await transaction(async db=>{const [invoice]=(await db.query('select * from app.invoices where id=$1 for update',[item.reference_id])).rows;return ensureAsaasBilling(db,invoice);});
  if(documents){
   if(documents.status!=='ready'||!documents.boleto_pdf||!documents.nf_pdf){await query("update app.outbox set status=$2,next_attempt_at=now()+interval '5 minutes',last_error=$3 where id=$1",[item.id,documents.status==='review'?'review':'pending',documents.last_error||'Aguardando boleto e nota fiscal do Asaas.']);return;}
   const report=await transaction(db=>ensureInvoiceReport(db,item.reference_id));item.payload.attachments=[reportAttachment(report),{filename:'boleto.pdf',content:documents.boleto_pdf},{filename:'nota-fiscal.pdf',content:documents.nf_pdf}];item.payload.text+='\n\nBoleto e nota fiscal seguem em anexo.';if(['CONFIRMED','RECEIVED','DUNNING_RECEIVED'].includes(documents.payment_status))item.payload.text+='\nPagamento já confirmado pelo Asaas. Não efetue um novo pagamento.';
  }
 }
 const ready=item.kind==='invoice'?config.resend&&config.from:config.evolution&&config.evolutionKey&&config.evolutionInstance;
 if(!ready){await recordError({source:item.kind==='invoice'?'resend':'evolution',operation:'Enviar notificação',code:'CONFIGURATION',error:'Configuração da integração pendente.'});await query(`update app.outbox set status='pending',next_attempt_at=now()+interval '5 minutes',last_error='Configuração da integração pendente' where id=$1`,[item.id]);return;}
 if(item.kind==='invoice'&&item.first_attempt_at&&Date.now()-new Date(item.first_attempt_at).getTime()>23*3600000){await query(`update app.outbox set status='review',last_error='Janela de idempotência encerrada; confira o Resend antes de reenviar.' where id=$1`,[item.id]);return;}
 if(item.kind==='invoice'&&!item.first_attempt_at&&!item.payload.attachments?.length){try{const report=await transaction(db=>ensureInvoiceReport(db,item.reference_id));item.payload.attachments=[reportAttachment(report)];}catch{await query("update app.outbox set status='review',last_error='Não foi possível gerar o relatório mensal. Nenhum e-mail foi enviado.' where id=$1",[item.id]);return;}}
 if(item.kind==='invoice'&&!item.payload.from)item.payload.from=config.from;
 await query('update app.outbox set attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),payload=$2 where id=$1',[item.id,JSON.stringify(item.payload)]);
 try{
  const response=await fetch(item.kind==='invoice'?'https://api.resend.com/emails':`${config.evolution}/message/sendText/${encodeURIComponent(config.evolutionInstance!)}`,{method:'POST',headers:item.kind==='invoice'?{Authorization:`Bearer ${config.resend}`,'Content-Type':'application/json','Idempotency-Key':`invoice/${item.reference_id}`}:{apikey:config.evolutionKey!,'Content-Type':'application/json'},body:JSON.stringify(item.payload),signal:AbortSignal.timeout(20000)});
  const body:any=await response.json();if(!response.ok)throw new Error(`Provedor HTTP ${response.status}: ${body.message||body.error?.message||body.error||'Resposta sem descrição'}`);
  await query(`update app.outbox set status='sent',provider_id=$2,last_error=null where id=$1`,[item.id,body.id||body.key?.id||null]);
 }catch(e){await recordError({source:item.kind==='invoice'?'resend':'evolution',operation:'Enviar notificação',code:'PROVIDER_ERROR',error:e,details:'Registro da fila: '+item.id});const retry=item.kind==='invoice'&&item.attempts+1<8;await query(`update app.outbox set status=$2,last_error=$3,next_attempt_at=now()+interval '10 minutes' where id=$1`,[item.id,retry?'pending':'review',e instanceof Error?e.message:'Falha de comunicação']);}
}
