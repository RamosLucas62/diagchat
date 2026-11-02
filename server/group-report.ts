export type GroupReport={clientName:string;campaignName:string;completedAt:string|Date;period:string;total:number;sent:number;failed:number;cancelled:number;accepted:number;reserved:number;monthlyLimit:number;overageMode:'block'|'charge'};
const count=(n:number)=>new Intl.NumberFormat('pt-BR').format(n);
const line=(s:string)=>s.replace(/\s+/g,' ').trim();
export function groupReport(s:GroupReport){
 const available=Math.max(0,s.monthlyLimit-s.accepted-s.reserved);
 const overage=Math.max(0,s.accepted-s.monthlyLimit);
 const year=Number(s.period.slice(0,4)),month=Number(s.period.slice(5,7));
 const renewal=new Date(Date.UTC(year,month,1)).toLocaleDateString('pt-BR',{timeZone:'UTC'});
 const timestamp=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(s.completedAt)).replace(',','');
 const lines=['📊 *Relatório de Disparo*','',`📅 Data e hora: ${timestamp}`,`Cliente: ${line(s.clientName)}`,`Campanha: ${line(s.campaignName)}`,'','O processamento desta lista terminou.','',`Total de contatos: ${count(s.total)}`,`✅ Enviados — aceitos pela API: ${count(s.sent)}`,`❌ Falhas confirmadas: ${count(s.failed)}`];
 if(s.cancelled>0)lines.push(`Cancelados: ${count(s.cancelled)}`);
 lines.push('',`📦 Franquia mensal — ${String(month).padStart(2,'0')}/${year}`,`Limite: ${count(s.monthlyLimit)} disparos`,`Utilizados: ${count(s.accepted)} disparos`,`Reservados ou aguardando confirmação: ${count(s.reserved)}`,`Disponíveis: ${count(available)} disparos`);
 if(overage>0)lines.push(`Excedentes: ${count(overage)} disparos`);
 lines.push(`🔄 Renovação da franquia: ${renewal}`);
 if(available<=s.monthlyLimit*0.1){
  lines.push('',available>0?`⚠️ ATENÇÃO: restam somente ${count(available)} disparos disponíveis neste mês.`:'⚠️ ATENÇÃO: a franquia disponível deste mês está esgotada.');
  lines.push(s.overageMode==='block'?'Quando o saldo disponível acabar, novos envios ficarão aguardando a renovação da franquia.':'Os envios continuam após o limite, com cobrança adicional conforme o plano contratado.');
 }
 return lines.join('\n');
}
