import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const base='http://127.0.0.1:3101';
const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,DEMO_MODE:'true',NODE_ENV:'test',PORT:'3101',APP_URL:base},stdio:['ignore','pipe','pipe']});
let output='';child.stderr.on('data',chunk=>{output+=chunk;});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function call(path:string,method='GET',body?:unknown,token?:string){const headers:Record<string,string>={Origin:base};if(token)headers['X-Portal-Token']=token;if(!(body instanceof FormData))headers['Content-Type']='application/json';const r=await fetch(base+'/api'+path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json().catch(()=>null)};}
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(child.exitCode!==null)throw new Error('Servidor de teste não iniciou: '+output.slice(-1000));await sleep(100);}
 assert.equal((await call('/session')).data.demo,true);assert.equal((await call('/login','POST',{email:'admin@example.com',password:'unused'})).status,400);assert.equal((await call('/login','POST',{email:'admin@example.com'})).data.demo,true);const before=(await call('/clients')).data;assert.equal(before.length,4);
 const response=await call('/clients','POST',{name:'Cliente de homologação',email:'teste@example.com',photo_url:'',waba_id:'999001',phone_id:'999002',group_id:'123@g.us',throughput:80,plan_name:'Teste',monthly_limit:2,monthly_fee:100,overage_mode:'block',overage_rate:0.08,cost_rate:0.02,due_day:10,active:true,default_template_name:'novidades_do_mes',default_template_language:'pt_BR',allow_template_selection:false});assert.equal(response.status,200,JSON.stringify(response.data));const cid=response.data.id;const token=new URL(response.data.portalUrl).hash.slice(1);assert.equal(new URL(response.data.portalUrl).pathname,'/cliente_de_homologacao');const client=(await call('/clients')).data.find((c:any)=>c.id===cid);assert.equal((await call('/clients/'+cid,'PUT',{...client,monthly_limit:1500})).status,200);const edited=(await call('/clients')).data.find((c:any)=>c.id===cid);assert.equal(edited.monthly_limit,1500);assert.equal(edited.current_limit,1500);const slugAuth=await fetch(base+'/api/session',{headers:{'X-Portal-Token':token,'X-Portal-Slug':'outro_cliente'}});assert.equal(slugAuth.status,401);assert.equal((await fetch(base+'/api/session',{headers:{'X-Portal-Slug':'cliente_de_homologacao'}})).status,401);const portalTemplates=await call(`/clients/${cid}/templates`,'GET',undefined,token);assert.equal(portalTemplates.data.length,1);assert.equal(portalTemplates.data[0].name,'novidades_do_mes');
 const mine=await call('/clients','GET',undefined,token);assert.equal(mine.data.length,1);assert.equal(mine.data[0].id,cid);assert(!('token_enc' in mine.data[0]));assert(!('verify_token' in mine.data[0]));assert(!('email' in mine.data[0]));assert.equal((await call('/settings','GET',undefined,token)).status,403);assert.equal((await call('/finance','GET',undefined,token)).status,403);assert.equal((await call(`/clients/${before[0].id}/templates`,'GET',undefined,token)).status,403);
 const form=new FormData();form.append('file',new Blob([await readFile('public/exemplo-importacao.xlsx')]),'exemplo.xlsx');const preview=await call('/import','POST',form,token);assert.equal(preview.status,200,JSON.stringify(preview.data));assert.equal(preview.data.length,2);assert.equal(preview.data[0].headerRow,8);assert.equal(preview.data[0].duplicates,1);
 const campaign={client_id:cid,name:'Teste completo',template_name:'novidades_do_mes',language:'pt_BR',scheduled_at:new Date().toISOString(),consent_confirmed:true,request_key:crypto.randomUUID(),recipients:preview.data[0].rows.map((r:any)=>({phone:r.phone,variables:[r.name]}))};
 assert.equal((await call('/campaigns','POST',campaign,token)).status,403);
 const created=await call('/campaigns','POST',campaign);assert.equal(created.status,200,JSON.stringify(created.data));const duplicate=await call('/campaigns','POST',campaign);assert.equal(duplicate.data.id,created.data.id);
 const campaigns=(await call('/campaigns','GET',undefined,token)).data;assert.equal(campaigns.length,1);assert.equal(campaigns[0].status,'running');assert.equal(campaigns[0].total,2);assert.equal((await call(`/campaigns/${created.data.id}/action`,'POST',{action:'pause'},token)).status,403);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const analytics=(await call(`/analytics?start=${today}&end=${today}`,'GET',undefined,token)).data;assert.equal(analytics.clients,1);assert(!('revenue' in analytics));assert.equal((await call(`/analytics?start=${today}&end=${today}&client_id=${before[0].id}`,'GET',undefined,token)).status,403);
 const metric=(await call('/metrics','GET',undefined,token)).data;assert(!('revenue' in metric));assert(!('cost' in metric));assert.equal(metric.clients,1);
 const emailConfig=await call(`/finance/email-settings/${cid}`);assert.equal(emailConfig.status,200);assert.equal(emailConfig.data.profile.auto_send,true);
 const updatedEmail={...emailConfig.data.profile,auto_send:false,subject_template:'Fatura {{cliente_nome}}',body_template:'Total {{total}}. {{instrucoes_pagamento}}',payment_instructions:'PIX de teste'};
 assert.equal((await call(`/finance/email-settings/${cid}`,'PUT',updatedEmail,token)).status,403);
 const savedEmail=await call(`/finance/email-settings/${cid}`,'PUT',updatedEmail);assert.equal(savedEmail.status,200);assert.equal(savedEmail.data.auto_send,false);assert.equal(savedEmail.data.version,1);
 assert.equal((await call(`/finance/email-settings/${cid}`,'PUT',updatedEmail)).status,409);
 assert.equal((await call(`/finance/email-settings/${cid}`,'PUT',{...updatedEmail,version:1,body_template:'{{segredo}}'})).status,400);
 assert.equal((await call('/finance/email-settings','GET',undefined,token)).status,403);
 const persistedEmail=await call(`/finance/email-settings/${cid}`);assert.equal(persistedEmail.data.profile.payment_instructions,'PIX de teste');
 const openInvoice=(await call('/finance')).data.find((i:any)=>i.status==='open');assert(openInvoice);assert.equal((await call(`/finance/${openInvoice.id}/report`,'GET',undefined,token)).status,403);const pdf=await fetch(base+`/api/finance/${openInvoice.id}/report`);assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
 assert.equal((await call(`/finance/${openInvoice.id}/email`,'POST',undefined,token)).status,403);
 const queuedEmail=await call(`/finance/${openInvoice.id}/email`,'POST');assert.equal(queuedEmail.status,200);const repeatedEmail=await call(`/finance/${openInvoice.id}/email`,'POST');assert.equal(queuedEmail.data.id,repeatedEmail.data.id);
 const invoiceAfter=(await call('/finance')).data.find((i:any)=>i.id===openInvoice.id);assert.equal(invoiceAfter.email_status,'pending');
 const openProfile=(await call(`/finance/email-settings/${openInvoice.client_id}`)).data.profile;await call(`/finance/email-settings/${openInvoice.client_id}`,'PUT',{...openProfile,auto_send:false});
 // An explicit manual request is not cancelled by the automatic-mail preference.
 assert.equal((await call('/finance')).data.find((i:any)=>i.id===openInvoice.id).email_status,'pending');
 // Error history is restricted to the team and supports resolving an event.
 assert.equal((await call('/error-logs','GET',undefined,token)).status,403);
 const browserEvent=await call('/error-events','POST',{operation:'Teste de interface',message:'Falha de teste sem dados pessoais'},token);assert.equal(browserEvent.status,200);
 const events=(await call('/error-logs?source=browser&status=open')).data;const browserLog=events.find((e:any)=>e.message==='Falha de teste sem dados pessoais');assert(browserLog);assert(browserLog.occurred_at);assert.equal(browserLog.client_id,cid);assert.equal((await call(`/error-logs/${browserLog.id}/resolve`,'POST',{},token)).status,403);assert.equal((await call(`/error-logs/${browserLog.id}/resolve`,'POST')).status,200);assert((await call('/error-logs?source=browser&status=resolved')).data.some((e:any)=>e.id===browserLog.id));
 // Payment confirmation is idempotent and freezes the amount and timestamp.
 assert.equal((await call(`/finance/${openInvoice.id}/paid`,'POST')).status,200);const paid=(await call('/finance')).data.find((i:any)=>i.id===openInvoice.id);assert.equal(paid.status,'paid');assert.equal(Number(paid.paid_total),Number(paid.amount_due));assert.equal((await call(`/finance/${openInvoice.id}/paid`,'POST')).status,200);const paidAgain=(await call('/finance')).data.find((i:any)=>i.id===openInvoice.id);assert.equal(paidAgain.paid_at,paid.paid_at);assert.equal(paidAgain.amount_due,paid.amount_due);
 const links=await Promise.all(Array.from({length:3},()=>call(`/clients/${cid}/portal`,'POST')));assert(links.every(r=>r.status===200));
 const tokens=[token,...links.map(r=>new URL(r.data.url).hash.slice(1))];assert.equal(new Set(tokens).size,4);
 for(const linkToken of tokens){const own=await call('/clients','GET',undefined,linkToken);assert.equal(own.status,200);assert.equal(own.data.length,1);assert.equal(own.data[0].id,cid);assert.equal((await call('/finance','GET',undefined,linkToken)).status,403);}
 assert.equal((await call(`/clients/${cid}/portal`,'POST',{},tokens[1])).status,403);
 assert.equal((await fetch(base+'/api/session',{headers:{'X-Portal-Token':tokens[1],'X-Portal-Slug':'outro_cliente'}})).status,401);
 assert.equal((await call('/clients/'+cid,'PUT',{...edited,active:false})).status,200);
 for(const linkToken of tokens)assert.equal((await call('/session','GET',undefined,linkToken)).status,401);
 assert.equal((await call('/clients/'+cid,'PUT',{...edited,active:true})).status,200);
 for(const linkToken of tokens)assert.equal((await call('/session','GET',undefined,linkToken)).status,200);
 const wrongOrigin=await fetch(base+'/api/logout',{method:'POST',headers:{Origin:'https://untrusted.example'}});assert.equal(wrongOrigin.status,403);
 console.log('Integração HTTP com histórico de erros privado e pagamento idempotente: cadastro, portal isolado, importação, campanha, idempotência, aprovação, vários links simultâneos sem invalidar os anteriores, modelos financeiros por cliente, controle de versão, envio manual e origem validados.');
}finally{child.kill('SIGTERM');}
