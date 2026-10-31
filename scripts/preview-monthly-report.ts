import {mkdir,writeFile} from 'node:fs/promises';
import {generateMonthlyPDF} from '../server/reports.js';
await mkdir('output/pdf',{recursive:true});
const pdf=await generateMonthlyPDF({invoiceId:'00000000-0000-4000-8000-000000000001',clientId:'demo',clientName:'Cliente Demonstração',period:'2026-09-01',planName:'Essencial',accepted:12420,monthlyLimit:10000,overageCount:2420,overageRate:'0.08',baseAmount:'490.00',overageAmount:'193.60',total:'683.60',dueDate:'2026-10-10',delivered:11900,read:8400,failed:120,daily:Array.from({length:30},(_,i)=>({day:i+1,sent:414})),generatedAt:'2026-10-01T12:00:00Z'});
await writeFile('output/pdf/exemplo-relatorio-mensal.pdf',pdf);console.log('Exemplo gerado em output/pdf/exemplo-relatorio-mensal.pdf');
