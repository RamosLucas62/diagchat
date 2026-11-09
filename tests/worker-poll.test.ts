import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runDispatchLoop,WorkerMetrics,workerConcurrency} from '../server/worker-poll.js';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('fila vazia consulta uma vez a cada 5 segundos sem multiplicar pela concorrência',async()=>{
 const stop=new AbortController(),metrics=new WorkerMetrics();let time=0,claims=0,reads=0;const waits:number[]=[];
 await runDispatchLoop({claim:async()=>{claims++;return null;},nextDelay:async()=>{reads++;return null;},deliver:async()=>assert.fail('Não pode enviar sem reserva'),onError:async()=>assert.fail('Sem erros'),now:()=>time,wait:async ms=>{waits.push(ms);time+=ms;if(time>=60000)stop.abort();}},stop.signal,16,metrics);
 assert.equal(claims,12);assert.equal(reads,12);assert.deepEqual(waits,Array(12).fill(5000));assert.equal(metrics.idle_periods,12);assert.equal(metrics.idle_ms,60000);assert.equal(metrics.messages_found,0);
});
test('buscas são seriais, envios ocupam slots e encerramento aguarda finalizações',async()=>{
 const stop=new AbortController(),metrics=new WorkerMetrics();let claims=0,claiming=0,maxClaims=0;const releases:(()=>void)[]=[];
 const running=runDispatchLoop({claim:async()=>{claiming++;maxClaims=Math.max(maxClaims,claiming);await tick();claiming--;return ++claims;},deliver:async()=>new Promise<void>(resolve=>releases.push(resolve)),nextDelay:async()=>null,onError:async()=>{},wait:async()=>tick()},stop.signal,3,metrics);
 while(releases.length<3)await tick();await tick();assert.equal(claims,3);assert.equal(metrics.in_flight,3);assert.equal(maxClaims,1);releases[0]();while(releases.length<4)await tick();assert.equal(claims,4);stop.abort();let ended=false;void running.then(()=>{ended=true;});await tick();assert.equal(ended,false);for(const done of releases)done();await running;assert.equal(metrics.in_flight,0);assert.equal(metrics.dispatch_completed,4);
});
test('slot futuro de throughput usa milissegundos e não o intervalo ocioso',async()=>{
 const stop=new AbortController(),metrics=new WorkerMetrics();let claims=0;const waits:number[]=[];
 await runDispatchLoop({claim:async()=>++claims===1?null:1,nextDelay:async()=>11,deliver:async()=>{stop.abort();},onError:async()=>{},wait:async ms=>{waits.push(ms);await tick();}},stop.signal,16,metrics);
 assert.equal(metrics.messages_found,1);assert.equal(waits[0],11);assert.equal(metrics.idle_periods,0);
});
test('erros de reserva aplicam backoff 1, 2, 4, 8, 16, 30 segundos e recuperação reseta a sequência',async()=>{
 const stop=new AbortController(),metrics=new WorkerMetrics();let time=0,calls=0,errors=0;const waits:number[]=[];
 await runDispatchLoop({claim:async()=>{calls++;if(calls<=7||calls===9)throw Error('temporário');return null;},nextDelay:async()=>null,deliver:async()=>{},onError:async()=>{errors++;},now:()=>time,wait:async ms=>{waits.push(ms);time+=ms;if(calls===9)stop.abort();}},stop.signal,16,metrics);
 assert.deepEqual(waits,[1000,2000,4000,8000,16000,30000,30000,5000,1000]);assert.equal(errors,8);assert.equal(metrics.claim_errors,8);assert.equal(metrics.backoff_ms,92000);
});
test('falha ao finalizar pausa novas reservas sem reenviar a mensagem já reservada',async()=>{
 const stop=new AbortController(),metrics=new WorkerMetrics();let time=0,claimed=0;const sent:number[]=[],waits:number[]=[];
 await runDispatchLoop({claim:async()=>++claimed,deliver:async job=>{sent.push(job);throw Error('finish indisponível');},nextDelay:async()=>null,onError:async()=>{},now:()=>time,wait:async ms=>{waits.push(ms);time+=ms;await tick();if(sent.length===4&&ms>1)stop.abort();}},stop.signal,1,metrics);
 assert.deepEqual(sent,[1,2,3,4]);assert.deepEqual(waits.filter(ms=>ms>1),[1000,2000,4000,8000]);assert.equal(metrics.dispatch_errors,4);
});
test('erro ao consultar disponibilidade também tem espera, mesmo se o histórico de erros falhar',async()=>{
 const stop=new AbortController(),metrics=new WorkerMetrics();let time=0;const waits:number[]=[];
 await runDispatchLoop({claim:async()=>null,nextDelay:async()=>{throw Error('db');},deliver:async()=>{},onError:async()=>{throw Error('log indisponível');},now:()=>time,wait:async ms=>{waits.push(ms);time+=ms;if(waits.length===3)stop.abort();}},stop.signal,16,metrics);assert.deepEqual(waits,[1000,2000,4000]);
});
test('concorrência inválida é rejeitada em vez de produzir um loop sem trabalho',()=>{
 assert.equal(workerConcurrency(),16);for(const value of ['NaN','0','101','1.5'])assert.throws(()=>workerConcurrency(value));assert.equal(workerConcurrency('32'),32);
});
test('throughput alto não recebe um piso artificial de 5 segundos ou 5 milissegundos',async()=>{
 const stop=new AbortController();const waits:number[]=[];
 await runDispatchLoop({claim:async()=>null,nextDelay:async()=>2,deliver:async()=>{},onError:async()=>{},wait:async ms=>{waits.push(ms);stop.abort();}},stop.signal,16);assert.deepEqual(waits,[2]);
});
test('fila aparentemente disponível mas sem reserva evita polling intenso sob contenção',async()=>{
 const stop=new AbortController();const waits:number[]=[];
 await runDispatchLoop({claim:async()=>null,nextDelay:async()=>0,deliver:async()=>{},onError:async()=>{},wait:async ms=>{waits.push(ms);if(waits.length===8)stop.abort();}},stop.signal,16);assert.deepEqual(waits,[10,20,40,80,160,320,500,500]);
});
