import 'dotenv/config';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pool } from './db.js';
const db=await pool.connect();
try {await db.query('begin');await db.query('select pg_advisory_xact_lock(827461)');await db.query('create table if not exists public.diagchat_migrations (name text primary key, applied_at timestamptz default now())');
const name='001_initial';const applied=await db.query('select 1 from public.diagchat_migrations where name=$1',[name]);
if(!applied.rowCount){await db.query(await readFile(resolve('supabase/migrations/001_initial.sql'),'utf8'));await db.query('insert into public.diagchat_migrations(name) values($1)',[name]);}
await db.query('commit');console.log('Banco atualizado.');}catch(e){await db.query('rollback');throw e;}finally{db.release();await pool.end();}
