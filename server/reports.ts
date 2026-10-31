import PDFDocument from 'pdfkit';
import {Resvg} from '@resvg/resvg-js';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import type {DB} from './db.js';
export type ReportSnapshot={invoiceId:string;clientId:string;clientName:string;period:string;planName:string;accepted:number;monthlyLimit:number;overageCount:number;overageRate:string;baseAmount:string;overageAmount:string;total:string;dueDate:string;delivered:number;read:number;failed:number;daily:{day:number;sent:number}[];generatedAt:string};
const fontPath=resolve('assets/fonts/Manrope.ttf');
const money=(n:string|number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n));
const count=(n:number)=>new Intl.NumberFormat('pt-BR').format(n);
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const month=(s:string)=>new Date(s).toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});
export function renderMetricsImage(s:ReportSnapshot){
 const lastDay=new Date(Date.UTC(Number(s.period.slice(0,4)),Number(s.period.slice(5,7)),0)).getUTCDate();
 const values=Array.from({length:lastDay},(_,i)=>s.daily.find(d=>d.day===i+1)?.sent||0);const max=Math.max(1,...values);const recorded=values.reduce((a,b)=>a+b,0);
 const barWidth=904/lastDay;
 const bars=values.map((n,i)=>`<rect x="${48+i*barWidth+3}" y="${394-(n/max)*156}" width="${Math.max(2,barWidth-7)}" height="${n?(n/max)*156:1}" rx="3" fill="${n?'#a3df78':'#35454b'}"/>`).join('');
 const labels=values.map((_,i)=>i%5===0||i===lastDay-1?`<text x="${48+i*barWidth+barWidth/2}" y="420" text-anchor="middle" fill="#92a8b4" font-size="12">${String(i+1).padStart(2,'0')}</text>`:'').join('');
 const cards=[['MENSAGENS ENVIADAS',count(s.accepted)],['FRANQUIA DO PLANO',count(s.monthlyLimit)],['MENSAGENS ADICIONAIS',count(s.overageCount)]].map(([label,value],i)=>`<rect x="${36+i*316}" y="78" width="296" height="112" rx="14" fill="#1a2930" stroke="#2c3d45"/><text x="${56+i*316}" y="108" font-size="12" fill="#a2b5c1">${label}</text><text x="${56+i*316}" y="157" font-size="36" font-weight="600" fill="${i===0?'#a3df78':'#e7f0f2'}">${value}</text>`).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="510" viewBox="0 0 1000 510"><rect width="1000" height="510" rx="22" fill="#111b20"/><g font-family="Manrope"><text x="38" y="44" font-size="20" font-weight="600" fill="#e7f0f2">Métricas da competência</text><text x="962" y="43" font-size="13" text-anchor="end" fill="#a2b5c1">${escape(month(s.period))}</text>${cards}<text x="40" y="226" font-size="12" fill="#a2b5c1">ACEITES POR DIA</text><line x1="48" y1="394" x2="952" y2="394" stroke="#35454b"/>${bars}${labels}<text x="40" y="461" font-size="12" fill="#a2b5c1">Entregues: ${count(s.delivered)}     Lidas: ${count(s.read)}     Falhas: ${count(s.failed)}</text><text x="40" y="491" font-size="11" fill="#8299a6">${recorded===s.accepted?'Imagem gerada com os dados do fechamento mensal.':`Detalhamento diário disponível: ${count(recorded)} aceites. Consumo faturado: ${count(s.accepted)}.`}</text></g></svg>`;
 return new Resvg(svg,{font:{fontFiles:[fontPath],loadSystemFonts:false,defaultFontFamily:'Manrope'}}).render().asPng();
}
export async function generateMonthlyPDF(s:ReportSnapshot):Promise<Buffer>{
 const image=renderMetricsImage(s);const doc=new PDFDocument({size:'A4',margin:42,autoFirstPage:true,compress:true,info:{Title:`Relatório mensal - ${s.clientName} - ${month(s.period)}`,Author:'DiagChat',CreationDate:new Date(s.generatedAt),ModDate:new Date(s.generatedAt)}});
 const chunks:Buffer[]=[];const completed=new Promise<Buffer>((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.registerFont('Manrope',fontPath);doc.font('Manrope');
 const text=(value:string,x:number,y:number,size=10,color='#243c34',options:PDFKit.Mixins.TextOptions={})=>{doc.fontSize(size).fillColor(color).text(value,x,y,options);};
 doc.roundedRect(42,34,29,29,8).fill('#a3df78');text('D',51,39,15,'#193125');text('diagchat.',80,34,23,'#193125');text('RELATÓRIO MENSAL',375,43,9,'#637a70',{width:178,align:'right'});
 text(s.clientName,42,89,21,'#193125',{width:511,height:33,ellipsis:true});text(`${month(s.period)}  |  Plano ${s.planName}`,42,124,10,'#637a70',{width:511,height:18,ellipsis:true});
 doc.image(image,42,155,{width:511});
 text('Mensagens aceitas pela Meta. Entregas e leituras registradas até a geração do relatório.',42,427,8,'#73877f',{width:511});
 text(`Consumo: ${count(s.accepted)} mensagens | Excedentes: ${count(s.overageCount)}`,42,444,9,'#566e63');
 text('Composição da cobrança',42,469,17,'#193125');
 doc.roundedRect(42,503,511,130,10).fill('#f3f6f4');
 const row=(label:string,value:string,y:number)=>{text(label,58,y,10,'#566e63',{width:340,height:17,ellipsis:true});text(value,402,y,12,'#243c34',{width:135,align:'right'});};
 row(`Mensalidade do plano ${s.planName}`,money(s.baseAmount),520);
 text(`Franquia de ${count(s.monthlyLimit)} mensagens`,58,540,8,'#73877f');
 doc.moveTo(58,560).lineTo(537,560).strokeColor('#dfe7e2').stroke();
 row('Mensagens excedentes',money(s.overageAmount),576);
 const tariff=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:4}).format(Number(s.overageRate));
 text(`${count(s.overageCount)} adicionais x ${tariff} por mensagem`,58,598,8,'#73877f');
 doc.roundedRect(42,647,511,61,10).fill('#e9f5e2');text('TOTAL DA COBRANÇA',58,669,9,'#3f6235');text(money(s.total),344,659,23,'#264b20',{width:192,align:'right'});
 text(`Vencimento: ${new Date(s.dueDate).toLocaleDateString('pt-BR',{timeZone:'UTC'})}`,42,726,10,'#566e63');
 text('Resumo de consumo e cobrança. Não substitui nota fiscal ou boleto.',42,754,8,'#73877f');
 text(`Referência: ${s.invoiceId}`,42,787,7,'#73877f',{width:430});text('1 / 1',509,787,7,'#73877f',{width:44,align:'right'});
 doc.end();return completed;
}
export async function ensureInvoiceReport(db:DB,invoiceId:string){
 const [invoice]=(await db.query('select * from app.invoices where id=$1 for update',[invoiceId])).rows;if(!invoice)throw new Error('Cobrança não encontrada.');
 const [cached]=(await db.query('select * from app.invoice_reports where invoice_id=$1',[invoiceId])).rows;if(cached)return cached;
 const [client]=(await db.query('select name,plan_name from app.clients where id=$1',[invoice.client_id])).rows;
 const [usage]=(await db.query('select * from app.usage where client_id=$1 and period=$2',[invoice.client_id,invoice.period])).rows;
 if(!usage)throw new Error('A competência não possui um registro de consumo para gerar o relatório.');
 const [delivery]=(await db.query(`select count(*) filter(where delivery in ('delivered','read'))::int as delivered,count(*) filter(where delivery='read')::int as read,count(*) filter(where state='failed' or delivery='failed')::int as failed from app.messages where client_id=$1 and period=$2`,[invoice.client_id,invoice.period])).rows;
 const daily=(await db.query(`select extract(day from greatest($2::date,least(($2::date+interval '1 month'-interval '1 day')::date,(accepted_at at time zone 'America/Sao_Paulo')::date)))::int as day,count(*)::int as sent from app.messages where client_id=$1 and period=$2 and state='accepted' group by day order by day`,[invoice.client_id,invoice.period])).rows;
 const period=new Date(invoice.period).toISOString().slice(0,10);
 const snapshot:ReportSnapshot={invoiceId:invoice.id,clientId:invoice.client_id,clientName:client.name,period,planName:invoice.plan_name||usage.plan_name||client.plan_name,accepted:usage.accepted,monthlyLimit:usage.monthly_limit,overageCount:invoice.overage_count,overageRate:String(usage.overage_rate),baseAmount:String(invoice.base_amount),overageAmount:String(invoice.overage_amount),total:String(invoice.total),dueDate:new Date(invoice.due_date).toISOString(),...delivery,daily,generatedAt:new Date().toISOString()};
 const pdf=await generateMonthlyPDF(snapshot);if(pdf.length>2000000)throw new Error('O relatório ultrapassou o limite permitido.');
 const [saved]=(await db.query('insert into app.invoice_reports(invoice_id,snapshot,pdf_base64,sha256) values($1,$2,$3,$4) returning *',[invoice.id,JSON.stringify(snapshot),pdf.toString('base64'),createHash('sha256').update(pdf).digest('hex')])).rows;return saved;
}
export function reportAttachment(report:any){const period=String(report.snapshot.period).slice(0,7);return {filename:`relatorio-mensal-${period}.pdf`,content:report.pdf_base64,content_type:'application/pdf'};}
