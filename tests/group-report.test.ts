import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupReport,type GroupReport} from '../server/group-report.js';
const example:GroupReport={clientName:'Saúde e Vida',campaignName:'Saúde e Vida | 31.10.26 | 01',completedAt:'2026-10-31T14:08:00Z',period:'2026-10-01',total:59,sent:59,failed:0,cancelled:0,accepted:2154,reserved:174,monthlyLimit:2500,overageMode:'block'};
test('relatório segue referência, desconta reservas e usa fuso de São Paulo',()=>{
 const text=groupReport(example);
 for(const part of ['31/10/2026 11:08','Total de contatos: 59','aceitos pela API: 59','Falhas confirmadas: 0','Franquia mensal — 10/2026','Limite: 2.500 disparos','Utilizados: 2.154 disparos','Reservados ou aguardando confirmação: 174','Disponíveis: 172 disparos','Renovação da franquia: 01/11/2026','restam somente 172'])assert(text.includes(part),part);
 assert(!text.includes('Cancelados:'));assert(!text.includes('Bloqueados'));assert(!text.includes('leituras'));assert(text.includes('aguardando a renovação'));
});
test('aviso de limite respeita cobrança de excedentes e não apresenta saldo negativo',()=>{
 const text=groupReport({...example,overageMode:'charge',accepted:2600,reserved:12,cancelled:2});
 assert(text.includes('Disponíveis: 0 disparos'));assert(text.includes('Excedentes: 100 disparos'));assert(text.includes('Cancelados: 2'));assert(text.includes('cobrança adicional'));assert(!text.includes('aguardando a renovação'));assert(!text.includes('restam somente'));
 assert(!groupReport({...example,accepted:100,reserved:0}).includes('ATENÇÃO'));
});
test('renovação atravessa ano e horário de conclusão pode cair no dia anterior',()=>{
 const text=groupReport({...example,period:'2026-12-01',completedAt:'2027-01-01T01:30:00Z'});
 assert(text.includes('Data e hora: 31/12/2026 22:30'));assert(text.includes('Renovação da franquia: 01/01/2027'));
});
