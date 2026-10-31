import {createClient} from '@supabase/supabase-js';
import type {Request,Response} from 'express';
import {config,production} from './config.js';
import {encrypt,decrypt} from './security.js';
export const flowCookie='diagchat_login_flow';
export const sessionCookie='diagchat_session';
export const authCookieOptions={httpOnly:true,secure:production,sameSite:'lax' as const,path:'/'};
export function pkceStorage(sealed:string|undefined,write:(value:string|null)=>void,key=config.encryption,reset=false){
 let values:Record<string,string>={};
 if(sealed&&!reset&&sealed.length<4000){try{const parsed=JSON.parse(decrypt(sealed,key));if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&Object.keys(parsed).length<=12&&Object.values(parsed).every(v=>typeof v==='string'))values=parsed;}catch{/* An invalid cookie cannot provide a PKCE verifier. */}}
 const flush=()=>{const json=JSON.stringify(values);if(json.length>2400)throw new Error('Fluxo de autenticação inválido.');write(Object.keys(values).length?encrypt(json,key):null);};
 return {getItem:(name:string)=>values[name]??null,setItem:(name:string,value:string)=>{if(!name.endsWith('-code-verifier'))return;values[name]=value;flush();},removeItem:(name:string)=>{if(!name.endsWith('-code-verifier'))return;delete values[name];flush();}};
}
export function requestAuth(req:Request,res:Response,reset=false){
 const storage=pkceStorage(req.cookies[flowCookie],value=>{if(value)res.cookie(flowCookie,value,{...authCookieOptions,maxAge:15*60*1000});else res.clearCookie(flowCookie,authCookieOptions);},config.encryption,reset);
 return magicAuthClient(storage);
}
export function magicAuthClient(storage:ReturnType<typeof pkceStorage>,url=config.supabase!,anon=config.anon!,customFetch?:typeof fetch){
 return createClient(url,anon,{...(customFetch?{global:{fetch:customFetch}}:{}),auth:{flowType:'pkce',storageKey:'diagchat-auth',storage,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false}});
}
export async function authorizeMagicSession(data:{session:{access_token:string;expires_in?:number}|null;user:{id:string}|null},isAdmin:(id:string)=>Promise<boolean>){
 if(!data.session?.access_token||!data.user?.id||!await isAdmin(data.user.id))return null;
 return {token:data.session.access_token,maxAge:(data.session.expires_in||3600)*1000};
}

// Persistent opaque cookie; provider credentials stay encrypted in the private database.
export const sessionLifetime=30*24*60*60*1000;
export async function createAdminSession(db:import('./db.js').DB,userId:string,session:{access_token:string;refresh_token:string;expires_in:number},now=Date.now()){
 const {opaqueToken,hash}=await import('./security.js');const token=opaqueToken();
 await db.query('delete from app.admin_sessions where expires_at<=now()');
 await db.query('insert into app.admin_sessions(token_hash,user_id,access_enc,refresh_enc,access_expires_at,expires_at) values($1,$2,$3,$4,$5,$6)',[hash(token),userId,encrypt(session.access_token),encrypt(session.refresh_token),new Date(now+session.expires_in*1000),new Date(now+sessionLifetime)]);
 return token;
}
export async function restoreAdminSession(db:import('./db.js').DB,token:string,auth:{refreshSession:(s:{refresh_token:string})=>Promise<any>;getUser:(token:string)=>Promise<any>},now=Date.now()){
 const {hash}=await import('./security.js');const tokenHash=hash(token);
 const [session]=(await db.query('select s.* from app.admin_sessions s join app.admins a on a.user_id=s.user_id where token_hash=$1 for update of s',[tokenHash])).rows;
 if(!session)return null;
 const remove=async()=>{await db.query('delete from app.admin_sessions where token_hash=$1',[tokenHash]);return null;};
 if(new Date(session.expires_at).getTime()<=now)return remove();
 let access:string,refresh:string;try{access=decrypt(session.access_enc);refresh=decrypt(session.refresh_enc);}catch{return remove();}
 if(new Date(session.access_expires_at).getTime()<=now+60000){
  const result=await auth.refreshSession({refresh_token:refresh});
  if(result.error){if(!result.error.status||result.error.status>=500||result.error.status===429)throw new Error('Autenticação temporariamente indisponível.');return remove();}
  const renewed=result.data.session;
  if(!renewed||result.data.user?.id!==session.user_id)return remove();
  access=renewed.access_token;
  await db.query('update app.admin_sessions set access_enc=$2,refresh_enc=$3,access_expires_at=$4 where token_hash=$1',[tokenHash,encrypt(access),encrypt(renewed.refresh_token),new Date(now+renewed.expires_in*1000)]);
  return session.user_id as string;
 }
 const result=await auth.getUser(access);
 if(result.error){if(!result.error.status||result.error.status>=500||result.error.status===429)throw new Error('Autenticação temporariamente indisponível.');return remove();}
 if(result.data.user?.id!==session.user_id)return remove();
 return session.user_id as string;
}
