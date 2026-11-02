import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DEMO_MODE='true';
const {query}=await import('../server/db.js');
const {maintenance}=await import('../server/jobs.js');
async function balance(rate:number,basis:string,until:string,principal=1000){const [row]=await query('select * from app.invoice_balance($1,$2,$3,$4,$5)',[principal,'2026-11-10',rate,basis,until]);return {days:row.overdue_days,interest:Number(row.interest_amount),total:Number(row.amount_due)};}
test('juros simples diários ou mensais proporcionais começam após o vencimento no fuso de São Paulo',async()=>{
 assert.deepEqual(await balance(0.1,'daily','2026-11-11T02:59:59Z'),{days:0,interest:0,total:1000});
 assert.deepEqual(await balance(0.1,'daily','2026-11-11T03:00:00Z'),{days:1,interest:1,total:1001});
 assert.deepEqual(await balance(3,'monthly','2026-11-20T12:00:00Z'),{days:10,interest:10,total:1010});
 assert.deepEqual(await balance(0.1,'daily','2026-11-20T12:00:00Z'),{days:10,interest:10,total:1010});
 assert.deepEqual(await balance(0,'daily','2026-12-20T12:00:00Z'),{days:40,interest:0,total:1000});
 assert.deepEqual(await balance(3,'monthly','2026-11-09T12:00:00Z'),{days:0,interest:0,total:1000});
 assert.equal((await balance(1,'monthly','2026-11-11T12:00:00Z',123.45)).interest,0.04);
});
test('pós-pago vence no mês seguinte e preserva a taxa por fatura; fatura paga não continua acumulando',async()=>{
 const [client]=await query(`insert into app.clients(name,email,waba_id,phone_id,token_enc,secret_enc,verify_token,throughput,plan_name,monthly_limit,monthly_fee,overage_mode,overage_rate,portal_hash,due_day,late_interest_rate,late_interest_basis) values('Juros','a@example.com','9981','9982','x','x','x',80,'Plano',100,1000,'charge',1,'interest-test',10,3,'monthly') returning id`);
 await query(`insert into app.usage(client_id,period,monthly_limit,monthly_fee,overage_rate,accepted,reserved) values($1,app.current_period()-interval '1 month',100,1000,1,110,0)`,[client.id]);
 await maintenance();let [invoice]=await query(`select *,due_date=(period+interval '1 month')::date+9 as postpaid from app.invoices where client_id=$1`,[client.id]);assert.equal(invoice.postpaid,true);assert.equal(Number(invoice.total),1010);assert.equal(Number(invoice.late_interest_rate),3);assert.equal(invoice.late_interest_basis,'monthly');
 await query("update app.clients set late_interest_rate=10,late_interest_basis='daily' where id=$1",[client.id]);await maintenance();[invoice]=await query('select * from app.invoices where client_id=$1',[client.id]);assert.equal(Number(invoice.late_interest_rate),3);
 await query("update app.invoices set due_date='2026-11-10',status='paid',paid_at='2026-11-20T12:00:00Z',paid_total=1020.10 where id=$1",[invoice.id]);
 const [paid]=await query('select b.* from app.invoices i cross join lateral app.invoice_balance(i.total,i.due_date,i.late_interest_rate,i.late_interest_basis,coalesce(i.paid_at,now())) b where id=$1',[invoice.id]);assert.equal(paid.overdue_days,10);assert.equal(Number(paid.interest_amount),10.10);
});
