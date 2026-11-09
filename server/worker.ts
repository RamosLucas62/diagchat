import {processAsaasBilling} from './asaas.js';
import {recordError} from './error-log.js';
import {assertConfigured,demo} from './config.js';
import {pool,prepareDatabase,query} from './db.js';
import {claimMessage,dispatchClaimed,nextMessageDelay,maintenance,processOutbox} from './jobs.js';
import {runDispatchLoop,sleep,workerConcurrency,WorkerMetrics} from './worker-poll.js';
assertConfigured();if(demo)throw new Error('Worker desabilitado na demonstração.');
const concurrency=workerConcurrency();await prepareDatabase();
const stop=new AbortController();process.on('SIGTERM',()=>stop.abort());process.on('SIGINT',()=>stop.abort());
const metrics=new WorkerMetrics();
const measured=(kind:keyof WorkerMetrics['database_calls']):typeof query=>async(sql,values=[])=>{metrics.database_calls[kind]++;return query(sql,values);};
const logError=async(error:unknown,operation:string)=>{await recordError({source:'worker',operation,error});};
async function periodic(operation:string,interval:number,run:()=>Promise<void>,source='worker'){
 let errors=0;
 while(!stop.signal.aborted){
  try{await run();errors=0;}catch(error){errors++;await recordError({source,operation,error});}
  await sleep(Math.max(interval,errors?Math.min(30000,1000*2**Math.min(errors-1,5)):0),stop.signal);
 }
}
async function main(){
 console.log(JSON.stringify({event:'worker_started',instance_id:metrics.instance_id,host:metrics.host,pid:process.pid,concurrency,claim_concurrency:1,idle_poll_ms:5000,max_backoff_ms:30000}));
 // Separate serial loops keep maintenance/billing responsive during idle polling/backoff,
 // and prevent a slow provider notification from stalling message claims.
 const tasks=[
  runDispatchLoop({claim:()=>claimMessage(measured('claim')),deliver:async job=>{const result=await dispatchClaimed(job,measured('finish'));if(result.temporary)throw new Error('Falha temporária da Meta. Resultado registrado, sem reenvio automático.');},nextDelay:()=>nextMessageDelay(measured('availability')),onError:logError},stop.signal,concurrency,metrics),
  periodic('Ciclo de manutenção e notificações',15000,async()=>{await maintenance();await processOutbox();}),
  periodic('Processar fila financeira',5000,processAsaasBilling,'asaas'),
  periodic('Registrar métricas da fila',60000,async()=>{console.log(JSON.stringify(metrics.snapshot()));}),
 ];
 try{await Promise.all(tasks);}finally{stop.abort();await Promise.allSettled(tasks);console.log(JSON.stringify(metrics.snapshot()));await pool.end();}
}
if(!process.env.WORKER_TEST)void main().catch(error=>{console.error(error);process.exitCode=1;});
