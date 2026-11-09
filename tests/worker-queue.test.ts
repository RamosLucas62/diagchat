import {test,after} from 'node:test';
import assert from 'node:assert/strict';
process.env.DEMO_MODE='true';process.env.ENCRYPTION_KEY='11'.repeat(32);
const {query}=await import('../server/db.js');
const {claimMessage,nextMessageDelay,dispatchClaimed}=await import('../server/jobs.js');
const {encrypt}=await import('../server/security.js');
const realFetch=fetch;after(()=>{globalThis.fetch=realFetch;});
async function seed(throughput=90){
 await query('truncate app.clients cascade');
 const [client]=await query(`insert into app.clients(name,email,waba_id,phone_id,token_enc,secret_enc,verify_token,throughput,plan_name,monthly_limit,monthly_fee,overage_mode,overage_rate,portal_hash) values('Teste','a@example.com','1','2',$1,'x','x',$2,'Teste',2,100,'block',0.08,'worker-test') returning id`,[encrypt('test'),throughput]);
 const [campaign]=await query("insert into app.campaigns(client_id,name,template_name,language,status,request_key) values($1,'Teste','hello','pt_BR','running',gen_random_uuid()) returning id",[client.id]);
 await query("insert into app.messages(client_id,campaign_id,phone,variables) values($1,$2,'5511999991234','[]'),($1,$2,'5511988881234','[]')",[client.id,campaign.id]);return {cid:client.id,pid:campaign.id};
}
test('consulta de disponibilidade distingue fila vazia, pausa, agendamento e próximo slot sem reservar saldo',async()=>{
 const {cid,pid}=await seed();assert.notEqual(await nextMessageDelay(),null);
 await query("update app.clients set next_dispatch_at=clock_timestamp()+interval '1 second' where id=$1",[cid]);let ms=await nextMessageDelay();assert(ms!==null&&ms>0&&ms<=1000);
 await query("update app.campaigns set scheduled_at=now()+interval '1 day' where id=$1",[pid]);ms=await nextMessageDelay();assert(ms!==null&&ms>23*3600000);assert.equal(await claimMessage(),null);
 await query("update app.campaigns set status='paused' where id=$1",[pid]);assert.equal(await nextMessageDelay(),null);assert.equal((await query('select * from app.usage')).length,0);
});
test('velocidade e reservas continuam no SQL; finalização aceita uma vez e não duplica consumo',async()=>{
 const {cid}=await seed(1);const job=await claimMessage();assert(job);assert.equal(await claimMessage(),null);const ms=await nextMessageDelay();assert(ms!==null&&ms>0&&ms<=1000);
 assert.equal((await query('select reserved from app.usage where client_id=$1',[cid]))[0].reserved,1);
 let sends=0;globalThis.fetch=async()=>{sends++;return Response.json({messages:[{id:'wamid-test'}]});};assert.equal((await dispatchClaimed(job)).temporary,false);
 await query("select app.finish_message($1,'accepted','wamid-test')",[job.message.id]);const [usage]=await query('select * from app.usage where client_id=$1',[cid]);assert.equal(usage.accepted,1);assert.equal(usage.reserved,0);assert.equal(sends,1);
});
test('429, 5xx e timeout sinalizam backoff após finalizar; resultado incerto não volta à fila',async()=>{
 for(const status of [429,503,'timeout']){
  const {cid}=await seed();const job=await claimMessage();let sends=0;
  globalThis.fetch=async()=>{sends++;if(status==='timeout')throw Error('timeout');return Response.json({error:{message:'temporário'}},{status:status as number});};assert.equal((await dispatchClaimed(job)).temporary,true);
  const [message]=await query('select state from app.messages where id=$1',[job.message.id]);assert.equal(message.state,status===429?'failed':'unknown');const [usage]=await query('select * from app.usage where client_id=$1',[cid]);assert.equal(usage.accepted,0);assert.equal(usage.reserved,status===429?0:1);assert.equal(sends,1);
  await query("update app.messages set state='cancelled' where state='queued'");assert.equal(await claimMessage(),null);assert.equal(sends,1);
 }
});
