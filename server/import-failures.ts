import type {DB} from './db.js';
import {query} from './db.js';
import type {ImportFailure} from '../shared/import-profile.js';
export async function saveImportFailures(db:DB,campaignId:string,clientId:string,groupId:string,failures:ImportFailure[]){
 if(!failures.length)return;
 await db.query(`insert into app.import_failures(campaign_id,client_id,report_group_id,sheet_name,row_number,code,message)
  select $1,$2,$3,r.sheet,r."row",r.code,r.message from jsonb_to_recordset($4::jsonb) as r(sheet text,"row" integer,code text,message text)
  on conflict(report_group_id,sheet_name,row_number) do nothing`,[campaignId,clientId,groupId,JSON.stringify(failures)]);
}
export async function campaignImportFailures(id:string,clientId:string|undefined,offset:number){
 const [target]=await query(`select client_id,coalesce(report_group_id,import_batch_id,id) as group_id from app.campaigns where (id=$1 or coalesce(report_group_id,import_batch_id,id)=$1) and ($2::uuid is null or client_id=$2) limit 1`,[id,clientId||null]);
 if(!target)return null;
 const [count]=await query('select count(*)::int as total from app.import_failures where report_group_id=$1 and client_id=$2',[target.group_id,target.client_id]);
 const items=await query('select id,sheet_name,row_number,code,message,created_at from app.import_failures where report_group_id=$1 and client_id=$2 order by sheet_name,row_number,id limit 100 offset $3',[target.group_id,target.client_id,offset]);
 return {items,total:count.total,offset,limit:100};
}
