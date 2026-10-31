import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DEMO_MODE='true';
const {config}=await import('../server/config.js');config.encryption='a'.repeat(64);
const {query,transaction}=await import('../server/db.js');
const {createAdminSession,restoreAdminSession,sessionLifetime}=await import('../server/auth.js');
const {hash,decrypt}=await import('../server/security.js');
const uid='00000000-0000-4000-8000-000000000123';
async function seed(){await query('insert into app.admins(user_id) values($1) on conflict do nothing',[uid]);return transaction(db=>createAdminSession(db,uid,{access_token:'access-one',refresh_token:'refresh-one',expires_in:3600}));}
test('sessão persiste no banco por 30 dias e renova uma única vez em acessos simultâneos',async()=>{
 const token=await seed();const [saved]=await query('select * from app.admin_sessions where token_hash=$1',[hash(token)]);assert.notEqual(token,saved.token_hash);assert(!saved.access_enc.includes('access-one'));assert(Math.abs(new Date(saved.expires_at).getTime()-Date.now()-sessionLifetime)<5000);
 let refreshes=0;const auth={getUser:async(access:string)=>{assert.equal(access,refreshes?'access-two':'access-one');return {data:{user:{id:uid}},error:null};},refreshSession:async(s:{refresh_token:string})=>{refreshes++;assert.equal(s.refresh_token,'refresh-one');return {data:{user:{id:uid},session:{access_token:'access-two',refresh_token:'refresh-two',expires_in:3600}},error:null};}};
 assert.equal(await transaction(db=>restoreAdminSession(db,token,auth)),uid);
 await query("update app.admin_sessions set access_expires_at=now()-interval '1 second' where token_hash=$1",[hash(token)]);
 const ids=await Promise.all([transaction(db=>restoreAdminSession(db,token,auth)),transaction(db=>restoreAdminSession(db,token,auth))]);assert.deepEqual(ids,[uid,uid]);assert.equal(refreshes,1);const [updated]=await query('select refresh_enc from app.admin_sessions where token_hash=$1',[hash(token)]);assert.equal(decrypt(updated.refresh_enc),'refresh-two');
});
test('expiração, revogação e saída invalidam a sessão; falha temporária preserva acesso recuperável',async()=>{
 const token=await seed();await query("update app.admin_sessions set access_expires_at=now()-interval '1 second' where token_hash=$1",[hash(token)]);
 const unavailable={refreshSession:async()=>({error:{status:503}}),getUser:async()=>{throw new Error('Não deveria consultar');}};
 await assert.rejects(transaction(db=>restoreAdminSession(db,token,unavailable)),/temporariamente/);assert.equal((await query('select 1 from app.admin_sessions where token_hash=$1',[hash(token)])).length,1);
 assert.equal(await transaction(db=>restoreAdminSession(db,token,{...unavailable,refreshSession:async()=>({error:{status:400}})})),null);
 const expired=await seed();await query("update app.admin_sessions set expires_at=now()-interval '1 second' where token_hash=$1",[hash(expired)]);assert.equal(await transaction(db=>restoreAdminSession(db,expired,unavailable)),null);
 const removed=await seed();await query('delete from app.admins where user_id=$1',[uid]);assert.equal(await transaction(db=>restoreAdminSession(db,removed,unavailable)),null);
 const logout=await seed();await query('delete from app.admin_sessions where token_hash=$1',[hash(logout)]);assert.equal(await transaction(db=>restoreAdminSession(db,logout,unavailable)),null);
});
