import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DEMO_MODE='true';
const {query}=await import('../server/db.js');
const {listCampaigns,campaignAction}=await import('../server/campaigns.js');
test('uma solicitação aparece como uma campanha com métricas somadas e ações para todos os lotes',async()=>{
 const [c]=await query(`insert into app.clients(name,email,waba_id,phone_id,token_enc,secret_enc,verify_token,throughput,plan_name,monthly_limit,monthly_fee,overage_mode,overage_rate,portal_hash) values('Teste','a@example.com','1','2','x','x','x',80,'Plano',10,100,'block',0.08,'campaign-test') returning id`);const group=crypto.randomUUID(),ids:string[]=[];
 for(let i=0;i<3;i++){const [p]=await query(`insert into app.campaigns(client_id,name,template_name,language,status,request_key,report_group_id,report_name) values($1,$2,'novidades_do_mes','pt_BR','running',gen_random_uuid(),$3,'Campanha única') returning id`,[c.id,'Lote '+i,group]);ids.push(p.id);await query("insert into app.messages(client_id,campaign_id,phone,state) values($1,$2,'5511999991234',$3)",[c.id,p.id,i===0?'accepted':i===1?'failed':'queued']);}
 let rows=await listCampaigns(c.id);assert.equal(rows.length,1);assert.equal(rows[0].id,group);assert.equal(rows[0].name,'Campanha única');assert.equal(rows[0].total,3);assert.equal(rows[0].sent,1);assert.equal(rows[0].failed,1);assert.equal(rows[0].segment_count,3);
 await campaignAction(group,'pause','demo');assert((await query('select status from app.campaigns')).every(p=>p.status==='paused'));
 await campaignAction(group,'resume','demo');assert((await query('select status from app.campaigns')).every(p=>p.status==='running'));
 await query("update app.campaigns set status='completed' where id=$1",[ids[0]]);assert.equal((await listCampaigns(c.id))[0].status,'running');
 await campaignAction(group,'cancel','demo');assert.equal((await query("select count(*)::int as n from app.messages where state='queued'"))[0].n,0);rows=await listCampaigns(c.id);assert.equal(rows[0].status,'completed');assert.equal((await query('select status from app.campaigns where id=$1',[ids[0]]))[0].status,'completed');
 assert.equal((await listCampaigns(crypto.randomUUID())).length,0);
});
