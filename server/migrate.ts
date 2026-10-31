import 'dotenv/config';
import {pool} from './db.js';
import {applyMigrations} from './migrations.js';
const db=await pool.connect();
try{await db.query('begin');await applyMigrations(db);await db.query('commit');console.log('Banco atualizado.');}
catch(e){await db.query('rollback');throw e;}
finally{db.release();await pool.end();}
