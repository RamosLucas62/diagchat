import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DEMO_MODE='true';
const {query}=await import('../server/db.js');
const {recordError,safeErrorText}=await import('../server/error-log.js');
test('histórico persiste descrição, origem, operação, horário e referência sem credenciais',async()=>{
 process.env.RESEND_API_KEY='re_super_private_test_key';
 await recordError({source:'resend',operation:'Enviar cobrança',code:'HTTP_401',error:new Error('Provedor recusou token=re_super_private_test_key para a@example.com'),details:'Arquivo worker.ts:42',requestId:'test-reference'});
 const [event]=await query("select * from app.error_logs where request_id='test-reference'");assert.equal(event.source,'resend');assert.equal(event.operation,'Enviar cobrança');assert.equal(event.code,'HTTP_401');assert.equal(event.resolved_at,null);assert(event.occurred_at);assert(event.message.includes('Provedor recusou'));assert(!event.message.includes('re_super_private_test_key'));assert(!event.message.includes('a@example.com'));
 const clean=safeErrorText('postgresql://user:pass@db:5432/private Bearer abc123 password=secret 5511999991234');assert(!clean.includes('pass@'));assert(!clean.includes('abc123'));assert(!clean.includes('=secret'));assert(!clean.includes('5511999991234'));
});
