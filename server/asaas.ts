import {config,demo} from './config.js';
import {query,transaction,type DB} from './db.js';
import {recordError,safeErrorText} from './error-log.js';
import {fiscalSchema} from '../shared/asaas.js';
const date=(v:any)=>new Date(v).toISOString().slice(0,10);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function asaasRequest(path:string,method='GET',body?:unknown):Promise<any>{
 if(!config.asaasKey)throw new Error('Configure ASAAS_API_KEY no servidor.');
 if(demo&&!process.env.ASAAS_TEST)throw new Error('Asaas real desabilitado na demonstração.');
 if(!['sandbox','production'].includes(config.asaasEnvironment))throw new Error('Ambiente Asaas inválido.');
 const base=config.asaasEnvironment==='production'?'https://api.asaas.com/v3':'https://api-sandbox.asaas.com/v3';
 const response=await fetch(base+path,{method,headers:{access_token:config.asaasKey,'User-Agent':'DiagChat/1.0','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000),redirect:'error'});
 const data=await response.json();if(!response.ok){const error=new Error(`Asaas HTTP ${response.status}: ${safeErrorText(data.errors?.map((e:any)=>e.description).join('; ')||'Falha na API')}`);Object.assign(error,{definitive:[400,401,403,422].includes(response.status)});throw error;}return data;
}
export async function ensureAsaasBilling(db:DB,invoice:any){
 const [settings]=(await db.query('select * from app.asaas_settings where id=true')).rows;
 const [existing]=(await db.query('select * from app.asaas_billing where invoice_id=$1',[invoice.id])).rows;
 if(existing)return existing;
 if(!settings?.enabled)return null;
 const [client]=(await db.query('select asaas_customer_id from app.clients where id=$1',[invoice.client_id])).rows;
 const [job]=(await db.query(`insert into app.asaas_billing(invoice_id,environment,customer_id,fiscal) values($1,$2,$3,$4) on conflict do nothing returning *`,[invoice.id,config.asaasEnvironment,client?.asaas_customer_id||'',JSON.stringify(settings.fiscal)])).rows;
 return job||(await db.query('select * from app.asaas_billing where invoice_id=$1',[invoice.id])).rows[0];
}
export const reference=(invoiceId:string)=>'diagchat/'+invoiceId;
export function paymentPayload(invoice:any){const rate=Number((Number(invoice.late_interest_rate)*(invoice.late_interest_basis==='daily'?30:1)).toFixed(6));if(!Number.isFinite(rate)||rate<0||rate>10)throw new Error('O Asaas aceita até 10% de juros ao mês. Ajuste a taxa desta fatura antes de criar a cobrança.');return {customer:invoice.customer_id,billingType:'BOLETO',value:Number(invoice.total),dueDate:date(invoice.due_date),externalReference:reference(invoice.invoice_id),description:`DiagChat — competência ${date(invoice.period).slice(0,7)}`,interest:{value:rate,type:'PERCENTAGE'}};}
export function nfPayload(invoice:any){const fiscal=fiscalSchema.parse(invoice.fiscal);return {...fiscal,payment:invoice.payment_id,value:Number(invoice.total),deductions:0,effectiveDate:today(),updatePayment:false,externalReference:reference(invoice.invoice_id),serviceDescription:`${fiscal.serviceDescription} — competência ${date(invoice.period).slice(0,7)}`};}
function validatePayment(p:any,job:any){if(p.customer!==job.customer_id||p.externalReference!==reference(job.invoice_id)||p.billingType!=='BOLETO'||p.deleted)throw new Error('A cobrança Asaas não corresponde ao cliente ou à referência da fatura.');if(!Number.isFinite(Number(p.value))||Number(p.value)<0||!Number.isFinite(Number(p.originalValue??p.value))||Math.abs(Number(p.originalValue??p.value)-Number(job.total))>0.011)throw new Error('Valor da cobrança Asaas diverge da fatura. Revisão necessária.');}
async function applyPayment(job:any,p:any){
 validatePayment(p,job);
 const paid=['CONFIRMED','RECEIVED','DUNNING_RECEIVED'].includes(p.status);
 const refund=Array.isArray(p.refunds)?p.refunds.filter((r:any)=>r.status==='DONE').reduce((n:number,r:any)=>n+Number(r.value||0),0):0;
 await transaction(async db=>{
  await db.query(`update app.asaas_billing set payment_status=$2,bank_slip_url=$3,invoice_url=$4,gross_value=coalesce($5,gross_value),net_value=coalesce($6,net_value),refund_value=$7,client_payment_date=$8,confirmed_at=case when $9 then coalesce(confirmed_at,now()) else confirmed_at end,received_at=case when $2='RECEIVED' then coalesce(received_at,now()) else received_at end where invoice_id=$1`,[job.invoice_id,p.status,p.bankSlipUrl||null,p.invoiceUrl||null,paid?Number(p.value):null,paid&&p.netValue!=null&&Number.isFinite(Number(p.netValue))?Number(p.netValue):null,refund,p.clientPaymentDate||null,paid]);
  if(paid)await db.query(`update app.invoices set status='paid',paid_at=coalesce(paid_at,now()),paid_total=$2 where id=$1`,[job.invoice_id,Number(p.value)]);
  if((['CONFIRMED','RECEIVED','DUNNING_RECEIVED'].includes(job.payment_status)&&!paid)||['REFUNDED','REFUND_REQUESTED','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL'].includes(p.status)||refund>0){const status=p.status==='REFUNDED'||refund>=Number(p.value)?'refunded':refund>0?'partially_refunded':p.status.includes('CHARGEBACK')||p.status==='REFUND_REQUESTED'?'disputed':'open';await db.query(`update app.invoices set status=$2,paid_at=case when $2='open' then null else paid_at end,paid_total=$3 where id=$1`,[job.invoice_id,status,status==='refunded'?0:status==='partially_refunded'?Math.max(0,Number(p.value)-refund):null]);await db.query(`update app.outbox set status='held',last_error='Pagamento estornado ou em disputa. Revisão financeira necessária.' where kind='invoice' and reference_id=$1 and status<>'sent'`,[job.invoice_id]);}
 });
 return p;
}
async function findOne(path:string){const list=await asaasRequest(path);if(list.totalCount>1||list.data?.length>1)throw new Error('Mais de um registro Asaas corresponde à fatura. Revisão necessária.');return list.data?.[0];}
export async function processAsaasBilling(){
 // Notifications carry only identifiers: fetch authoritative resources, never trust amounts/URLs from a webhook body.
 await transaction(async db=>{const events=(await db.query(`select * from app.asaas_events where processed_at is null and next_attempt_at<=now() order by received_at for update skip locked limit 50`)).rows;
  for(const e of events){const result=await db.query(`update app.asaas_billing set status='pending',next_attempt_at=now() where environment=$2 and (payment_id=$1 or nf_id=$1) and status<>'working' returning invoice_id`,[e.resource_id,e.environment]);if(result.rows.length)await db.query('update app.asaas_events set processed_at=now() where event_id=$1',[e.event_id]);else await db.query("update app.asaas_events set attempts=attempts+1,next_attempt_at=now()+interval '5 minutes',processed_at=case when received_at<now()-interval '14 days' then now() else null end where event_id=$1",[e.event_id]);}
 });
 await query(`update app.asaas_billing set status='pending',last_error='Execução interrompida; reconciliando antes de criar novos documentos.' where status='working' and locked_at<now()-interval '5 minutes'`);
 const [job]=await query(`update app.asaas_billing set status='working',locked_at=now() where invoice_id=(select invoice_id from app.asaas_billing where status in ('pending','waiting','ready') and next_attempt_at<=now() order by next_attempt_at for update skip locked limit 1) returning *`);if(!job)return;
 try{
  const [invoice]=await query('select * from app.invoices where id=$1',[job.invoice_id]);Object.assign(job,invoice,{invoice_id:job.invoice_id});
  if(job.environment!==config.asaasEnvironment)throw new Error('O ambiente Asaas desta fatura difere do ambiente configurado.');
  if(!/^cus_[A-Za-z0-9]+$/.test(job.customer_id))throw new Error('Informe no cliente o ID do pagador cadastrado manualmente no Asaas.');
  fiscalSchema.parse(job.fiscal);
  // No remote side effect on a manually settled invoice.
  if(invoice.status==='paid'&&!job.payment_id)throw new Error('Fatura já paga manualmente; não será criada outra cobrança.');
  let p=job.payment_id?await asaasRequest('/payments/'+encodeURIComponent(job.payment_id)):await findOne('/payments?externalReference='+encodeURIComponent(reference(job.invoice_id))+'&limit=2');
  if(!p){if(!(await query('select enabled from app.asaas_settings where id=true'))[0]?.enabled)throw new Error('Criação Asaas desativada nas configurações.');if(job.payment_attempted)throw new Error('Resultado anterior de criação da cobrança incerto. Confira no Asaas antes de permitir outra criação.');const payload=paymentPayload(job);await query('update app.asaas_billing set payment_attempted=true where invoice_id=$1',[job.invoice_id]);try{p=await asaasRequest('/payments','POST',payload);}catch(e){if((e as any).definitive)await query('update app.asaas_billing set payment_attempted=false where invoice_id=$1',[job.invoice_id]);throw e;}}
  validatePayment(p,job);job.payment_id=p.id;await query('update app.asaas_billing set payment_id=$2 where invoice_id=$1',[job.invoice_id,p.id]);await applyPayment(job,p);
  if(Number((p.refunds||[]).filter((r:any)=>r.status==='DONE').reduce((n:number,r:any)=>n+Number(r.value||0),0))>0)throw new Error('Pagamento com estorno parcial ou total; revisão financeira necessária.');
  if(!['PENDING','OVERDUE','CONFIRMED','RECEIVED','DUNNING_RECEIVED'].includes(p.status))throw new Error('Situação da cobrança requer revisão no Asaas: '+p.status);
  let nf=job.nf_id?await asaasRequest('/invoices/'+encodeURIComponent(job.nf_id)):(await findOne('/invoices?externalReference='+encodeURIComponent(reference(job.invoice_id))+'&limit=2')||await findOne('/invoices?payment='+encodeURIComponent(job.payment_id)+'&limit=2'));
  if(!nf){if(!(await query('select enabled from app.asaas_settings where id=true'))[0]?.enabled)throw new Error('Criação Asaas desativada nas configurações.');if(job.nf_attempted)throw new Error('Resultado anterior de criação da nota incerto. Confira no Asaas antes de permitir outra criação.');const payload=nfPayload(job);await query('update app.asaas_billing set nf_attempted=true where invoice_id=$1',[job.invoice_id]);try{nf=await asaasRequest('/invoices','POST',payload);}catch(e){if((e as any).definitive)await query('update app.asaas_billing set nf_attempted=false where invoice_id=$1',[job.invoice_id]);throw e;}}
  if(nf.payment!==job.payment_id||(nf.externalReference&&nf.externalReference!==reference(job.invoice_id))||!Number.isFinite(Number(nf.value))||Math.abs(Number(nf.value)-Number(job.total))>0.011)throw new Error('A nota fiscal Asaas não corresponde à cobrança e ao valor da fatura.');
  await query('update app.asaas_billing set nf_id=$2,nf_status=$3,nf_pdf_url=$4,nf_xml_url=$5,nf_number=$6 where invoice_id=$1',[job.invoice_id,nf.id,nf.status,nf.pdfUrl||null,nf.xmlUrl||null,nf.number||null]);
  if(['ERROR','CANCELED','PROCESSING_CANCELLATION','CANCELLATION_DENIED'].includes(nf.status))throw new Error('Nota fiscal requer revisão no Asaas: '+nf.status+'. '+safeErrorText(nf.statusDescription||''));
  if(nf.status!=='AUTHORIZED'||!nf.pdfUrl||!p.bankSlipUrl){await query("update app.asaas_billing set status='waiting',next_attempt_at=now()+interval '30 minutes',last_error='Aguardando autorização da nota e documentos.' where invoice_id=$1",[job.invoice_id]);return;}
  const {downloadAsaasPdf}=await import('./asaas-documents.js');
  const boleto=job.boleto_pdf||await downloadAsaasPdf(p.bankSlipUrl);const nota=job.nf_pdf||await downloadAsaasPdf(nf.pdfUrl);
  await query("update app.asaas_billing set status='ready',boleto_pdf=$2,nf_pdf=$3,last_error=null,next_attempt_at=now()+interval '24 hours',updated_at=now() where invoice_id=$1",[job.invoice_id,boleto,nota]);
 }catch(error){await query("update app.asaas_billing set status='review',last_error=$2,updated_at=now() where invoice_id=$1",[job.invoice_id,safeErrorText(error)]);await recordError({source:'asaas',operation:'Gerar ou sincronizar cobrança e nota fiscal',error,clientId:job.client_id,details:'Fatura: '+job.invoice_id});}
}
