import {test} from 'node:test';
import assert from 'node:assert/strict';
import {portalSlug,portalTemplate,nextPortalCampaignName} from '../server/portal.js';
process.env.DEMO_MODE='true';
const {query,transaction}=await import('../server/db.js');
test('endereços normalizam acentos e o padrão não escolhe arbitrariamente entre templates',()=>{
 assert.equal(portalSlug('Saúde e Vida'),'saude_e_vida');assert.equal(portalSlug(' API '),'cliente');
 const a={name:'um',language:'pt_BR',supported:true};const b={name:'dois',language:'pt_BR',supported:true};
 assert.equal(portalTemplate({default_template_name:'',default_template_language:'pt_BR'},[a]),a);
 assert.equal(portalTemplate({default_template_name:'',default_template_language:'pt_BR'},[a,b]),undefined);
 assert.equal(portalTemplate({default_template_name:'dois',default_template_language:'pt_BR'},[a,b]),b);
 assert.equal(portalTemplate({default_template_name:'removido',default_template_language:'pt_BR'},[a]),undefined);
});
test('numeração por cliente e data de São Paulo é transacional e reinicia no dia seguinte',async()=>{
 const [c]=await query(`insert into app.clients(name,email,waba_id,phone_id,token_enc,secret_enc,verify_token,throughput,plan_name,monthly_limit,monthly_fee,overage_mode,overage_rate,portal_hash) values('Saúde e Vida','a@example.com','1','2','x','x','x',80,'Essencial',1500,100,'block',0.08,'test-portal') returning id,name`);
 const first=await transaction(db=>nextPortalCampaignName(db,c,'2026-11-11T01:00:00Z'));assert.equal(first,'Saúde e Vida | 10.11.26 | 01');
 const names=await Promise.all([transaction(db=>nextPortalCampaignName(db,c,'2026-11-10T18:00:00Z')),transaction(db=>nextPortalCampaignName(db,c,'2026-11-10T18:00:00Z'))]);assert.deepEqual(names.sort(),['Saúde e Vida | 10.11.26 | 02','Saúde e Vida | 10.11.26 | 03']);
 await assert.rejects(transaction(async db=>{await nextPortalCampaignName(db,c,'2026-11-10T18:00:00Z');throw new Error('rollback');}));
 assert.equal(await transaction(db=>nextPortalCampaignName(db,c,'2026-11-10T18:00:00Z')),'Saúde e Vida | 10.11.26 | 04');
 assert.equal(await transaction(db=>nextPortalCampaignName(db,c,'2026-11-11T15:00:00Z')),'Saúde e Vida | 11.11.26 | 01');
});
