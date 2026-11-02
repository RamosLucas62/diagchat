import {test,after} from 'node:test';
import assert from 'node:assert/strict';
process.env.DEMO_MODE='true';process.env.ASAAS_TEST='true';
const {query,transaction}=await import('../server/db.js');
const {config}=await import('../server/config.js');
const {queueInvoiceEmail}=await import('../server/billing.js');
const {processAsaasBilling,paymentPayload,reference}=await import('../server/asaas.js');
const {processOutbox}=await import('../server/jobs.js');
const {asaasWebhook}=await import('../server/asaas-routes.js');
const {emptyFiscal}=await import('../shared/asaas.js');
const {documentUrl,downloadAsaasPdf}=await import('../server/asaas-documents.js');
const realFetch=globalThis.fetch;after(()=>{globalThis.fetch=realFetch;});
const fiscal={...emptyFiscal,municipalServiceCode:'1.01',municipalServiceName:'Serviço cadastrado'};
async function seed(){
 await query('truncate app.clients,app.outbox,app.asaas_events cascade');await query('update app.asaas_settings set enabled=true,fiscal=$1',[JSON.stringify(fiscal)]);
 config.asaasKey='sandbox-key';config.asaasWebhookToken='a'.repeat(48);config.asaasEnvironment='sandbox';config.resend='resend-test';config.from='financeiro@example.com';
 const [c]=await query(`insert into app.clients(name,email,waba_id,phone_id,token_enc,secret_enc,verify_token,throughput,plan_name,monthly_limit,monthly_fee,overage_mode,overage_rate,portal_hash,asaas_customer_id) values('Cliente','c@example.com','1','2','x','x','v',80,'Plano',1500,550,'charge',0.35,'hash','cus_test') returning id`);
 await query('select app.ensure_usage($1)',[c.id]);
 const [i]=await query(`insert into app.invoices(client_id,period,base_amount,overage_count,overage_amount,total,due_date,late_interest_rate,late_interest_basis) values($1,app.current_period(),550,0,0,550,current_date+10,1,'monthly') returning *`,[c.id]);await transaction(db=>queueInvoiceEmail(db,i.id,true));return i;
}
function provider(i:any){let payment:any,nf:any,authorized=false,timeoutPayment=false,timeoutNf=false;const calls:{url:string;method:string;body:any;headers:any}[]=[];let email:any;
 globalThis.fetch=async(input,options)=>{const url=String(input),method=options?.method||'GET',body=options?.body?JSON.parse(String(options.body)):null;calls.push({url,method,body,headers:options?.headers});
  if(url==='https://api.resend.com/emails'){email=body;return Response.json({id:'email_test'});}
  if(url.includes('/documents/')){assert(!options?.headers||!('access_token' in options.headers));return new Response('%PDF-1.4\nMock document');}
  if(url.includes('/payments?'))return Response.json({totalCount:payment?1:0,data:payment?[payment]:[]});
  if(url.endsWith('/payments')&&method==='POST'){payment={...body,id:'pay_test',status:'PENDING',originalValue:null,bankSlipUrl:'https://sandbox.asaas.com/documents/boleto',invoiceUrl:'https://sandbox.asaas.com/i/test',netValue:548};if(timeoutPayment)throw new Error('timeout');return Response.json(payment);}
  if(url.endsWith('/payments/pay_test'))return Response.json(payment);
  if(url.includes('/invoices?'))return Response.json({totalCount:nf?1:0,data:nf?[nf]:[]});
  if(url.endsWith('/invoices')&&method==='POST'){nf={...body,id:'inv_test',status:'SCHEDULED'};if(timeoutNf)throw new Error('timeout');return Response.json(nf);}
  if(url.endsWith('/invoices/inv_test'))return Response.json({...nf,status:authorized?'AUTHORIZED':nf.status,pdfUrl:authorized?'https://sandbox.asaas.com/documents/nf':null,xmlUrl:authorized?'https://sandbox.asaas.com/documents/nf.xml':null,number:authorized?'100':null});
  throw new Error('Unexpected URL '+url);
 };
 return {calls,get payment(){return payment;},get nf(){return nf;},get email(){return email;},authorize(){authorized=true;},timeoutPayment(){timeoutPayment=true;},timeoutNf(){timeoutNf=true;}};
}
async function webhook(body:any,token=config.asaasWebhookToken){let status=0;await asaasWebhook({body,get:()=>token} as any,{sendStatus:(s:number)=>{status=s;return {};}} as any,()=>{});return status;}
async function wake(){await query("update app.asaas_billing set status='pending',next_attempt_at=now()");await query('update app.outbox set next_attempt_at=now()');}
test('boleto e NFS-e são vinculados, aguardam autorização e seguem com relatório em um único e-mail',async()=>{
 const i=await seed(),remote=provider(i);await processAsaasBilling();let [job]=await query('select * from app.asaas_billing');assert.equal(job.status,'waiting');assert.equal(remote.calls.filter(c=>c.method==='POST').length,2);assert.equal(remote.calls.some(c=>c.url.includes('/customers')),false);assert.equal(remote.nf.payment,'pay_test');assert.equal(remote.nf.value,550);assert.equal(remote.nf.updatePayment,false);assert.deepEqual(remote.nf.taxes,fiscal.taxes);await processOutbox();assert.equal(remote.email,undefined);assert.equal((await query('select * from app.outbox'))[0].first_attempt_at,null);
 remote.authorize();const event={id:'evt_nf',event:'INVOICE_AUTHORIZED',invoice:{id:'inv_test',pdfUrl:'http://evil.local/secret'}};assert.equal(await webhook(event),200);assert.equal(await webhook(event),200);assert.equal((await query('select * from app.asaas_events')).length,1);await processAsaasBilling();[job]=await query('select * from app.asaas_billing');assert.equal(job.status,'ready');assert.equal(job.nf_number,'100');await query('update app.outbox set next_attempt_at=now()');await processOutbox();const sentEmail=remote.email as any;assert.equal(sentEmail.attachments.length,3);assert(sentEmail.attachments.some((a:any)=>a.filename==='boleto.pdf'));assert(sentEmail.attachments.some((a:any)=>a.filename==='nota-fiscal.pdf'));assert.equal((await query('select * from app.outbox'))[0].status,'sent');await processOutbox();assert.equal(remote.calls.filter(c=>c.url==='https://api.resend.com/emails').length,1);
});
test('webhook autentica e concilia valor bruto, líquido e data sem confiar no valor recebido no corpo',async()=>{
 const i=await seed(),remote=provider(i);await processAsaasBilling();remote.payment.status='RECEIVED';remote.payment.value=560;remote.payment.originalValue=550;remote.payment.netValue=558;remote.payment.clientPaymentDate='2026-11-11';
 const event={id:'evt_paid',event:'PAYMENT_RECEIVED',payment:{id:'pay_test',value:1,customer:'cus_other'}};assert.equal(await webhook(event,'invalid'),403);assert.equal((await query('select * from app.asaas_events')).length,0);assert.equal(await webhook(event),200);assert.equal(await webhook(event),200);await processAsaasBilling();const [invoice]=await query('select * from app.invoices where id=$1',[i.id]);assert.equal(invoice.status,'paid');assert.equal(Number(invoice.paid_total),560);let [job]=await query('select * from app.asaas_billing');assert.equal(Number(job.net_value),558);assert.equal(Number(job.gross_value),560);assert(job.received_at);assert.equal(new Date(job.client_payment_date).toISOString().slice(0,10),'2026-11-11');
 assert.equal(await webhook({id:'evt_old',event:'PAYMENT_CONFIRMED',payment:{id:'pay_test',value:550}}),200);await processAsaasBilling();[job]=await query('select * from app.asaas_billing');assert.equal(job.payment_status,'RECEIVED');assert.equal(remote.calls.filter(c=>c.method==='POST').length,2);
});
test('timeout na criação reconcilia pela referência externa sem duplicar cobrança nem nota',async()=>{
 for(const kind of ['payment','nf']){const i=await seed(),remote=provider(i);if(kind==='payment')remote.timeoutPayment();else remote.timeoutNf();await processAsaasBilling();assert.equal((await query('select * from app.asaas_billing'))[0].status,'review');await wake();await processAsaasBilling();assert.equal((await query('select * from app.asaas_billing'))[0].status,'waiting');assert.equal(remote.calls.filter(c=>c.url.endsWith('/payments')&&c.method==='POST').length,1);assert.equal(remote.calls.filter(c=>c.url.endsWith('/invoices')&&c.method==='POST').length,1);}
});
test('tentativa incerta sem registro encontrado fica em revisão sem repetir POST',async()=>{
 const i=await seed();const remote=provider(i);await query('update app.asaas_billing set payment_attempted=true');await processAsaasBilling();const [job]=await query('select * from app.asaas_billing');assert.equal(job.status,'review');assert.match(job.last_error,/incerto/);assert.equal(remote.calls.filter(c=>c.method==='POST').length,0);await processOutbox();assert.equal(remote.email,undefined);const [log]=await query("select * from app.error_logs where source='asaas'");assert(log);
});
test('cliente errado, valor divergente e falha fiscal não liberam documentos nem dão baixa',async()=>{
 for(const problem of ['customer','value','fiscal']){const i=await seed(),remote=provider(i);await processAsaasBilling();if(problem==='customer')remote.payment.customer='cus_other';else if(problem==='value')remote.payment.value=1;else remote.nf.status='ERROR';if(problem!=='fiscal')remote.payment.status='RECEIVED';await wake();await processAsaasBilling();assert.equal((await query('select * from app.asaas_billing'))[0].status,'review');assert.equal((await query('select * from app.invoices'))[0].status,'open');await processOutbox();assert.equal(remote.email,undefined);}
});
test('juros diários são convertidos para a base mensal e a cobrança usa o principal sem somar juros duas vezes',()=>{
 const job={customer_id:'cus_test',invoice_id:crypto.randomUUID(),total:'550.00',due_date:'2030-11-10',period:'2030-10-01',late_interest_rate:0.1,late_interest_basis:'daily'};const body=paymentPayload(job);assert.equal(body.interest.value,3);assert.equal(body.value,550);assert.equal(body.externalReference,reference(job.invoice_id));
});
test('pagador ausente e ambiente divergente bloqueiam operações externas',async()=>{
 for(const issue of ['customer','environment']){const i=await seed(),remote=provider(i);await query(issue==='customer'?"update app.asaas_billing set customer_id=''":"update app.asaas_billing set environment='production'");await processAsaasBilling();assert.equal(remote.calls.length,0);assert.equal((await query('select * from app.asaas_billing'))[0].status,'review');}
});
test('estorno registra a devolução para revisão e bloqueia envio de cobrança automática',async()=>{
 const i=await seed(),remote=provider(i);await processAsaasBilling();remote.payment.status='RECEIVED';await wake();await processAsaasBilling();assert.equal((await query('select * from app.invoices'))[0].status,'paid');remote.payment.status='REFUNDED';remote.payment.refunds=[{status:'DONE',value:550}];await webhook({id:'evt_refund',event:'PAYMENT_REFUNDED',payment:{id:'pay_test'}});await processAsaasBilling();assert.equal((await query('select * from app.invoices'))[0].status,'refunded');const [job]=await query('select * from app.asaas_billing');assert.equal(Number(job.refund_value),550);assert.equal(job.status,'review');assert.equal((await query('select * from app.outbox'))[0].status,'held');
});
test('download não envia segredos, rejeita HTML e bloqueia URL externa ou redirecionamento indevido',async()=>{
 assert.throws(()=>documentUrl('http://asaas.com/a'));assert.throws(()=>documentUrl('https://asaas.com.evil.test/a'));assert.throws(()=>documentUrl('https://127.0.0.1/a'));assert.throws(()=>documentUrl('https://user:password@asaas.com/a'));
 globalThis.fetch=async()=>new Response('<html>Not a PDF</html>');await assert.rejects(()=>downloadAsaasPdf('https://asaas.com/a'),/não é PDF/);
 globalThis.fetch=async()=>new Response(null,{status:302,headers:{location:'https://evil.test/a'}});await assert.rejects(()=>downloadAsaasPdf('https://asaas.com/a'),/Domínio/);
});

test('documentos ainda são enviados se o cliente pagar enquanto aguarda a autorização fiscal',async()=>{
 const i=await seed(),remote=provider(i);await processAsaasBilling();remote.payment.status='CONFIRMED';await webhook({id:'evt_confirmed_early',event:'PAYMENT_CONFIRMED',payment:{id:'pay_test'}});await processAsaasBilling();remote.authorize();await webhook({id:'evt_nf_late',event:'INVOICE_AUTHORIZED',invoice:{id:'inv_test'}});await processAsaasBilling();await query('update app.outbox set next_attempt_at=now()');await processOutbox();assert.equal((remote.email as any).attachments.length,3);assert.match((remote.email as any).text,/Não efetue um novo pagamento/);
});
test('duas execuções concorrentes não criam documentos duplicados e e-mail em espera não consome tentativas',async()=>{
 const i=await seed(),remote=provider(i);await Promise.all([processAsaasBilling(),processAsaasBilling()]);assert.equal(remote.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/payments')).length,1);assert.equal(remote.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/invoices')).length,1);await processOutbox();assert.equal((await query('select * from app.outbox'))[0].attempts,0);
});
test('rejeição definitiva de criação permite corrigir a configuração sem classificar como timeout incerto',async()=>{
 const i=await seed();const remote=provider(i);const mock=globalThis.fetch;globalThis.fetch=async(input,options)=>String(input).endsWith('/payments')&&options?.method==='POST'?Response.json({errors:[{description:'Vencimento inválido'}]},{status:400}):mock(input,options);await processAsaasBilling();const [job]=await query('select * from app.asaas_billing');assert.equal(job.status,'review');assert.equal(job.payment_attempted,false);globalThis.fetch=mock;await wake();await processAsaasBilling();assert.equal((await query('select * from app.asaas_billing'))[0].status,'waiting');assert.equal(remote.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/payments')).length,1);
});
test('limite de juros Asaas é validado antes de marcar tentativa de criação',async()=>{
 const i=await seed(),remote=provider(i);await query("update app.invoices set late_interest_rate=1,late_interest_basis='daily'");await processAsaasBilling();const [job]=await query('select * from app.asaas_billing');assert.match(job.last_error,/10%/);assert.equal(job.payment_attempted,false);assert.equal(remote.calls.filter(c=>c.method==='POST').length,0);
});
