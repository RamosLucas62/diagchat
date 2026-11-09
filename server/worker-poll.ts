import {randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
export const workerConcurrency=(value=process.env.WORKER_CONCURRENCY)=>{const n=Number(value??16);if(!Number.isInteger(n)||n<1||n>100)throw new Error('WORKER_CONCURRENCY precisa ser um inteiro entre 1 e 100.');return n;};
export class WorkerMetrics {
 readonly startedAt=Date.now();readonly instance_id=randomUUID();readonly host=hostname();
 database_calls={claim:0,availability:0,finish:0};
 messages_found=0;empty_claims=0;dispatch_completed=0;claim_errors=0;dispatch_errors=0;
 idle_periods=0;idle_ms=0;backoff_periods=0;backoff_ms=0;in_flight=0;max_in_flight=0;
 snapshot(){return {event:'worker_queue_metrics',pid:process.pid,at:new Date().toISOString(),uptime_ms:Date.now()-this.startedAt,...this,database_calls:{...this.database_calls},queue_database_calls:Object.values(this.database_calls).reduce((a,b)=>a+b,0)};}
}
export async function sleep(ms:number,signal:AbortSignal){try{await delay(ms,undefined,{signal});}catch(e){if(!signal.aborted)throw e;}}
type Dependencies<Job>={
 claim:()=>Promise<Job|null>;deliver:(job:Job)=>Promise<unknown>;nextDelay:()=>Promise<number|null>;
 onError:(error:unknown,operation:string)=>Promise<void>;
 wait?:(ms:number,signal:AbortSignal)=>Promise<void>;now?:()=>number;
};
// A single producer claims serially. Only delivery/finalization uses the concurrency slots.
export async function runDispatchLoop<Job>(deps:Dependencies<Job>,signal:AbortSignal,concurrency:number,metrics=new WorkerMetrics()){
 const active=new Set<Promise<void>>(),wait=deps.wait||sleep,now=deps.now||(()=>performance.now());
 let retryAt=0,errorStreak=0,errorVersion=0,lastErrorWasDispatch=false,emptyReadyStreak=0;
 const error=async(e:unknown,operation:string,dispatch=false)=>{
  errorVersion++;lastErrorWasDispatch=dispatch;
  errorStreak=Math.min(errorStreak+1,6);
  retryAt=Math.max(retryAt,now()+Math.min(30000,1000*2**(errorStreak-1)));
  // Logging failure cannot turn a database outage into a hot rejection loop.
  try{await deps.onError(e,operation);}catch{}
 };
 try{
  while(!signal.aborted){
   if(now()<retryAt){const started=now();metrics.backoff_periods++;await wait(retryAt-started,signal);metrics.backoff_ms+=Math.max(0,now()-started);continue;}
   if(active.size>=concurrency){await Promise.race(active);continue;}
   let job:Job|null;
   try{job=await deps.claim();}catch(e){metrics.claim_errors++;await error(e,'Reservar mensagem da fila');continue;}
   if(job!==null){
    metrics.messages_found++;emptyReadyStreak=0;
    const version=errorVersion;
    const task=Promise.resolve().then(()=>deps.deliver(job)).then(()=>{
     metrics.dispatch_completed++;
     // A completed delivery includes durable finish_message; a successful claim alone
     // must not reset repeated finalization errors during a database outage.
     if(version===errorVersion&&now()>=retryAt)errorStreak=0;
    }).catch(async e=>{metrics.dispatch_errors++;await error(e,'Enviar ou finalizar mensagem reservada',true);}).finally(()=>{active.delete(task);metrics.in_flight=active.size;});
    active.add(task);metrics.in_flight=active.size;metrics.max_in_flight=Math.max(metrics.max_in_flight,active.size);
    // Yield even with synchronous test/adaptor promises; PostgreSQL still controls throughput.
    await wait(1,signal);continue;
   }
   metrics.empty_claims++;
   let next:number|null;const version=errorVersion;
   try{next=await deps.nextDelay();if(version===errorVersion&&!lastErrorWasDispatch&&now()>=retryAt)errorStreak=0;}catch(e){metrics.claim_errors++;await error(e,'Consultar próxima disponibilidade da fila');continue;}
   if(signal.aborted)break;
   // A future throttle/schedule is not an empty queue. Never sleep 5 s between
   // messages for a busy client whose next throughput slot is milliseconds away.
   emptyReadyStreak=next!==null&&next<=0?Math.min(emptyReadyStreak+1,7):0;
   const ms=next===null?5000:next<=0?Math.min(500,10*2**(emptyReadyStreak-1)):Math.min(5000,Math.max(1,Math.ceil(next)));
   const started=now();if(next===null)metrics.idle_periods++;
   await wait(ms,signal);if(next===null)metrics.idle_ms+=Math.max(0,now()-started);
  }
 }finally{await Promise.allSettled(active);}
 return metrics;
}
