import {ensureAsaasBilling} from './asaas.js';
import {z} from 'zod';
import type {DB} from './db.js';
import {ensureInvoiceReport,reportAttachment} from './reports.js';
import {defaultBillingSubject,defaultBillingBody,defaultPaymentInstructions,billingValues,renderBillingTemplate,validateBillingTemplate} from '../shared/billing.js';
export const billingProfileSchema=z.object({auto_send:z.boolean(),subject_template:z.string().trim().min(1).max(200).refine(v=>!/[\r\n]/.test(v),'O assunto deve ter uma única linha.'),body_template:z.string().trim().min(1).max(12000),payment_instructions:z.string().max(4000),version:z.number().int().min(0)}).superRefine((v,ctx)=>{for(const key of ['subject_template','body_template'] as const){try{validateBillingTemplate(v[key]);}catch(e){ctx.addIssue({code:'custom',path:[key],message:(e as Error).message});}}});
export async function ensureBillingProfile(db:DB,clientId:string){
 await db.query(`insert into app.billing_email_settings(client_id,subject_template,body_template,payment_instructions) values($1,$2,$3,$4) on conflict do nothing`,[clientId,defaultBillingSubject,defaultBillingBody,process.env.PAYMENT_INSTRUCTIONS||defaultPaymentInstructions]);
 const [profile]=(await db.query('select * from app.billing_email_settings where client_id=$1 for update',[clientId])).rows;return profile;
}
export async function queueInvoiceEmail(db:DB,invoiceId:string,automatic:boolean){
 const [invoice]=(await db.query('select * from app.invoices where id=$1 for update',[invoiceId])).rows;
 if(!invoice)return {error:'Cobrança não encontrada.'};if(invoice.status!=='open')return {error:'Esta cobrança não está aberta para envio.'};
 const profile=await ensureBillingProfile(db,invoice.client_id);if(automatic&&!profile.auto_send)return {skipped:true};
 await ensureAsaasBilling(db,invoice);
 const [existing]=(await db.query("select * from app.outbox where kind='invoice' and reference_id=$1 for update",[invoice.id])).rows;
 if(existing){
  if(existing.status==='held'&&!existing.first_attempt_at){
   // No request has reached the provider. A manual action can release this existing record.
   await db.query("update app.outbox set status='pending',automatic=$2,next_attempt_at=now(),last_error=null where id=$1",[existing.id,automatic]);return {id:existing.id,status:'pending'};
  }
  if(existing.status==='review'||existing.status==='held')return {error:'Este e-mail precisa de revisão no provedor antes de uma nova tentativa.'};
  return {id:existing.id,status:existing.status};
 }
 const [client]=(await db.query('select name,email,plan_name from app.clients where id=$1',[invoice.client_id])).rows;
 const [balance]=(await db.query('select * from app.invoice_balance($1,$2,$3,$4,now())',[invoice.total,invoice.due_date,invoice.late_interest_rate,invoice.late_interest_basis])).rows;
 const [usage]=(await db.query('select accepted,monthly_limit from app.usage where client_id=$1 and period=$2',[invoice.client_id,invoice.period])).rows;
 const variables=billingValues(client,{...usage,...invoice,...balance},profile.payment_instructions);
 const report=await ensureInvoiceReport(db,invoice.id);
 const payload={attachments:[reportAttachment(report)],to:[client.email],subject:renderBillingTemplate(profile.subject_template,variables).replace(/[\r\n]+/g,' '),text:renderBillingTemplate(profile.body_template,variables)};
 const [item]=(await db.query("insert into app.outbox(kind,reference_id,payload,automatic) values('invoice',$1,$2,$3) returning id,status",[invoice.id,JSON.stringify(payload),automatic])).rows;
 return item;
}
