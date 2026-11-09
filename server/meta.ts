import {safeErrorText} from './error-log.js';
import { config,demo } from './config.js';
import { decrypt } from './security.js';
export type Template = {name:string;language:string;body:string;parameters:string[];supported:boolean};
export async function templates(client:any):Promise<Template[]> {
 if(demo)return [{name:'novidades_do_mes',language:'pt_BR',body:'Olá, {{1}}! Temos novidades especiais para você. Confira as condições com nossa equipe.',parameters:['1'],supported:true},{name:'lembrete_agendamento',language:'pt_BR',body:'Olá, {{1}}. Seu atendimento está agendado para {{2}}. Podemos confirmar?',parameters:['1','2'],supported:true}];
 const response=await fetch(`https://graph.facebook.com/${config.graph}/${client.waba_id}/message_templates?status=APPROVED&limit=100`,{headers:{Authorization:`Bearer ${decrypt(client.token_enc)}`},signal:AbortSignal.timeout(15000)});
 const body:any=await response.json();if(!response.ok)throw new Error(`Não foi possível consultar os templates (Meta ${body.error?.code||response.status}): ${safeErrorText(body.error?.message||'Resposta sem descrição')}.`);
 return (body.data||[]).map((t:any)=>{
  const body=t.components?.find((c:any)=>c.type==='BODY')?.text||'';
  const parameters=[...new Set<string>(Array.from(body.matchAll(/\{\{(\w+)\}\}/g),(m:any)=>m[1]))];
  // First release supports positional text-body variables and static components only.
  const supported=parameters.every(x=>/^\d+$/.test(x))&&!(t.components||[]).some((c:any)=>(c.type==='HEADER'&&(c.format!=='TEXT'||/\{\{/.test(c.text||'')))||(c.type==='BUTTONS'&&(c.buttons||[]).some((b:any)=>b.type==='FLOW'||b.type==='COPY_CODE'||/\{\{/.test(b.url||''))));
  return {name:t.name,language:t.language,body,parameters:parameters.sort((a,b)=>Number(a)-Number(b)),supported};
 });
}
export async function sendMeta(job:any) {
 const {client,message,campaign}=job;
 const response=await fetch(`https://graph.facebook.com/${config.graph}/${client.phone_id}/messages`,{
  method:'POST',headers:{Authorization:`Bearer ${decrypt(client.token_enc)}`,'Content-Type':'application/json'},
  body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:message.phone,type:'template',
   biz_opaque_callback_data:message.id,template:{name:campaign.template_name,language:{code:campaign.language},
   ...(message.variables.length?{components:[{type:'body',parameters:message.variables.map((text:string)=>({type:'text',text}))}]}:{})}}),signal:AbortSignal.timeout(20000)});
 const body:any=await response.json();
 if(response.ok&&body.messages?.[0]?.id)return {state:'accepted',id:body.messages[0].id,error:null,temporary:false};
 // HTTP 5xx/invalid responses may arrive after acceptance: never automatically resend.
 return {state:response.status>=500||response.ok?'unknown':'failed',id:null,temporary:response.status===429||response.status===408||response.status>=500||response.ok,error:safeErrorText(`Meta ${body.error?.code||response.status}: ${body.error?.message||'Resposta sem confirmação do envio'}${body.error?.error_data?.details?' · '+body.error.error_data.details:''}`)};
}
