import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import {requestAuth,authorizeMagicSession,flowCookie,sessionCookie,authCookieOptions} from './auth.js';
import {ensureInvoiceReport} from './reports.js';
import { resolve } from 'node:path';
import { config,demo,production,assertConfigured } from './config.js';
import { query,transaction,prepareDatabase } from './db.js';
import { encrypt,decrypt,opaqueToken,hash,equal,safePhoto,verifySignature } from './security.js';
import { parseWorkbook,normalizePhone } from './importer.js';
import { templates } from './meta.js';
import {billingProfileSchema,ensureBillingProfile,queueInvoiceEmail} from './billing.js';
import {billingValues} from '../shared/billing.js';
import { analytics,parseAnalyticsFilter } from './analytics.js';
assertConfigured();
await prepareDatabase();
if(demo){const {seedDemo}=await import('./demo.js');await seedDemo();}
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','https:'],connectSrc:["'self'"],fontSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"]}},referrerPolicy:{policy:'no-referrer'}}));
app.use(cookieParser());app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
app.get('/api/health',async(_req,res)=>{try{await query('select 1');res.json({ok:true});}catch{res.status(503).json({ok:false});}});
// Raw bytes must be preserved for signature verification before JSON parsing.
app.get('/api/webhook/:id',async(req,res)=>{
 if(!z.uuid().safeParse(req.params.id).success)return res.sendStatus(404);
 const [c]=await query('select verify_token from app.clients where id=$1',[req.params.id]);
 if(c&&req.query['hub.mode']==='subscribe'&&equal(String(req.query['hub.verify_token']||''),c.verify_token))return res.status(200).send(String(req.query['hub.challenge']||''));res.sendStatus(403);
});
app.post('/api/webhook/:id',express.raw({type:'application/json',limit:'2mb'}),async(req,res)=>{
 if(demo||!z.uuid().safeParse(req.params.id).success)return res.sendStatus(404);
 const [c]=await query('select id,secret_enc,waba_id,phone_id from app.clients where id=$1',[req.params.id]);
 if(!c||!Buffer.isBuffer(req.body)||!verifySignature(req.body,String(req.headers['x-hub-signature-256']||''),decrypt(c.secret_enc)))return res.sendStatus(403);
 let payload:any;try{payload=JSON.parse(req.body.toString('utf8'));}catch{return res.sendStatus(400);}
 await transaction(async db=>{
  for(const entry of payload.entry||[]){if(entry.id!==c.waba_id)continue;
   for(const change of entry.changes||[]){const value=change.value;if(value?.metadata?.phone_number_id!==c.phone_id)continue;
    for(const status of value.statuses||[]){if(!['sent','delivered','read','failed'].includes(status.status)||!status.id||!/^\d+$/.test(String(status.timestamp)))continue;
     const eventKey=hash(`${c.id}/${status.id}/${status.status}/${status.timestamp}`);
     await db.query(`insert into app.webhook_events(event_key,client_id,provider_id,status,message_ref,occurred_at) values($1,$2,$3,$4,$5,to_timestamp($6)) on conflict do nothing`,[eventKey,c.id,status.id,status.status,status.biz_opaque_callback_data||null,Number(status.timestamp)]);
    }
    for(const message of value.messages||[]){if(/^(sair|parar|stop|cancelar)$/i.test(message.text?.body?.trim()||'')){
     const phone=normalizePhone(message.from);if(phone)await db.query('insert into app.suppressions(client_id,phone) values($1,$2) on conflict do nothing',[c.id,phone]);
    }}
   }
  }
 });res.sendStatus(200);
});
app.use(express.json({limit:'15mb'}));
app.use('/api',(req,res,next)=>{
 if(!['GET','HEAD','OPTIONS'].includes(req.method)){
  const origin=req.get('origin');if(!origin||origin!==new URL(config.url).origin)return res.status(403).json({error:'Origem da solicitação não autorizada.'});
 }next();
});
const authLimit=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:true,legacyHeaders:false,message:{error:'Muitas tentativas. Aguarde 15 minutos.'}});
const apiLimit=rateLimit({windowMs:60*1000,limit:240,standardHeaders:true,legacyHeaders:false,message:{error:'Muitas solicitações. Aguarde um minuto.'}});
app.use('/api',apiLimit);
app.post('/api/login',authLimit,async(req,res)=>{
 const {email}=z.object({email:z.email()}).strict().parse(req.body);
 if(demo)return res.json({ok:true,demo:true});
 const client=requestAuth(req,res,true);
 const {error}=await client.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:`${config.url}/api/auth/callback`}});
 if(error?.status===429)return res.status(429).json({error:'Aguarde um minuto antes de solicitar outro link.'});
 if(error&&(!error.status||error.status>=500))return res.status(503).json({error:'Não foi possível enviar o link agora. Tente novamente em instantes.'});
 res.json({ok:true,message:'Se o e-mail estiver cadastrado, você receberá um link de acesso.'});
});
app.get('/api/auth/callback',authLimit,async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(demo)return res.redirect('/');
 const code=z.string().min(6).max(4096).safeParse(req.query.code);
 if(!code.success||!req.cookies[flowCookie])return res.redirect('/?login=invalid');
 const flowId=z.string().min(1).max(128).optional().safeParse(req.query.sb_flow_id);
 if(!flowId.success)return res.redirect('/?login=invalid');
 const client=requestAuth(req,res);
 const {data,error}=await client.auth.exchangeCodeForSession(code.data,flowId.data?{flowId:flowId.data}:undefined);
 res.clearCookie(flowCookie,authCookieOptions);
 if(error)return res.redirect('/?login=invalid');
 const session=await authorizeMagicSession(data,async id=>(await query('select 1 from app.admins where user_id=$1',[id])).length>0);
 if(!session)return res.redirect('/?login=unauthorized');
 res.cookie(sessionCookie,session.token,{...authCookieOptions,maxAge:session.maxAge});return res.redirect('/');
});
app.post('/api/logout',(req,res)=>{res.clearCookie(sessionCookie,authCookieOptions);res.clearCookie(flowCookie,authCookieOptions);res.json({ok:true});});
async function auth(req:express.Request,res:express.Response,next:express.NextFunction){
 const portal=req.get('x-portal-token');
 if(portal){const [c]=await query('select id from app.clients where portal_hash=$1 and active',[hash(portal)]);if(!c)return res.status(401).json({error:'Link inválido ou desativado.'});res.locals.clientId=c.id;res.locals.actor=`portal:${c.id}`;return next();}
 if(demo){res.locals.actor='demo';return next();}
 if(!req.cookies[sessionCookie])return res.status(401).json({error:'Entre com seu link de acesso para continuar.'});
 const {data,error}=await requestAuth(req,res).auth.getUser(req.cookies[sessionCookie]);
 if(error||!data.user||!(await query('select 1 from app.admins where user_id=$1',[data.user.id])).length)return res.status(401).json({error:'Entre na sua conta para continuar.'});
 res.locals.actor=data.user.id;next();
}
function admin(_req:express.Request,res:express.Response,next:express.NextFunction){if(res.locals.clientId)return res.status(403).json({error:'Acesso administrativo necessário.'});next();}
app.use('/api',auth);
const publicColumns='id,name,photo_url,plan_name,monthly_limit,overage_mode,overage_rate,active';
const adminColumns=publicColumns+',email,waba_id,phone_id,group_id,throughput,monthly_fee,cost_rate,due_day,verify_token,created_at';
async function clientRows(clientId?:string){return query(`select ${clientId?publicColumns:adminColumns},coalesce((select accepted from app.usage where client_id=c.id and period=app.current_period()),0) as used,coalesce((select reserved from app.usage where client_id=c.id and period=app.current_period()),0) as reserved,coalesce((select monthly_limit from app.usage where client_id=c.id and period=app.current_period()),monthly_limit) as current_limit from app.clients c ${clientId?'where id=$1':''} order by created_at desc`,clientId?[clientId]:[]);}
app.get('/api/session',async(_req,res)=>{res.json({demo,portal:!!res.locals.clientId,clientId:res.locals.clientId||null});});
app.get('/api/clients',async(_req,res)=>res.json(await clientRows(res.locals.clientId)));
const clientSchema=z.object({name:z.string().trim().min(2).max(120),email:z.email(),photo_url:z.string().max(700000).default('').refine(safePhoto,'Foto inválida: use HTTPS, JPG, PNG ou WebP.'),waba_id:z.string().regex(/^\d+$/),phone_id:z.string().regex(/^\d+$/),token:z.string().max(5000).optional(),app_secret:z.string().max(200).optional(),group_id:z.string().max(150).default(''),throughput:z.coerce.number().int().min(1).max(1000),plan_name:z.string().min(1).max(100),monthly_limit:z.coerce.number().int().min(0).max(100000000),monthly_fee:z.coerce.number().min(0).max(10000000),overage_mode:z.enum(['block','charge']),overage_rate:z.coerce.number().min(0).max(1000),cost_rate:z.coerce.number().min(0).max(1000),due_day:z.coerce.number().int().min(1).max(28),active:z.boolean().default(true)});
async function saveClient(req:express.Request,res:express.Response){
 const input=clientSchema.parse(req.body);const id=req.params.id?z.uuid().parse(req.params.id):null;
 if(!id&&!demo&&(!input.token||!input.app_secret))return res.status(400).json({error:'Token e App Secret são obrigatórios.'});
 if(demo&&(input.token||input.app_secret))return res.status(400).json({error:'Não use credenciais reais na demonstração.'});
 const portal=opaqueToken();
 const row=await transaction(async db=>{
  if(id){const [existing]=(await db.query('select id from app.clients where id=$1 for update',[id])).rows;if(!existing)throw new Error('Cliente não encontrado.');await db.query('select app.ensure_usage($1)',[id]);}
  const fields=['name','email','photo_url','waba_id','phone_id','group_id','throughput','plan_name','monthly_limit','monthly_fee','overage_mode','overage_rate','cost_rate','due_day','active'];
  const values=fields.map(f=>(input as any)[f]);
  if(!id||input.token){fields.push('token_enc');values.push(demo?'demo':encrypt(input.token!));}
  if(!id||input.app_secret){fields.push('secret_enc');values.push(demo?'demo':encrypt(input.app_secret!));}
  let result;
  if(id){values.push(id);result=await db.query(`update app.clients set ${fields.map((f,i)=>`${f}=$${i+1}`).join(',')} where id=$${values.length} returning id`,values);}
  else{fields.push('verify_token','portal_hash');values.push(opaqueToken(),hash(portal));result=await db.query(`insert into app.clients(${fields.join(',')}) values(${values.map((_,i)=>`$${i+1}`).join(',')}) returning id`,values);await db.query('select app.ensure_usage($1)',[result.rows[0].id]);}
  await db.query('insert into app.audit(actor,action,target_id) values($1,$2,$3)',[res.locals.actor,id?'client.update':'client.create',result.rows[0].id]);return result.rows[0];
 });res.json({...row,portalUrl:id?null:`${config.url}/p/#${portal}`});
}
app.post('/api/clients',admin,saveClient);app.put('/api/clients/:id',admin,saveClient);
app.post('/api/clients/:id/portal',admin,async(req,res)=>{const id=z.uuid().parse(req.params.id);const token=opaqueToken();const rows=await query('update app.clients set portal_hash=$2 where id=$1 returning id',[id,hash(token)]);if(!rows.length)return res.sendStatus(404);await query('insert into app.audit(actor,action,target_id) values($1,\'portal.rotate\',$2)',[res.locals.actor,id]);res.json({url:`${config.url}/p/#${token}`});});
app.get('/api/clients/:id/templates',async(req,res)=>{const id=z.uuid().parse(req.params.id);if(res.locals.clientId&&res.locals.clientId!==id)return res.sendStatus(403);const [c]=await query('select * from app.clients where id=$1 and active',[id]);if(!c)return res.sendStatus(404);res.json(await templates(c));});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:1}});
const importLimit=rateLimit({windowMs:60000,limit:8,message:{error:'Aguarde um minuto antes de importar novamente.'}});
app.post('/api/import',importLimit,upload.single('file'),async(req,res)=>{if(!req.file||!req.file.originalname.toLowerCase().endsWith('.xlsx'))return res.status(400).json({error:'Selecione um arquivo .xlsx.'});const overrideSchema=z.record(z.string(),z.object({headerRow:z.number().int().min(1).max(50000).optional(),phoneColumn:z.string().max(200).optional()}));const overrides=overrideSchema.parse(JSON.parse(req.body.overrides||'{}'));res.json(await parseWorkbook(req.file.buffer,overrides));});
const recipientSchema=z.object({phone:z.string().max(30),variables:z.array(z.string().min(1).max(1024)).max(30)});
const campaignSchema=z.object({client_id:z.uuid(),name:z.string().trim().min(2).max(120),template_name:z.string().regex(/^[a-z0-9_]+$/),language:z.string().max(20),scheduled_at:z.iso.datetime(),consent_confirmed:z.literal(true),request_key:z.uuid(),recipients:z.array(recipientSchema).min(1).max(50000)});
app.post('/api/campaigns',async(req,res)=>{
 const input=campaignSchema.parse(req.body);if(res.locals.clientId&&res.locals.clientId!==input.client_id)return res.sendStatus(403);
 const [c]=await query('select * from app.clients where id=$1 and active',[input.client_id]);if(!c)return res.status(400).json({error:'Cliente indisponível.'});
 const template=(await templates(c)).find(t=>t.name===input.template_name&&t.language===input.language&&t.supported);if(!template)return res.status(400).json({error:'Selecione um template aprovado e compatível.'});
 const seen=new Set();const recipients=input.recipients.map(r=>{const phone=normalizePhone(r.phone);if(!phone||r.variables.length!==template.parameters.length)throw new Error('Telefone ou variáveis inválidos. Revise a importação.');return {...r,phone};}).filter(r=>!seen.has(r.phone)&&seen.add(r.phone));
 const campaign=await transaction(async db=>{
  const [existing]=(await db.query('select id,client_id from app.campaigns where request_key=$1',[input.request_key])).rows;
  if(existing){if(existing.client_id!==input.client_id)throw new Error('Identificador de solicitação em uso.');return existing;}
  const [p]=(await db.query(`insert into app.campaigns(client_id,name,template_name,language,scheduled_at,consent_confirmed,request_key,status,source) values($1,$2,$3,$4,$5,true,$6,$7,$8) returning id`,[input.client_id,input.name,input.template_name,input.language,input.scheduled_at,input.request_key,res.locals.clientId?'pending':'running',res.locals.clientId?'portal':'admin'])).rows;
  await db.query(`insert into app.messages(campaign_id,client_id,phone,variables) select $1,$2,r.phone,r.variables from jsonb_to_recordset($3::jsonb) as r(phone text,variables jsonb)`,[p.id,input.client_id,JSON.stringify(recipients)]);
  await db.query(`insert into app.audit(actor,action,target_id) values($1,'campaign.create',$2)`,[res.locals.actor,p.id]);return p;
 });res.json(campaign);
});
app.get('/api/campaigns',async(_req,res)=>res.json(await query(`select p.*,c.name as client_name,count(m.id)::int as total,count(*) filter(where m.state='accepted')::int as sent,count(*) filter(where m.delivery in ('delivered','read'))::int as delivered,count(*) filter(where m.delivery='read')::int as read,count(*) filter(where m.state='failed' or m.delivery='failed')::int as failed,count(*) filter(where m.state='unknown')::int as uncertain from app.campaigns p join app.clients c on c.id=p.client_id left join app.messages m on m.campaign_id=p.id ${res.locals.clientId?'where p.client_id=$1':''} group by p.id,c.name order by p.created_at desc limit 100`,res.locals.clientId?[res.locals.clientId]:[])));
app.post('/api/campaigns/:id/action',admin,async(req,res)=>{
 const id=z.uuid().parse(req.params.id);const {action}=z.object({action:z.enum(['approve','pause','resume','cancel'])}).parse(req.body);
 const [p]=await query('select * from app.campaigns where id=$1',[id]);if(!p)return res.sendStatus(404);
 if(['approve','resume'].includes(action)){const [c]=await query('select * from app.clients where id=$1',[p.client_id]);if(!c.active)return res.status(400).json({error:'Ative o cliente antes de iniciar.'});if(!(await templates(c)).some(t=>t.name===p.template_name&&t.language===p.language&&t.supported))return res.status(400).json({error:'Template indisponível na Meta.'});}
 const allowed:Record<string,string[]>={approve:['pending'],pause:['running','blocked'],resume:['paused','blocked'],cancel:['pending','running','paused','blocked']};
 await transaction(async db=>{const rows=(await db.query(`update app.campaigns set status=$2 where id=$1 and status=any($3) returning id`,[id,{approve:'running',pause:'paused',resume:'running',cancel:'cancelled'}[action],allowed[action]])).rows;if(!rows.length)throw new Error('A campanha mudou de estado. Atualize a página.');if(action==='cancel')await db.query(`update app.messages set state='cancelled' where campaign_id=$1 and state='queued'`,[id]);await db.query('insert into app.audit(actor,action,target_id) values($1,$2,$3)',[res.locals.actor,`campaign.${action}`,id]);});res.json({ok:true});
});
app.get('/api/analytics',async(req,res)=>{const filter=parseAnalyticsFilter(req.query,res.locals.clientId);if(!filter)return res.status(403).json({error:'Cliente não autorizado.'});res.json(await analytics(filter,!!res.locals.clientId));});
app.get('/api/metrics',async(req,res)=>{
 const days=z.coerce.number().int().min(1).max(90).catch(30).parse(req.query.days);const cid=res.locals.clientId||null;
 const [usage]=await query(`select coalesce(sum(u.accepted),0)::int as sent,coalesce(sum(u.reserved),0)::int as reserved,coalesce(sum(u.monthly_limit),0)::int as quota,coalesce(sum(u.monthly_fee+greatest(0,u.accepted-u.monthly_limit)*u.overage_rate),0)::float as revenue,coalesce(sum(u.cost),0)::float as cost from app.usage u where u.period=app.current_period() and ($1::uuid is null or u.client_id=$1)`,[cid]);
 const [clients]=await query('select count(*)::int as clients from app.clients where active and ($1::uuid is null or id=$1)',[cid]);
 const daily=await query(`select d::date::text as date,count(m.id)::int as sent from generate_series((now() at time zone 'America/Sao_Paulo')::date-($2::int-1),(now() at time zone 'America/Sao_Paulo')::date,interval '1 day') d left join app.messages m on (m.accepted_at at time zone 'America/Sao_Paulo')::date=d::date and ($1::uuid is null or m.client_id=$1) group by d order by d`,[cid,days]);
 const [delivery]=await query(`select count(*) filter(where delivery in ('delivered','read'))::int as delivered,count(*) filter(where delivery='read')::int as read,count(*) filter(where delivery='failed' or state='failed')::int as failed,count(*) filter(where state='unknown')::int as uncertain from app.messages where period=app.current_period() and ($1::uuid is null or client_id=$1)`,[cid]);
 const [{day}]=await query(`select extract(day from now() at time zone 'America/Sao_Paulo')::int as day`);
 const result={...usage,...clients,...delivery,profit:usage.revenue-usage.cost,average:Math.round(usage.sent/day),daily};
 if(cid){delete result.revenue;delete result.cost;delete result.profit;}res.json(result);
});
app.get('/api/finance/email-settings',admin,async(_req,res)=>res.json(await query(`select c.id,c.name,c.email,c.photo_url,c.active,coalesce(s.auto_send,true) as auto_send,(s.client_id is not null and s.version>0) as customized,s.updated_at from app.clients c left join app.billing_email_settings s on s.client_id=c.id order by c.name`)));
app.get('/api/finance/email-settings/:id',admin,async(req,res)=>{
 const id=z.uuid().parse(req.params.id);
 const result=await transaction(async db=>{
  const [client]=(await db.query('select id,name,email,plan_name,monthly_limit,monthly_fee,overage_rate,due_day from app.clients where id=$1',[id])).rows;
  if(!client)return null;
  const profile=await ensureBillingProfile(db,id);
  const [sample]=(await db.query(`select app.current_period() as period,coalesce(u.accepted,0) as accepted,coalesce(u.monthly_limit,c.monthly_limit) as monthly_limit,coalesce(u.monthly_fee,c.monthly_fee) as base_amount,greatest(0,coalesce(u.accepted,0)-coalesce(u.monthly_limit,c.monthly_limit)) as overage_count,round(greatest(0,coalesce(u.accepted,0)-coalesce(u.monthly_limit,c.monthly_limit))*coalesce(u.overage_rate,c.overage_rate),2) as overage_amount,(app.current_period()+interval '1 month')::date+c.due_day-1 as due_date from app.clients c left join app.usage u on u.client_id=c.id and u.period=app.current_period() where c.id=$1`,[id])).rows;
  sample.total=Number(sample.base_amount)+Number(sample.overage_amount);
  return {profile,client,variables:billingValues(client,sample,profile.payment_instructions)};
 });
 if(!result)return res.status(404).json({error:'Cliente não encontrado.'});res.json(result);
});
app.put('/api/finance/email-settings/:id',admin,async(req,res)=>{
 const id=z.uuid().parse(req.params.id);const input=billingProfileSchema.parse(req.body);
 const result=await transaction(async db=>{
  const [client]=(await db.query('select id from app.clients where id=$1',[id])).rows;if(!client)return {notFound:true};
  const existing=await ensureBillingProfile(db,id);if(existing.version!==input.version)return {conflict:true};
  const [profile]=(await db.query('update app.billing_email_settings set auto_send=$2,subject_template=$3,body_template=$4,payment_instructions=$5,version=version+1,updated_at=now() where client_id=$1 returning *',[id,input.auto_send,input.subject_template,input.body_template,input.payment_instructions])).rows;
  // Pause only automatic emails that have not started. Manual requests keep their explicit intent.
  if(!input.auto_send)await db.query("update app.outbox o set status='held',last_error='Envio automático desativado para este cliente.' from app.invoices i where o.kind='invoice' and o.reference_id=i.id and i.client_id=$1 and o.automatic and o.status='pending'",[id]);
  else await db.query("update app.outbox o set status='pending',next_attempt_at=now(),last_error=null from app.invoices i where o.kind='invoice' and o.reference_id=i.id and i.client_id=$1 and i.status='open' and o.automatic and o.status='held' and o.first_attempt_at is null",[id]);
  await db.query("insert into app.audit(actor,action,target_id) values($1,'billing.email-settings.update',$2)",[res.locals.actor,id]);return {profile};
 });
 if('notFound' in result)return res.status(404).json({error:'Cliente não encontrado.'});if('conflict' in result)return res.status(409).json({error:'Este modelo foi alterado em outra sessão. Recarregue os dados antes de salvar.'});res.json(result.profile);
});
app.post('/api/finance/:id/email',admin,async(req,res)=>{
 const id=z.uuid().parse(req.params.id);const result=await transaction(async db=>{const item=await queueInvoiceEmail(db,id,false);if(!('error' in item))await db.query("insert into app.audit(actor,action,target_id) values($1,'billing.email.queue-manual',$2)",[res.locals.actor,id]);return item;});
 if('error' in result)return res.status(409).json(result);res.json(result);
});
app.get('/api/finance/:id/report',admin,async(req,res)=>{
 const id=z.uuid().parse(req.params.id);const [invoice]=await query('select id from app.invoices where id=$1',[id]);if(!invoice)return res.status(404).json({error:'Cobrança não encontrada.'});
 const report=await transaction(db=>ensureInvoiceReport(db,id));
 res.type('application/pdf').set('Content-Disposition',`inline; filename="relatorio-mensal-${String(report.snapshot.period).slice(0,7)}.pdf"`).set('Cache-Control','no-store').send(Buffer.from(report.pdf_base64,'base64'));
});
app.get('/api/finance',admin,async(_req,res)=>res.json(await query(`select i.*,c.name as client_name,c.email,o.status as email_status,o.last_error,(o.first_attempt_at is null) as email_not_attempted from app.invoices i join app.clients c on c.id=i.client_id left join app.outbox o on o.kind='invoice' and o.reference_id=i.id order by i.period desc,c.name limit 250`)));
app.post('/api/finance/:id/paid',admin,async(req,res)=>{const id=z.uuid().parse(req.params.id);await transaction(async db=>{await db.query(`update app.invoices set status='paid',paid_at=now() where id=$1`,[id]);await db.query(`insert into app.audit(actor,action,target_id) values($1,'invoice.paid',$2)`,[res.locals.actor,id]);});res.json({ok:true});});
app.get('/api/settings',admin,async(_req,res)=>res.json({url:config.url,webhookPattern:`${config.url}/api/webhook/ID_DO_CLIENTE`,integrations:[{name:'Supabase',description:'Banco de dados e acesso administrativo',configured:!demo&&!!config.database},{name:'WhatsApp Cloud API',description:'Credenciais individuais no cadastro de cada cliente',configured:!demo&&!!config.graph},{name:'Resend',description:'E-mails automáticos de cobrança',configured:!demo&&!!(config.resend&&config.from)},{name:'Evolution',description:'Avisos de conclusão nos grupos dos clientes',configured:!demo&&!!(config.evolution&&config.evolutionKey&&config.evolutionInstance)}],notifications:await query('select id,kind,status,last_error,attempts from app.outbox where status<>\'sent\' order by next_attempt_at desc limit 30')}));
app.use('/api',(_req,res)=>res.status(404).json({error:'Rota não encontrada.'}));
app.use(express.static(resolve('dist')));app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/index.html')));
app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
 if(error instanceof z.ZodError)return res.status(400).json({error:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')});
 if(error?.code==='23505')return res.status(409).json({error:'Registro duplicado. Verifique o Phone ID ou a solicitação.'});
 if(error?.code==='LIMIT_FILE_SIZE')return res.status(400).json({error:'O arquivo deve ter até 10 MB.'});
 if(error?.code||error?.name==='SyntaxError')return res.status(400).json({error:'Não foi possível processar os dados. Verifique o formato e tente novamente.'});
 // Do not expose database statements, credentials, or stack traces.
 const message=error instanceof Error?error.message:'';
 if(/^(Selecione|Limite|Cada aba|Importe|Planilha|Arquivo|Cabeçalho|Telefone|Cliente|Identificador|A campanha|A competência|Cobrança|Não foi possível consultar)/.test(message))return res.status(400).json({error:message});
 console.error('Falha de operação:',error?.name||'Error');res.status(500).json({error:'Não foi possível concluir a operação. Tente novamente.'});
});
app.listen(config.port,demo?'127.0.0.1':'0.0.0.0',()=>console.log(`DiagChat API: http://localhost:${config.port}${demo?' — demonstração local':''}`));
