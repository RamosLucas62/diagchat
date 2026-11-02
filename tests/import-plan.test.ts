import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {buildImportPlan,calendarDate,templateSignature} from '../server/import-plan.js';
import {defaultImportProfile,type ImportProfile} from '../shared/import-profile.js';
const templates=[{name:'consulta',language:'pt_BR',supported:true,body:'Olá {{1}}. Data {{2}}, procedimentos {{3}}. {{4}}',parameters:['1','2','3','4']},{name:'retorno',language:'pt_BR',supported:true,body:'Olá {{1}}',parameters:['1']}];
const now=new Date('2026-10-01T12:00:00Z');
function profile(){const p=defaultImportProfile();p.fixedTemplate='consulta:pt_BR';p.templates=[{key:p.fixedTemplate,bindings:[{parameter:'1',label:'Paciente',source:'column',aliases:['NOME DO PACIENTE','Nome'],value:'',transform:'first_name',separator:', '},{parameter:'2',label:'Data',source:'column',aliases:['Data do atendimento'],value:'',transform:'date',separator:', '},{parameter:'3',label:'Exames',source:'column',aliases:['Procedimento'],value:'',transform:'join',separator:', '},{parameter:'4',label:'Orientações',source:'fixed',aliases:[],value:'Levar documento.',transform:'text',separator:', '}]}];return p;}
async function workbook(sheets:{name:string;headers:string[];rows:any[][];headerRow?:number}[]){const book=new ExcelJS.Workbook();for(const item of sheets){const s=book.addWorksheet(item.name);s.getCell('A1').value='Relatório institucional — data 30/09/2026';s.getRow(item.headerRow||8).values=item.headers;item.rows.forEach((row,i)=>{s.getRow((item.headerRow||8)+i+1).values=row;});}return Buffer.from(await book.xlsx.writeBuffer());}
const headers=['NOME DO PACIENTE','TELEFONE','Data do atendimento','Procedimento','Local','Tipo'];
const ana=['Ana Silva','11999991234','2026-11-05','Hemograma','Unidade A','Consulta'];
test('cabeçalho fora da primeira linha, datas tipadas e colunas reordenadas preenchem as variáveis',async()=>{
 const bytes=await workbook([{name:'05.11.2026',headers:['Procedimento','Data do atendimento','TELEFONE','NOME DO PACIENTE','Local'],rows:[['Hemograma',new Date('2026-11-05T00:00:00Z'),'11999991234','Ana Silva','Unidade A']]}]);const plan=await buildImportPlan(bytes,profile(),templates,{now});assert.deepEqual(plan.issues,[]);assert.equal(plan.sheets[0].headerRow,8);assert.deepEqual(plan.segments[0].recipients[0].variables,['Ana','05/11/2026','Hemograma','Levar documento.']);assert.equal(plan.segments[0].recipients[0].sourceRows[0].row,9);
});
test('agrupa exames sem perder compromissos diferentes e remove apenas duplicatas exatas',async()=>{
 const p=profile();p.duplicates='group';p.groupKeys=[{label:'Data',aliases:['Data do atendimento']},{label:'Local',aliases:['Local']}];const bytes=await workbook([{name:'Lista',headers,rows:[ana,[...ana.slice(0,3),'Glicose',...ana.slice(4)],ana,['Ana Silva','11999991234','2026-11-06','Raio X','Unidade B','Consulta']]}]);const plan=await buildImportPlan(bytes,p,templates,{now});assert.deepEqual(plan.issues,[]);assert.equal(plan.summary.messages,2);assert.equal(plan.summary.duplicates,1);assert.equal(plan.summary.groups,1);assert.equal(plan.segments.length,2);assert.equal(plan.segments[0].recipients[0].variables[2],'Hemograma, Glicose');assert.equal(plan.segments[0].recipients[0].sourceRows.length,2);
 const exact=await buildImportPlan(bytes,profile(),templates,{now});assert.equal(exact.summary.messages,3);
});
test('roteamento por coluna seleciona o template de cada linha e desconhecidos viram pendência',async()=>{
 const p=profile();p.mode='column';p.routingAliases=['Tipo'];p.routes=[{value:'Consulta',template:'consulta:pt_BR'},{value:'Retorno',template:'retorno:pt_BR'}];p.templates.push({key:'retorno:pt_BR',bindings:[p.templates[0].bindings[0]]});const bytes=await workbook([{name:'Lista',headers,rows:[ana,['Bia','11988881234','2026-11-05','Exame','Unidade A','Retorno'],['Caio','11977771234','2026-11-05','Exame','Unidade A','Outro']]}]);const plan=await buildImportPlan(bytes,p,templates,{now});assert.equal(plan.summary.messages,2);assert.equal(plan.segments.length,2);assert.equal(plan.issues.length,1);assert.equal(plan.issues[0].row,11);assert(plan.issues[0].message.includes('não possui um template'));
});
test('abas recebem datas independentes, antecedência e horário de São Paulo',async()=>{
 const p=profile();p.schedule={source:'sheet',aliases:[],year:null,time:'14:00',daysBefore:1,past:'review'};const bytes=await workbook([{name:'05.11.2026',headers,rows:[ana]},{name:'2026-11-06',headers,rows:[ana]}]);const plan=await buildImportPlan(bytes,p,templates,{now});assert.deepEqual(plan.issues,[]);assert.equal(plan.segments[0].scheduledAt,'2026-11-04T17:00:00.000Z');assert.equal(plan.segments[1].scheduledAt,'2026-11-05T17:00:00.000Z');assert.equal(plan.segments[1].recipients[0].variables[1],'05/11/2026');
});
test('datas incompletas, datas passadas e colunas ambíguas ficam para revisão',async()=>{
 const p=profile();p.schedule.source='sheet';const short=await workbook([{name:'05.11',headers,rows:[ana]}]);assert((await buildImportPlan(short,p,templates,{now})).issues.length>0);p.schedule.year=2026;assert.equal((await buildImportPlan(short,p,templates,{now})).issues.length,0);
 const past=await workbook([{name:'01.09.2026',headers,rows:[ana]}]);assert((await buildImportPlan(past,p,templates,{now})).issues.some(i=>i.message.includes('já passou')));p.schedule.past='now';assert.equal((await buildImportPlan(past,p,templates,{now})).segments[0].immediate,true);
 const ambiguous=await workbook([{name:'Lista',headers:[...headers,'Celular'],rows:[[...ana,'11988881234']]}]);assert((await buildImportPlan(ambiguous,profile(),templates,{now})).issues[0].message.includes('Mais de uma'));const fixed=await buildImportPlan(ambiguous,profile(),templates,{now,overrides:{Lista:{headerRow:8,phoneColumn:'TELEFONE'}}});assert.equal(fixed.issues.length,0);
 assert.equal(calendarDate('31/02/2026'),null);
});
test('formulário só aceita templates configurados; variáveis vazias e fórmulas não passam',async()=>{
 const p=profile();p.mode='form';const bytes=await workbook([{name:'Lista',headers,rows:[ana]}]);assert((await buildImportPlan(bytes,p,templates,{now,chosenTemplate:'retorno:pt_BR'})).issues.length>0);assert.equal((await buildImportPlan(bytes,p,templates,{now,chosenTemplate:'consulta:pt_BR'})).issues.length,0);
 const invalid=await workbook([{name:'Lista',headers,rows:[['Ana',{formula:'1+1',result:5511999991234},'2026-11-05','Exame','A','Consulta'],['Bia','11988881234','','','A','Consulta']]}]);assert.equal((await buildImportPlan(invalid,profile(),templates,{now})).summary.messages,0);
});
test('revisão pode excluir linha específica sem liberar valores desconhecidos nas demais',async()=>{
 const bytes=await workbook([{name:'Lista',headers,rows:[ana,['Bia','123','2026-11-05','Exame','A','Consulta']]}]);const first=await buildImportPlan(bytes,profile(),templates,{now});assert.equal(first.issues.length,1);const second=await buildImportPlan(bytes,profile(),templates,{now,ignoredRows:[{sheet:'Lista',row:10}]});assert.equal(second.issues.length,0);assert.equal(second.summary.messages,1);
});

test('o mesmo telefone não junta pessoas de nome completo diferente nem perde datas fora do template',async()=>{
 const p=profile();p.duplicates='group';p.groupKeys=[{label:'Data',aliases:['Data do atendimento']},{label:'Local',aliases:['Local']}];const bytes=await workbook([{name:'Lista',headers,rows:[ana,['Ana Costa','11999991234','2026-11-05','Glicose','Unidade A','Consulta']]}]);const plan=await buildImportPlan(bytes,p,templates,{now});assert.equal(plan.summary.messages,2);assert.equal(plan.summary.groups,0);
});

test('alterar o texto do template aprovado exige reconfirmar o perfil',async()=>{
 const p=profile();p.templates[0].signature=templateSignature(templates[0]);const bytes=await workbook([{name:'Lista',headers,rows:[ana]}]);const changed=templates.map(t=>({...t,body:t.body+' Nova orientação.'}));const plan=await buildImportPlan(bytes,p,changed,{now});assert.equal(plan.summary.messages,0);assert(plan.issues[0].message.includes('template mudou'));
});
