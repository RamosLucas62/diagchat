import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pkceStorage,magicAuthClient,authorizeMagicSession} from '../server/auth.js';
const key='a'.repeat(64);
test('magic link usa PKCE vinculado ao cookie cifrado e não cria usuários',async()=>{
 let cookie:string|null=null;let challenge='';let redirect='';
 const mock:typeof fetch=async(input,init)=>{const url=String(input);const body=JSON.parse(String(init?.body));
 if(url.includes('/otp')){assert.equal(body.create_user,false);challenge=body.code_challenge;redirect=new URL(url).searchParams.get('redirect_to')||'';return Response.json({});}
 if(url.includes('/token')){assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),challenge);return Response.json({access_token:'access',refresh_token:'refresh',token_type:'bearer',expires_in:3600,user:{id:'admin',email:'admin@example.com'}});}
 throw new Error('Chamada inesperada '+url);
 };
 const first=magicAuthClient(pkceStorage(undefined,v=>{cookie=v;},key),'https://auth.example','anon',mock);
 const sent=await first.auth.signInWithOtp({email:'admin@example.com',options:{shouldCreateUser:false,emailRedirectTo:'https://app.example/api/auth/callback'}});assert.equal(sent.error,null);assert(cookie);assert(!String(cookie).includes('code-verifier'));assert(challenge);
 const second=magicAuthClient(pkceStorage(cookie,v=>{cookie=v;},key),'https://auth.example','anon',mock);
 const flowId=new URL(redirect).searchParams.get('sb_flow_id');
 const exchanged=await second.auth.exchangeCodeForSession('valid-code',flowId?{flowId}:undefined);assert.equal(exchanged.error,null);assert.equal(exchanged.data.user?.id,'admin');
 assert.equal((await authorizeMagicSession(exchanged.data,async id=>id==='admin'))?.token,'access');assert.equal(await authorizeMagicSession(exchanged.data,async()=>false),null);
});
test('cookie adulterado, sessão ausente e novo fluxo não reutilizam verificadores',async()=>{
 let cookie:string|null=null;const storage=pkceStorage(undefined,v=>{cookie=v;},key);storage.setItem('diagchat-auth-code-verifier','secret');assert.equal(pkceStorage(cookie!,()=>{},key).getItem('diagchat-auth-code-verifier'),'secret');assert.equal(pkceStorage(cookie!+'x',()=>{},key).getItem('diagchat-auth-code-verifier'),null);assert.equal(pkceStorage(cookie!,()=>{},key,true).getItem('diagchat-auth-code-verifier'),null);storage.setItem('diagchat-auth','access-token');assert.equal(storage.getItem('diagchat-auth'),null);assert.equal(await authorizeMagicSession({session:null,user:null},async()=>true),null);
});
