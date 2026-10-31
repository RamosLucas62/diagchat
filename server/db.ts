import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { config, demo } from './config.js';
export type DB = {query:(sql:string,values?:any[])=>Promise<{rows:any[];rowCount?:number|null}>};
export const pool = new pg.Pool({connectionString:config.database,max:20,connectionTimeoutMillis:10000,statement_timeout:30000});
let memory:any;
if(demo){const {PGlite}=await import('@electric-sql/pglite');memory=new PGlite();await memory.exec(await readFile(new URL('../supabase/migrations/001_initial.sql',import.meta.url),'utf8'));}
export async function query(sql:string,values:unknown[]=[]):Promise<any[]> {return (await (memory||pool).query(sql,values)).rows;}
export async function transaction<T>(fn:(db:DB)=>Promise<T>):Promise<T> {
 if(memory)return memory.transaction(fn);
 const db=await pool.connect();try{await db.query('begin');const result=await fn(db);await db.query('commit');return result;}catch(e){await db.query('rollback');throw e;}finally{db.release();}
}
