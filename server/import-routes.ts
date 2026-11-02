import {automaticTemplate} from '../shared/import-semantics.js';
import {Router,type Response} from 'express';
import multer from 'multer';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import {query,transaction,type DB} from './db.js';
import {templates,type Template} from './meta.js';
import {importProfileSchema,defaultImportProfile,type ImportProfile} from '../shared/import-profile.js';
import {buildImportPlan,templateSignature,type ImportPlan} from './import-plan.js';
import {nextPortalCampaignName} from './portal.js';
const router=Router();
let activePlans=0;
const capacity=(_req:any,res:Response,next:any)=>{if(activePlans>=2)return res.status(429).json({error:'Há planilhas sendo processadas. Tente novamente em instantes.'});activePlans++;let released=false;const release=()=>{if(!released){released=true;activePlans--;}};res.once('finish',release);res.once('close',release);next();};
const admin=(_req:any,res:Response,next:any)=>res.locals.clientId?res.status(403).json({error:'Acesso administrativo necessário.'}):next();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:4}});
const limiter=rateLimit({windowMs:60000,limit:8,message:{error:'Aguarde um minuto antes de importar novamente.'}});
const overridesSchema=z.record(z.string().max(200),z.object({headerRow:z.number().int().min(1).max(500).optional(),phoneColumn:z.string().max(160).optional()}));
const ignoredSchema=z.array(z.object({sheet:z.string().max(200),row:z.number().int().min(1).max(50000)})).max(5000);
const allowed=(res:Response,id:string)=>!res.locals.clientId||res.locals.clientId===id;
async function loadProfile(client:any,available:Template[]){
 const [saved]=await query('select * from app.import_profiles where client_id=$1',[client.id]);if(saved){const config=importProfileSchema.parse(saved.config);if(config.mode==='fixed')config.templates=config.templates.filter(t=>t.key===config.fixedTemplate);config.templates=config.templates.map(t=>({...t,bindings:t.bindings.map(b=>b.source==='column'&&!b.aliases.length?{...b,source:'auto' as const}:b)}));return {config,version:saved.version};}
 const profile=defaultImportProfile();profile.mode=client.allow_template_selection?'form':'fixed';const usable=available.filter(t=>t.supported);
 const fixed=usable.find(t=>t.name===client.default_template_name&&t.language===client.default_template_language)||(usable.length===1?usable[0]:undefined);profile.fixedTemplate=fixed?`${fixed.name}:${fixed.language}`:'';
 profile.templates=(profile.mode==='fixed'?(fixed?[fixed]:[]):usable).map(automaticTemplate);
 return {config:profile,version:0};
}
function publicBatch(row:any){const plan=row.result as ImportPlan;return {id:row.id,client_id:row.client_id,client_name:row.client_name,file_name:row.file_name,status:row.status,requested_at:row.requested_at,created_at:row.created_at,issues:plan.issues,summary:plan.summary,campaign_ids:row.campaign_ids};}
async function clientFor(id:string){const [client]=await query('select * from app.clients where id=$1',[id]);return client;}
router.get('/clients/:id/import-profile',admin,async(req,res)=>{const id=z.uuid().parse(req.params.id);const client=await clientFor(id);if(!client)return res.sendStatus(404);const available=await templates(client);res.json({...await loadProfile(client,available),templates:available});});
router.put('/clients/:id/import-profile',admin,async(req,res)=>{
 const id=z.uuid().parse(req.params.id);const {config,version}=z.object({config:importProfileSchema,version:z.number().int().min(0)}).parse(req.body);const client=await clientFor(id);if(!client)return res.sendStatus(404);
 if(config.mode==='fixed')config.templates=config.templates.filter(t=>t.key===config.fixedTemplate);
 const available=await templates(client);const configured=new Set(config.templates.map(t=>t.key));

 if(config.mode==='fixed'&&!configured.has(config.fixedTemplate))return res.status(400).json({error:'Defina o template fixo e suas variáveis.'});
 if(config.mode==='column'&&config.routes.some(r=>!configured.has(r.template)))return res.status(400).json({error:'Configure todos os templates usados nas regras.'});
 if(config.mode==='form'&&!configured.size)return res.status(400).json({error:'Libere ao menos um template para o formulário.'});
 for(const rule of config.templates){const t=available.find(t=>`${t.name}:${t.language}`===rule.key&&t.supported);if(!t)return res.status(400).json({error:'Template indisponível ou incompatível na Meta.'});if(rule.bindings.length!==t.parameters.length||t.parameters.some(p=>!rule.bindings.some(b=>b.parameter===p)))return res.status(400).json({error:'Configure todas as variáveis do template '+t.name+'.'});if(rule.bindings.some(b=>b.source==='column'?!b.aliases.length:b.source==='fixed'?!b.value.trim():false))return res.status(400).json({error:'Preencha a origem de cada variável do template '+t.name+'.'});}
 config.templates=config.templates.map(rule=>({...rule,signature:templateSignature(available.find(t=>`${t.name}:${t.language}`===rule.key)!)}));
 const result=await transaction(async db=>{await db.query('select id from app.clients where id=$1 for update',[id]);const [current]=(await db.query('select version from app.import_profiles where client_id=$1',[id])).rows;if((current?.version||0)!==version)return null;const [saved]=(await db.query('insert into app.import_profiles(client_id,config) values($1,$2) on conflict(client_id) do update set config=$2,version=app.import_profiles.version+1,updated_at=now() returning version',[id,JSON.stringify(config)])).rows;await db.query("insert into app.audit(actor,action,target_id) values($1,'import.profile.update',$2)",[res.locals.actor,id]);return saved;});
 if(!result)return res.status(409).json({error:'O perfil foi alterado por outra pessoa. Reabra para atualizar.'});res.json(result);
});
router.get('/clients/:id/import-options',async(req,res)=>{const id=z.uuid().parse(req.params.id);if(!allowed(res,id))return res.sendStatus(403);const client=await clientFor(id);if(!client?.active)return res.sendStatus(404);const available=await templates(client);const profile=await loadProfile(client,available);res.json({mode:profile.config.mode,templates:profile.config.mode==='form'?available.filter(t=>t.supported&&profile.config.templates.some(r=>r.key===`${t.name}:${t.language}`)).map(t=>({name:t.name,language:t.language})):[]});});
router.post('/import-batches',limiter,capacity,upload.single('file'),async(req,res)=>{
 const clientId=z.uuid().parse(req.body.client_id),requestKey=z.uuid().parse(req.body.request_key);if(!allowed(res,clientId))return res.sendStatus(403);if(!req.file||!req.file.originalname.toLowerCase().endsWith('.xlsx'))return res.status(400).json({error:'Selecione um arquivo .xlsx.'});
 const [existing]=await query('select * from app.import_batches where client_id=$1 and request_key=$2 and expires_at>now()',[clientId,requestKey]);if(existing)return res.json(publicBatch(existing));
 const client=await clientFor(clientId);if(!client?.active)return res.status(400).json({error:'Cliente indisponível.'});const available=await templates(client);const profile=await loadProfile(client,available);const chosen=z.string().max(550).parse(req.body.chosen_template||'');
 const result=await buildImportPlan(req.file.buffer,profile.config,available,{chosenTemplate:chosen});
 const [batch]=await query(`insert into app.import_batches(client_id,request_key,file_name,file_base64,chosen_template,profile_version,status,result) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(client_id,request_key) do update set request_key=excluded.request_key returning *`,[clientId,requestKey,req.file.originalname.slice(0,200),req.file.buffer.toString('base64'),chosen,profile.version,result.issues.length?'review':'ready',JSON.stringify(result)]);res.json(publicBatch(batch));
});
router.get('/import-batches',async(_req,res)=>{const rows=await query(`select b.id,b.client_id,c.name as client_name,b.file_name,b.status,b.result,b.requested_at,b.created_at,b.campaign_ids from app.import_batches b join app.clients c on c.id=b.client_id where b.expires_at>now() and b.requested_at is not null ${res.locals.clientId?'and b.client_id=$1':''} order by b.created_at desc limit 100`,res.locals.clientId?[res.locals.clientId]:[]);res.json(rows.map(publicBatch));});
router.get('/import-batches/:id',admin,async(req,res)=>{const [batch]=await query('select * from app.import_batches where id=$1 and expires_at>now()',[z.uuid().parse(req.params.id)]);if(!batch)return res.sendStatus(404);res.json({...publicBatch(batch),sheets:batch.result.sheets,overrides:batch.overrides,ignored_rows:batch.ignored_rows,profile_version:batch.profile_version});});
router.get('/import-batches/:id/file',admin,async(req,res)=>{const [batch]=await query('select file_base64 from app.import_batches where id=$1 and expires_at>now()',[z.uuid().parse(req.params.id)]);if(!batch)return res.sendStatus(404);res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('planilha-original.xlsx').send(Buffer.from(batch.file_base64,'base64'));});
router.post('/import-batches/:id/reprocess',admin,capacity,async(req,res)=>{
 const id=z.uuid().parse(req.params.id);const input=z.object({overrides:overridesSchema.default({}),ignoredRows:ignoredSchema.default([]),saveLayout:z.boolean().default(false)}).parse(req.body);
 const [batch]=await query('select * from app.import_batches where id=$1 and expires_at>now()',[id]);if(!batch)return res.sendStatus(404);if(batch.status==='submitted')return res.status(409).json({error:'Esta importação já criou campanhas.'});
 const client=await clientFor(batch.client_id),available=await templates(client);const profile=await loadProfile(client,available);let version=profile.version;
 const result=await buildImportPlan(Buffer.from(batch.file_base64,'base64'),profile.config,available,{chosenTemplate:batch.chosen_template,overrides:input.overrides,ignoredRows:input.ignoredRows});
 const saved=await transaction(async db=>{await db.query('select id from app.clients where id=$1 for update',[batch.client_id]);const [current]=(await db.query('select version from app.import_profiles where client_id=$1',[batch.client_id])).rows;if((current?.version||0)!==profile.version)return null;
  if(input.saveLayout){const config={...profile.config,layouts:{...profile.config.layouts,...input.overrides}};const [p]=(await db.query('insert into app.import_profiles(client_id,config) values($1,$2) on conflict(client_id) do update set config=$2,version=app.import_profiles.version+1,updated_at=now() returning version',[batch.client_id,JSON.stringify(config)])).rows;version=p.version;}
  const [row]=(await db.query("update app.import_batches set revision=revision+1,profile_version=$2,result=$3,status=$4,overrides=$5,ignored_rows=$6 where id=$1 and status<>'submitted' returning *",[id,version,JSON.stringify(result),result.issues.length?'review':'ready',JSON.stringify(input.overrides),JSON.stringify(input.ignoredRows)])).rows;
  await db.query("insert into app.audit(actor,action,target_id) values($1,'import.reprocess',$2)",[res.locals.actor,id]);return row;});
 if(!saved)return res.status(409).json({error:'A importação ou o perfil mudou. Atualize os dados.'});res.json(publicBatch(saved));
});
router.post('/import-batches/:id/submit',capacity,async(req,res)=>{
 const id=z.uuid().parse(req.params.id);z.object({consent:z.literal(true)}).parse(req.body);
 const [batch]=await query('select * from app.import_batches where id=$1 and expires_at>now()',[id]);if(!batch)return res.sendStatus(404);if(!allowed(res,batch.client_id))return res.sendStatus(403);if(batch.status==='submitted')return res.json(publicBatch(batch));
 const client=await clientFor(batch.client_id);if(!client?.active)return res.status(400).json({error:'Cliente indisponível.'});
 if(batch.status==='review'){const [requested]=await query("update app.import_batches set requested_at=coalesce(requested_at,now()),consent_at=coalesce(consent_at,now()) where id=$1 and status='review' returning *",[id]);if(!requested)return res.status(409).json({error:'A importação mudou. Atualize os dados.'});return res.json(publicBatch(requested));}
 const available=await templates(client),profile=await loadProfile(client,available);
 // Recalculate from the stored workbook; browser-supplied recipients and mappings are never used.
 const plan=await buildImportPlan(Buffer.from(batch.file_base64,'base64'),profile.config,available,{chosenTemplate:batch.chosen_template,overrides:batch.overrides,ignoredRows:batch.ignored_rows});
 if(batch.profile_version!==profile.version)plan.issues.unshift({sheet:'',row:0,message:'O perfil foi atualizado desde a leitura. A equipe precisa reprocessar a importação.'});
 const result=await transaction(async db=>{
  const [locked]=(await db.query('select * from app.clients where id=$1 and active for update',[batch.client_id])).rows;if(!locked)throw new Error('Cliente indisponível.');if(locked.waba_id!==client.waba_id||locked.phone_id!==client.phone_id||locked.token_enc!==client.token_enc)return null;
  const [currentProfile]=(await db.query('select version from app.import_profiles where client_id=$1',[batch.client_id])).rows;if((currentProfile?.version||0)!==profile.version)return null;
  const [current]=(await db.query('select * from app.import_batches where id=$1 for update',[id])).rows;if(current.status==='submitted')return current;if(current.revision!==batch.revision)return null;
  // Admin approval of the campaign remains separate from import validation.
  const ids:string[]=[];
  if(!plan.issues.length)for(const [index,segment] of plan.segments.entries()){
   const scheduledAt=segment.immediate?new Date().toISOString():segment.scheduledAt;const name=await nextPortalCampaignName(db,locked,scheduledAt);const split=segment.template.lastIndexOf(':');const template=segment.template.slice(0,split),language=segment.template.slice(split+1);
   const [campaign]=(await db.query(`insert into app.campaigns(client_id,name,template_name,language,scheduled_at,consent_confirmed,request_key,status,source,import_batch_id,import_segment,import_template_signature) values($1,$2,$3,$4,$5,true,gen_random_uuid(),'pending',$6,$7,$8,$9) returning id`,[batch.client_id,name,template,language,scheduledAt,res.locals.clientId?'portal':'admin',id,String(index),templateSignature(available.find(t=>`${t.name}:${t.language}`===segment.template)!)])).rows;
   await db.query(`insert into app.messages(campaign_id,client_id,phone,variables,source_rows) select $1,$2,r.phone,r.variables,r."sourceRows" from jsonb_to_recordset($3::jsonb) as r(phone text,variables jsonb,"sourceRows" jsonb)`,[campaign.id,batch.client_id,JSON.stringify(segment.recipients)]);ids.push(campaign.id);
  }
  const [saved]=(await db.query("update app.import_batches set requested_at=coalesce(requested_at,now()),consent_at=coalesce(consent_at,now()),profile_version=$2,result=$3,status=$4,campaign_ids=$5 where id=$1 returning *",[id,profile.version,JSON.stringify(plan),plan.issues.length?'review':'submitted',JSON.stringify(ids)])).rows;
  await db.query("insert into app.audit(actor,action,target_id) values($1,'import.submit',$2)",[res.locals.actor,id]);return saved;
 });if(!result)return res.status(409).json({error:'A importação ou o perfil mudou durante o processamento. Atualize e tente novamente.'});res.json(publicBatch(result));
});
export {router as importRouter};
