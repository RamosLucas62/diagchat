export const billingVariables = [
 ['cliente_nome','Nome do cliente'],['cliente_email','E-mail financeiro'],['plano','Nome do plano'],
 ['competencia','Mês da cobrança'],['mensalidade','Valor da mensalidade'],['disparos_enviados','Mensagens aceitas'],
 ['limite_mensal','Franquia do plano'],['disparos_excedentes','Mensagens adicionais'],['valor_excedente','Total de adicionais'],
 ['juros','Juros por atraso'],['dias_atraso','Dias de atraso'],['taxa_juros','Taxa de juros contratada'],['valor_original','Total sem juros'],['total','Total atualizado da cobrança'],['vencimento','Data do vencimento'],['instrucoes_pagamento','Como pagar'],['referencia','Identificador da cobrança'],
] as const;
export type BillingVariables=Record<typeof billingVariables[number][0],string>;
export const defaultBillingSubject='Sua cobrança DiagChat — {{competencia}}';
export const defaultBillingBody='Olá, {{cliente_nome}}!\n\nConfira sua cobrança de {{competencia}}:\n\nPlano: {{plano}}\nMensalidade: {{mensalidade}}\nMensagens enviadas: {{disparos_enviados}} de {{limite_mensal}}\nAdicionais: {{disparos_excedentes}} · {{valor_excedente}}\n\nValor original: {{valor_original}}\nJuros por atraso: {{juros}} · {{dias_atraso}} dias\nTaxa contratada: {{taxa_juros}}\nTotal: {{total}}\nVencimento: {{vencimento}}\n\n{{instrucoes_pagamento}}\n\nSe precisar, fale com nossa equipe.\nReferência: {{referencia}}';
export const defaultPaymentInstructions='Entre em contato com nosso financeiro para os dados de pagamento.';
export function validateBillingTemplate(value:string){
 const allowed=new Set<string>(billingVariables.map(v=>v[0]));
 const tokens=Array.from(value.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g));
 for(const token of tokens){if(!allowed.has(token[1].trim()))throw new Error(`Variável desconhecida: {{${token[1].trim()}}}. Use as opções disponíveis.`);}
 if(/\{\{|\}\}/.test(value.replace(/\{\{\s*([^{}]*?)\s*\}\}/g,'')))throw new Error('Variável incompleta. Use o formato {{cliente_nome}}.');
}
export function renderBillingTemplate(template:string,variables:BillingVariables){
 validateBillingTemplate(template);
 // A single interpolation pass: client values cannot become executable templates or HTML.
 return template.replace(/\{\{\s*([^{}]*?)\s*\}\}/g,(_,key)=>variables[key.trim() as keyof BillingVariables]);
}
const currency=(value:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value||0));
const count=(value:unknown)=>new Intl.NumberFormat('pt-BR').format(Number(value||0));
export function billingValues(client:any,invoice:any,instructions:string):BillingVariables{
 const date=(value:any)=>new Date(value).toLocaleDateString('pt-BR',{timeZone:'UTC'});
 return {cliente_nome:client.name,cliente_email:client.email,plano:invoice.plan_name||client.plan_name,
 competencia:new Date(invoice.period).toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}),
 mensalidade:currency(invoice.base_amount),disparos_enviados:count(invoice.accepted),limite_mensal:count(invoice.monthly_limit),
 disparos_excedentes:count(invoice.overage_count),valor_excedente:currency(invoice.overage_amount),total:currency(invoice.amount_due??invoice.total),valor_original:currency(invoice.total),juros:currency(invoice.interest_amount),dias_atraso:count(invoice.overdue_days),taxa_juros:`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:4}).format(Number(invoice.late_interest_rate||0))}% ${invoice.late_interest_basis==='daily'?'ao dia':'ao mês (proporcional a 30 dias)'}`,
 vencimento:date(invoice.due_date),instrucoes_pagamento:instructions,referencia:invoice.id||'Prévia da cobrança'};
}
export type BillingProfile={client_id:string;auto_send:boolean;subject_template:string;body_template:string;payment_instructions:string;version:number;updated_at?:string};
