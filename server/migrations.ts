import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
export async function applyMigrations(db:{query:(sql:string,args?:any[])=>Promise<any>;exec?:(sql:string)=>Promise<any>}){
 // Must run in a transaction. Both services can start concurrently without applying a file twice.
 await db.query('select pg_advisory_xact_lock(827461)');
 await db.query('create table if not exists public.diagchat_migrations (name text primary key, applied_at timestamptz default now())');
 const files=(await readdir(resolve('supabase/migrations'))).filter(f=>/^\d+_[a-z0-9_]+\.sql$/.test(f)).sort();
 for(const file of files){const name=file.replace(/\.sql$/,'');const applied=await db.query('select 1 from public.diagchat_migrations where name=$1',[name]);if(applied.rows.length)continue;
  const sql=await readFile(resolve('supabase/migrations',file),'utf8');if(db.exec)await db.exec(sql);else await db.query(sql);
  if(name==='002_billing_emails'&&process.env.PAYMENT_INSTRUCTIONS){await db.query('insert into app.billing_email_settings(client_id,payment_instructions) select id,$1 from app.clients on conflict do nothing',[process.env.PAYMENT_INSTRUCTIONS]);}
  await db.query('insert into public.diagchat_migrations(name) values($1)',[name]);
 }
}
