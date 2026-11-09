import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DEMO_MODE='true';
const {query}=await import('../server/db.js');
const {analytics,parseAnalyticsFilter}=await import('../server/analytics.js');
test('filtros validam datas e preservam o isolamento do portal',()=>{
 const cid='a99c67de-6f99-4bfd-8854-7d157ae9115e';const other='abcc67de-6f99-4bfd-8854-7d157ae9115e';
 const filter=parseAnalyticsFilter({start:'2025-05-01',end:'2025-05-02'},cid)!;
 assert.equal(filter.clientId,cid);assert.equal(filter.days,2);
 assert.equal(parseAnalyticsFilter({start:'2025-05-01',end:'2025-05-02',client_id:other},cid),null);
 assert.throws(()=>parseAnalyticsFilter({start:'2025-05-03',end:'2025-05-01'}));
 assert.throws(()=>parseAnalyticsFilter({start:'2024-01-01',end:'2025-05-01'}));
 assert.throws(()=>parseAnalyticsFilter({start:'2025-02-30',end:'2025-03-01'}));
});
test('filtra aceites por dia de São Paulo, cliente e competências financeiras',async()=>{
 const ids=[];
 for(let i=0;i<2;i++){
  const [c]=await query(`insert into app.clients(name,email,waba_id,phone_id,token_enc,secret_enc,verify_token,throughput,plan_name,monthly_limit,monthly_fee,overage_mode,overage_rate,cost_rate,portal_hash,created_at) values('Test','test@example.com','1',$1,'x','x','x',80,'Plano',10,100,'charge',0.08,0.02,$2,'2024-01-01') returning id`,[String(i),String(i)]);ids.push(c.id);
  const [p]=await query(`insert into app.campaigns(client_id,name,template_name,language,status,consent_confirmed,request_key) values($1,'Teste','hello','pt_BR','completed',true,gen_random_uuid()) returning id`,[c.id]);
  await query(`insert into app.messages(client_id,campaign_id,phone,state,delivery,accepted_at,period) values($1,$2,'5511999991234','accepted','read','2025-05-02T02:59:59Z','2025-05-01'),($1,$2,'5511988881234','accepted','delivered','2025-05-02T03:00:00Z','2025-05-01')`,[c.id,p.id]);
  await query(`insert into app.import_failures(campaign_id,client_id,report_group_id,sheet_name,row_number,code,message,created_at) values($1,$2,gen_random_uuid(),'Agenda',2,'PHONE_INVALID','Telefone inválido','2025-05-02T02:59:59Z'),($1,$2,gen_random_uuid(),'Agenda',3,'TIME_INVALID','Horário inválido','2025-05-02T03:00:00Z')`,[p.id,c.id]);
  await query(`insert into app.usage(client_id,period,accepted,reserved,monthly_limit,monthly_fee,overage_rate,cost) values($1,'2025-05-01',2,0,10,100,0.08,0.04)`,[c.id]);
 }
 const first=await analytics(parseAnalyticsFilter({start:'2025-05-01',end:'2025-05-01',client_id:ids[0]})!,false);
 assert.equal(first.failed,1);assert.equal(first.sent,1);assert.equal(first.delivered,1);assert.equal(first.read,1);assert.equal(first.clients,1);assert.equal(first.daily.length,1);assert.equal(first.daily[0].sent,1);assert('revenue' in first);assert.equal(first.revenue,100);assert.equal(first.cost,0.04);
 const both=await analytics(parseAnalyticsFilter({start:'2025-05-01',end:'2025-05-02'})!,false);assert.equal(both.failed,4);assert.equal(both.sent,4);assert.equal(both.clients,2);assert.equal(both.average,2);assert.equal(both.daily.length,2);assert.equal(both.daily[1].sent,2);
 const safe=await analytics(parseAnalyticsFilter({start:'2025-05-01',end:'2025-05-02'},ids[0])!,true);assert.equal(safe.failed,2);assert.equal(safe.sent,2);assert(!('revenue' in safe));assert(!('cost' in safe));
 const empty=await analytics(parseAnalyticsFilter({start:'2025-04-01',end:'2025-04-01'})!,false);assert.equal(empty.sent,0);assert.equal(empty.daily[0].sent,0);assert('revenue' in empty);assert.equal(empty.revenue,0);
});
