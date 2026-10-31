import { assertConfigured,demo } from './config.js';
import { pool,prepareDatabase } from './db.js';
import { dispatchOne,maintenance,processOutbox } from './jobs.js';
assertConfigured();if(demo)throw new Error('Worker desabilitado na demonstração.');
await prepareDatabase();
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function main(){
 let last=0;const active=new Set<Promise<unknown>>();const concurrency=Math.max(1,Math.min(100,Number(process.env.WORKER_CONCURRENCY||16)));
 while(!stopping){
  try{
   if(Date.now()-last>15000){await maintenance();await processOutbox();last=Date.now();}
   if(active.size<concurrency){const task=dispatchOne().catch(()=>{console.error('Falha no processamento da fila. Verifique a conexão do banco.');}).finally(()=>active.delete(task));active.add(task);}
  }catch{console.error('Falha no ciclo do worker. Nova tentativa em 5 segundos.');await sleep(5000);}
  await sleep(10);
 }
 await Promise.allSettled(active);await pool.end();
}
if(!process.env.WORKER_TEST)main();
