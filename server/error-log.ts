import {randomUUID} from 'node:crypto';
import type {RequestHandler} from 'express';
import {query} from './db.js';
export function safeErrorText(value:unknown):string{
 let text=value instanceof Error?value.message:String(value??'');
 // Never store request bodies, spreadsheets or provider payloads. Redact credentials even in provider messages.
 for(const [key,secret] of Object.entries(process.env))if(secret&&secret.length>=6&&/(TOKEN|SECRET|PASSWORD|DATABASE_URL|RESEND_API_KEY|EVOLUTION_API_KEY|ENCRYPTION_KEY)/i.test(key))text=text.split(secret).join('[oculto]');
 return text.replace(/Bearer\s+\S+/gi,'Bearer [oculto]').replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi,'$1[oculto]').replace(/((?:token|apikey|api_key|password|secret|authorization)\s*[=:]\s*)[^\s,;]+/gi,'$1[oculto]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[e-mail oculto]').replace(/\b\d{10,16}\b/g,'[número oculto]').slice(0,4000);
}
export type ErrorEvent={source:string;operation:string;code?:string;error:unknown;details?:string;clientId?:string;campaignId?:string;requestId?:string};
export async function recordError(event:ErrorEvent){
 const value={source:safeErrorText(event.source).slice(0,40),operation:safeErrorText(event.operation).slice(0,200),code:safeErrorText(event.code).slice(0,80),message:safeErrorText(event.error),details:safeErrorText(event.details),clientId:event.clientId||null,campaignId:event.campaignId||null,requestId:event.requestId||''};
 try{await query('insert into app.error_logs(source,operation,code,message,details,client_id,campaign_id,request_id) values($1,$2,$3,$4,$5,$6,$7,$8)',Object.values(value));}catch{console.error(JSON.stringify({level:'error',at:new Date().toISOString(),...value,persistence:'unavailable'}));}
}
export const requestErrorLog:RequestHandler=(req,res,next)=>{
 const requestId=randomUUID();res.setHeader('X-Request-Id',requestId);res.locals.requestId=requestId;
 let responseMessage='';const json=res.json.bind(res);res.json=(body:any)=>{if(typeof body?.error==='string')responseMessage=body.error;if(res.statusCode>=400&&body&&typeof body==='object')body={...body,error_id:requestId};return json(body);};
 res.on('finish',()=>{if(res.statusCode<400||req.path==='/api/error-events'||(res.statusCode===401&&req.path==='/api/session'))return;
  void recordError({source:'web',operation:`${req.method} ${req.path}`,code:String(res.statusCode),error:res.locals.operationError||responseMessage||`Solicitação terminou com HTTP ${res.statusCode}.`,details:res.locals.errorLocation||'',requestId,clientId:res.locals.clientId});
 });next();
};
