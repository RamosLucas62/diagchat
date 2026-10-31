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
