import {Router,type RequestHandler} from 'express';
import {z} from 'zod';
import {config,demo,asaasTokenConfigured} from './config.js';
import {equal} from './security.js';
import {query,transaction} from './db.js';
import {asaasSettingsSchema,emptyFiscal} from '../shared/asaas.js';
const webhookSchema=z.object({id:z.string().min(1).max(200),event:z.string().min(1).max(100),payment:z.object({id:z.string().min(1).max(100)}).optional(),invoice:z.object({id:z.string().min(1).max(100)}).optional()});
const events=new Set(['PAYMENT_CREATED','PAYMENT_UPDATED','PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_DUNNING_RECEIVED','PAYMENT_OVERDUE','PAYMENT_DELETED','PAYMENT_RESTORED','PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_REFUND_IN_PROGRESS','PAYMENT_RECEIVED_IN_CASH_UNDONE','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_AWAITING_CHARGEBACK_REVERSAL','INVOICE_CREATED','INVOICE_UPDATED','INVOICE_AUTHORIZED','INVOICE_ERROR','INVOICE_CANCELED','INVOICE_PROCESSING_CANCELLATION','INVOICE_CANCELLATION_DENIED']);
export const asaasWebhook:RequestHandler=async(req,res)=>{
 if(!asaasTokenConfigured()||!equal(req.get('asaas-access-token')||'',config.asaasWebhookToken||''))return res.sendStatus(403);
 if(demo&&!process.env.ASAAS_TEST)return res.sendStatus(404);
 const parsed=webhookSchema.safeParse(req.body);if(!parsed.success)return res.sendStatus(400);const e=parsed.data;
 if(!events.has(e.event))return res.sendStatus(200);
 const resource=e.event.startsWith('PAYMENT_')?e.payment?.id:e.invoice?.id;if(!resource)return res.sendStatus(400);
 // Durable inbox before acknowledgement. No amounts, documents, CPF or secret tokens in the inbox/logs.
 await query('insert into app.asaas_events(event_id,event,resource_id,environment) values($1,$2,$3,$4) on conflict do nothing',[e.id,e.event,resource,config.asaasEnvironment]);res.sendStatus(200);
};
export const asaasRouter=Router();
asaasRouter.use('/finance',(req,res,next)=>{if(res.locals.clientId)return res.status(403).json({error:'Acesso administrativo necessário.'});next();});
asaasRouter.get('/finance/asaas-settings',async(_req,res)=>{const [s]=await query('select * from app.asaas_settings where id=true');res.json({...s,fiscal:{...emptyFiscal,...s.fiscal,taxes:{...emptyFiscal.taxes,...s.fiscal.taxes}},environment:config.asaasEnvironment,api_configured:!!config.asaasKey,webhook_configured:asaasTokenConfigured(),webhook_url:config.url+'/api/webhooks/asaas'});});
asaasRouter.put('/finance/asaas-settings',async(req,res)=>{const settings=asaasSettingsSchema.parse(req.body);if(settings.enabled&&(!config.asaasKey||!asaasTokenConfigured()))return res.status(400).json({error:'Configure ASAAS_API_KEY e ASAAS_WEBHOOK_TOKEN no servidor antes de ativar.'});if(settings.enabled&&demo)return res.status(400).json({error:'Integração real desabilitada na demonstração.'});await transaction(async db=>{await db.query('update app.asaas_settings set enabled=$1,fiscal=$2,updated_at=now() where id=true',[settings.enabled,JSON.stringify(settings.fiscal)]);await db.query("insert into app.audit(actor,action) values($1,'asaas.settings')",[res.locals.actor]);});res.json({ok:true});});
asaasRouter.post('/finance/:id/asaas-sync',async(req,res)=>{
 const id=z.uuid().parse(req.params.id);
 const result=await transaction(async db=>{const [job]=(await db.query('select * from app.asaas_billing where invoice_id=$1 for update',[id])).rows;if(!job)return {error:'Adicione a cobrança à fila de e-mail para preparar os documentos.'};if(job.status==='working')return {error:'Sincronização em andamento.'};
  // Only a never-attempted operation can adopt corrected configuration. Uncertain creations must be reconciled, never repeated blindly.
  if(!job.payment_attempted&&!job.payment_id){await db.query(`update app.asaas_billing a set customer_id=c.asaas_customer_id,fiscal=s.fiscal from app.invoices i join app.clients c on c.id=i.client_id cross join app.asaas_settings s where a.invoice_id=i.id and a.invoice_id=$1`,[id]);}
  if(!job.nf_attempted&&!job.nf_id)await db.query('update app.asaas_billing set fiscal=(select fiscal from app.asaas_settings where id=true) where invoice_id=$1',[id]);
  await db.query("update app.asaas_billing set status='pending',next_attempt_at=now(),last_error=null where invoice_id=$1",[id]);await db.query("update app.outbox set status='pending',next_attempt_at=now(),last_error=null where kind='invoice' and reference_id=$1 and first_attempt_at is null and status in ('review','held','pending')",[id]);return {ok:true};});res.status('error' in result?400:200).json(result);
});
asaasRouter.get('/finance/:id/asaas-documents/:kind',async(req,res)=>{const id=z.uuid().parse(req.params.id);const kind=z.enum(['boleto','nf']).parse(req.params.kind);const [job]=await query('select boleto_pdf,nf_pdf from app.asaas_billing where invoice_id=$1',[id]);const content=kind==='boleto'?job?.boleto_pdf:job?.nf_pdf;if(!content)return res.sendStatus(404);res.type('application/pdf').set('Content-Disposition',`attachment; filename="${kind}-${id}.pdf"`).send(Buffer.from(content,'base64'));});
