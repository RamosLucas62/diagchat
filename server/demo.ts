import {defaultImportProfile} from '../shared/import-profile.js';
import { query } from './db.js';
import {portalSlug} from './portal.js';
import { hash } from './security.js';
export async function seedDemo() {
 const data=[['Aurora Imóveis','Essencial',10000,8490,490,'block'],['Clínica Bem Viver','Profissional',15000,12480,890,'charge'],['Lumina Store','Crescimento',8000,6120,690,'charge'],['Vértice Educação','Essencial',5000,2860,390,'block']];
 for(let i=0;i<data.length;i++){
  const [name,plan,limit,used,fee,mode]=data[i];
  const [c]=await query(`insert into app.clients(name,email,waba_id,phone_id,token_enc,secret_enc,verify_token,throughput,plan_name,monthly_limit,monthly_fee,overage_mode,overage_rate,cost_rate,portal_hash,group_id,created_at)
   values($1,$2,$3,$4,'demo','demo','demonstracao',80,$5,$6,$7,$8,0.08,0.025,$9,'120363000000@g.us',now()-interval '40 days') returning id`,[name,`financeiro@cliente${i+1}.example`,`109900${i}`,`108800${i}`,plan,limit,fee,mode,hash(`demo-${i}`)]);
  await query("update app.clients set portal_slug=$2,default_template_name='novidades_do_mes' where id=$1",[c.id,portalSlug(String(name))]);const profile=defaultImportProfile();profile.fixedTemplate='novidades_do_mes:pt_BR';profile.templates=[{key:profile.fixedTemplate,bindings:[{parameter:'1',label:'Nome',source:'column',aliases:profile.nameAliases,value:'',transform:'first_name',separator:', '}]}];await query('insert into app.import_profiles(client_id,config) values($1,$2)',[c.id,JSON.stringify(profile)]);await query('select app.ensure_usage($1)',[c.id]);await query('update app.usage set accepted=$2::integer,cost=$2::integer*0.025 where client_id=$1',[c.id,used]);
  const [p]=await query(`insert into app.campaigns(client_id,name,template_name,language,status,consent_confirmed,request_key,completed_at) values($1,$2,'novidades_do_mes','pt_BR','completed',true,gen_random_uuid(),now()-interval '2 hours') returning id`,[c.id,['Novidades de outubro','Agenda de atendimentos','Seleção especial','Novas turmas'][i]]);
  await query(`insert into app.messages(campaign_id,client_id,phone,state,delivery,accepted_at,period,cost_rate) select $1,$2,'55119'||lpad(g::text,6,'0'),'accepted',case when g%20=0 then 'failed' when g%5=0 then 'delivered' else 'read' end,now()-((g%least(extract(day from now() at time zone 'America/Sao_Paulo')::int,28))||' days')::interval,app.current_period(),0.025 from generate_series(1,$3::int) g`,[p.id,c.id,used]);
  await query(`insert into app.usage(client_id,period,monthly_limit,monthly_fee,overage_rate,plan_name) select id,app.current_period()-interval '1 month',monthly_limit,monthly_fee,overage_rate,plan_name from app.clients where id=$1`,[c.id]);
  await query(`insert into app.invoices(client_id,period,base_amount,overage_count,overage_amount,total,due_date,status) values($1,app.current_period()-interval '1 month',$2,0,0,$2,app.current_period()+9,$3)`,[c.id,fee,i===2?'open':'paid']);
 }
}
