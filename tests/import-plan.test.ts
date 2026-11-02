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

test('identifica telefone e variáveis pelo contexto sem associação manual, inclusive em abas e cabeçalhos tardios',async()=>{
 const {automaticTemplate}=await import('../shared/import-semantics.js');
 const t={name:'confirmacao',language:'pt_BR',supported:true,body:'Olá {{1}}!\nData: {{2}}\nProcedimentos: {{3}}\nLocal: {{4}}\nPrestador: {{5}}',parameters:['1','2','3','4','5']};
 const p=defaultImportProfile();p.fixedTemplate='confirmacao:pt_BR';p.templates=[automaticTemplate(t)];
 const bytes=await workbook([{name:'Lista',headerRow:23,headers:['CPF','PRESTADOR','PHONE','PROCEDIMENTO','DATA DO AGENDAMENTO','NOME DO PACIENTE','LOCAL','Data de nascimento'],rows:[['029.029.611-03','Dra. Clara','11999991234','Hemograma',new Date('2026-11-05T00:00:00Z'),'Ana Silva','Unidade A','01/01/1980']]}]);
 const plan=await buildImportPlan(bytes,p,[t],{now});assert.deepEqual(plan.issues,[]);assert.equal(plan.sheets[0].headerRow,23);assert.deepEqual(plan.segments[0].recipients[0].variables,['Ana Silva','05/11/2026','Hemograma','Unidade A','Dra. Clara']);
 const synonyms=await workbook([{name:'Outra aba',headers:['Número de contato','Patient name','Appointment date','Serviço','Endereço','Profissional responsável'],rows:[['11999991234','Ana Silva','2026-11-05','Consulta','Unidade A','Dr. Pedro']]}]);
 const second=await buildImportPlan(synonyms,p,[t],{now});assert.deepEqual(second.issues,[]);assert.equal(second.segments[0].recipients[0].variables[4],'Dr. Pedro');
});
test('conteúdo resolve uma coluna de telefone inválida e mantém revisão se ambos os destinos forem válidos',async()=>{
 const {automaticTemplate}=await import('../shared/import-semantics.js');const t=templates[1],p=defaultImportProfile();p.fixedTemplate='retorno:pt_BR';p.templates=[automaticTemplate(t)];
 const bytes=await workbook([{name:'Lista',headers:['Nome','Telefone','Celular'],rows:[['Ana','não informado','11999991234']]}]);
 const plan=await buildImportPlan(bytes,p,[t],{now});assert.deepEqual(plan.issues,[]);assert.equal(plan.sheets[0].phoneColumn,'Celular');
 const both=await workbook([{name:'Lista',headers:['Nome','Telefone','Celular'],rows:[['Ana','11988881234','11999991234']]}]);assert((await buildImportPlan(both,p,[t],{now})).issues.some(i=>i.message.includes('Mais de uma coluna')));
});
test('não inventa a origem de variáveis sem contexto nem escolhe entre duas datas válidas',async()=>{
 const {automaticTemplate}=await import('../shared/import-semantics.js');let t={...templates[1],body:'Olá {{1}}. {{2}}',parameters:['1','2']};const p=defaultImportProfile();p.fixedTemplate='retorno:pt_BR';p.templates=[automaticTemplate(t)];
 const bytes=await workbook([{name:'Lista',headers:['Nome','Telefone','Data consulta','Data exame'],rows:[['Ana','11999991234','2026-11-05','2026-11-06']]}]);
 const unknown=await buildImportPlan(bytes,p,[t],{now});assert.equal(unknown.summary.messages,0);assert(unknown.issues.some(i=>i.message.includes('interpretar a variável {{2}}')));
 t={...t,body:'Olá {{1}}. Data: {{2}}'};const ambiguous=await buildImportPlan(bytes,p,[t],{now});assert.equal(ambiguous.summary.messages,0);assert(ambiguous.issues.some(i=>i.message.includes('Mais de uma coluna')));
});

test('exportação clínica usa a unidade em PRESTADOR como Local e o cabeçalho composto como Exames',async()=>{
 const {automaticTemplate}=await import('../shared/import-semantics.js');
 const t={name:'confirmacao_exames',language:'pt_BR',supported:true,body:'Olá, {{1}}.\n\nSegue a confirmação do agendamento dos seus exames para o Laboratório Exemplo.\n\n🗓️ Data: {{2}}\n📍 Local: {{3}}\n🔬 Exames: {{4}}\n\nDocumentação necessária: apresente os documentos.',parameters:['1','2','3','4']};
 const p=defaultImportProfile();p.fixedTemplate='confirmacao_exames:pt_BR';p.templates=[automaticTemplate(t)];
 const rows=[['Ana Silva','111.222.333-44','11999991234',new Date('2026-11-03T00:00:00Z'),'LAB - Unidade RUA 9-A - Setor Exemplo','EXAMES DE PATOLOGIA CLÍNICA - LABORATÓRIO'],['Bruno Costa','222.333.444-55','11988881234','03/11/2026','LAB - Unidade RUA 7-A Edifício Exemplo','Hemograma'],['Carla Lima','333.444.555-66','11977771234','03/11/2026','LAB - Unidade Central - Em frente ao estádio','Glicemia']];
 const bytes=await workbook([{name:'Página1',headerRow:1,headers:['NOME','CPF','CONTATO','DATA DO AGENDAMENTO','PRESTADOR','Procedimento N° DO PEDIDO'],rows}]);const plan=await buildImportPlan(bytes,p,[t],{now});assert.deepEqual(plan.issues,[]);assert.equal(plan.summary.messages,3);assert.equal(plan.sheets[0].phoneColumn,'CONTATO');assert.equal(plan.sheets[0].headerRow,1);assert.deepEqual(plan.segments[0].recipients[0].variables,['Ana Silva','03/11/2026',rows[0][4],rows[0][5]]);
});
test('Local não é preenchido com o nome de um médico nem escolhe entre dois prestadores com endereços',async()=>{
 const {automaticTemplate}=await import('../shared/import-semantics.js');const t={name:'local',language:'pt_BR',supported:true,body:'Olá {{1}}.\nLocal: {{2}}',parameters:['1','2']};const p=defaultImportProfile();p.fixedTemplate='local:pt_BR';p.templates=[automaticTemplate(t)];
 const doctor=await workbook([{name:'Lista',headers:['Nome','Telefone','Prestador'],rows:[['Ana','11999991234','Dra. Clara Silva']]}]);const missing=await buildImportPlan(doctor,p,[t],{now});assert.equal(missing.summary.messages,0);assert(missing.issues[0].message.includes('Coluna de local não identificada'));
 const ambiguous=await workbook([{name:'Lista',headers:['Nome','Telefone','Prestador','Prestador responsável'],rows:[['Ana','11999991234','Unidade Rua A','Unidade Rua B']]}]);const both=await buildImportPlan(ambiguous,p,[t],{now});assert.equal(both.summary.messages,0);assert(both.issues[0].message.includes('Mais de uma coluna'));
});
test('Local explícito tem prioridade e pedidos numéricos no cabeçalho composto não viram exames',async()=>{
 const {automaticTemplate}=await import('../shared/import-semantics.js');const t={name:'local',language:'pt_BR',supported:true,body:'Olá {{1}}.\nLocal: {{2}}\nExames: {{3}}',parameters:['1','2','3']};const p=defaultImportProfile();p.fixedTemplate='local:pt_BR';p.templates=[automaticTemplate(t)];
 const bytes=await workbook([{name:'Lista',headers:['Nome','Telefone','Prestador','Local','Procedimento N° DO PEDIDO','N° do pedido'],rows:[['Ana','11999991234','Unidade Rua A','Unidade Rua B','Hemograma','188074']]}]);const plan=await buildImportPlan(bytes,p,[t],{now});assert.deepEqual(plan.issues,[]);assert.equal(plan.segments[0].recipients[0].variables[1],'Unidade Rua B');assert.equal(plan.segments[0].recipients[0].variables[2],'Hemograma');
 const numeric=await workbook([{name:'Lista',headers:['Nome','Telefone','Prestador','Procedimento N° DO PEDIDO'],rows:[['Ana','11999991234','Unidade Rua A','188074']]}]);const invalid=await buildImportPlan(numeric,p,[t],{now});assert.equal(invalid.summary.messages,0);assert(invalid.issues[0].message.includes('não identifica o procedimento'));
});

test('uma coluna majoritariamente de unidades não libera a linha que contém somente um médico',async()=>{
 const {automaticTemplate}=await import('../shared/import-semantics.js');const t={name:'local',language:'pt_BR',supported:true,body:'Olá {{1}}.\nLocal: {{2}}',parameters:['1','2']};const p=defaultImportProfile();p.fixedTemplate='local:pt_BR';p.templates=[automaticTemplate(t)];
 const rows=Array.from({length:10},(_,i)=>['Pessoa '+i,'11999991234',i===9?'Dra. Clara Silva':'LAB - Unidade Rua A']);const bytes=await workbook([{name:'Lista',headers:['Nome','Telefone','Prestador'],rows}]);const plan=await buildImportPlan(bytes,p,[t],{now});assert.equal(plan.issues.length,1);assert.equal(plan.issues[0].row,18);assert(plan.issues[0].message.includes('não identifica uma unidade ou endereço'));
});

test('linhas com mesmo nome e CPF mas sete telefones diferentes geram sete mensagens',async()=>{
 const {automaticTemplate}=await import('../shared/import-semantics.js');const t={name:'exames',language:'pt_BR',supported:true,body:'Olá {{1}}.\nData: {{2}}\nLocal: {{3}}\nExames: {{4}}',parameters:['1','2','3','4']};const p=defaultImportProfile();p.fixedTemplate='exames:pt_BR';p.templates=[automaticTemplate(t)];
 const rows=Array.from({length:7},(_,i)=>[i<3?'Ana Silva':i===3?'Bia Costa':'Carla Lima',i<3?'111.222.333-44':i===3?'222.333.444-55':'333.444.555-66','1199999123'+i,'03/11/2026','LAB - Unidade Rua A','Hemograma']);rows.push([...rows[0]]);
 const bytes=await workbook([{name:'Lista',headers:['NOME','CPF','CONTATO','DATA DO AGENDAMENTO','PRESTADOR','Procedimento N° DO PEDIDO'],rows}]);const plan=await buildImportPlan(bytes,p,[t],{now});assert.deepEqual(plan.issues,[]);assert.equal(plan.summary.rows,8);assert.equal(plan.summary.messages,7);assert.equal(plan.summary.duplicates,1);assert.equal(new Set(plan.segments.flatMap(s=>s.recipients.map(r=>r.phone))).size,7);
});

test('data da aba mais horário Excel preenche uma única variável sem enviar a data-base de 1899',async()=>{
 const {automaticTemplate}=await import('../shared/import-semantics.js');const t={name:'agenda',language:'pt_BR',supported:true,body:'Olá {{1}}.\nData: {{2}}\nExames: {{3}}',parameters:['1','2','3']};const p=defaultImportProfile();p.fixedTemplate='agenda:pt_BR';p.templates=[automaticTemplate(t)];
 const book=new ExcelJS.Workbook();for(const [name,time] of [['05-11',new Date('1899-12-30T09:00:00Z')],['06-11',0.375]] as const){const s=book.addWorksheet(name);s.getRow(2).values=['Nome do paciente','Telefone','HORARIO','Procedimento'];s.getRow(3).values=['Ana Silva','11999991234',time,'Hemograma'];s.getCell('C3').numFmt='hh:mm';}
 const bytes=Buffer.from(await book.xlsx.writeBuffer());const plan=await buildImportPlan(bytes,p,[t],{now});assert.deepEqual(plan.issues,[]);assert.equal(plan.segments[0].recipients[0].variables[1],'05/11/2026 09:00');assert.equal(plan.segments[1].recipients[0].variables[1],'06/11/2026 09:00');assert(!JSON.stringify(plan.segments).includes('1899'));
 const b=p.templates[0].bindings[1];b.source='column';b.aliases=['HORARIO','NOME DA ABA'];b.label='Data do atendimento';b.transform='join';const legacy=await buildImportPlan(bytes,p,[t],{now});assert.deepEqual(legacy.issues,[]);assert.equal(legacy.segments[0].recipients[0].variables[1],'05/11/2026 09:00');
 b.source='sheet_datetime';b.aliases=['HORARIO'];b.sheetYear=2027;const explicit=await buildImportPlan(bytes,p,[t],{now});assert.deepEqual(explicit.issues,[]);assert.equal(explicit.segments[0].recipients[0].variables[1],'05/11/2027 09:00');
});
test('data da aba com horário exige uma data válida e uma única coluna de horário',async()=>{
 const {automaticTemplate}=await import('../shared/import-semantics.js');const t={name:'agenda',language:'pt_BR',supported:true,body:'Olá {{1}}. Data: {{2}}',parameters:['1','2']};const p=defaultImportProfile();p.fixedTemplate='agenda:pt_BR';p.templates=[automaticTemplate(t)];p.templates[0].bindings[1].source='sheet_datetime';
 const bytes=await workbook([{name:'Lista',headers:['Nome','Telefone','Horario'],rows:[['Ana','11999991234','09:00']]}]);assert((await buildImportPlan(bytes,p,[t],{now})).issues.some(i=>i.message.includes('Data da aba')));
 const ambiguous=await workbook([{name:'05-11',headers:['Nome','Telefone','Horario','Hora'],rows:[['Ana','11999991234','09:00','10:00']]}]);assert((await buildImportPlan(ambiguous,p,[t],{now})).issues.some(i=>i.message.includes('Horário da linha ausente ou ambíguo')));
});

test('data e horário de colunas da mesma linha combinam texto, datas Excel e frações sem usar a data da aba',async()=>{
 const {automaticTemplate}=await import('../shared/import-semantics.js');const t={name:'agenda',language:'pt_BR',supported:true,body:'Olá {{1}}. Data: {{2}}',parameters:['1','2']};const p=defaultImportProfile();p.fixedTemplate='agenda:pt_BR';p.templates=[automaticTemplate(t)];const b=p.templates[0].bindings[1];b.source='column_datetime';b.dateAliases=['DATA'];b.timeAliases=['HORARIO'];
 const book=new ExcelJS.Workbook();const s=book.addWorksheet('05-11');s.getRow(2).values=['NOME','FONE','HORARIO','DATA'];s.getRow(3).values=['Ana','11999991234','7:00','12/11/26'];s.getRow(4).values=['Bia','11988881234',7/24,new Date('2026-12-11T00:00:00Z')];s.getCell('C4').numFmt='hh:mm';s.getCell('D4').numFmt='dd/mm/yyyy';s.getRow(5).values=['Caio','11977771234',new Date('1899-12-30T08:30:00Z'),'13/11/2026'];s.getCell('C5').numFmt='hh:mm';const bytes=Buffer.from(await book.xlsx.writeBuffer());
 const plan=await buildImportPlan(bytes,p,[t],{now});assert.deepEqual(plan.issues,[]);assert.deepEqual(plan.segments[0].recipients.map(r=>r.variables[1]),['12/11/2026 07:00','11/12/2026 07:00','13/11/2026 08:30']);
 b.source='auto';b.dateAliases=['Outra coluna'];b.timeAliases=['Outra coluna'];const automatic=await buildImportPlan(bytes,p,[t],{now});assert.deepEqual(automatic.issues,[]);assert.deepEqual(automatic.segments[0].recipients,plan.segments[0].recipients);
 b.transform='date';const dateOnly=await buildImportPlan(bytes,p,[t],{now});assert.deepEqual(dateOnly.issues,[]);assert.equal(dateOnly.segments[0].recipients[0].variables[1],'12/11/2026');
});
test('combinar colunas exige data e horário válidos e únicos, com seleção explícita para resolver ambiguidade',async()=>{
 const {automaticTemplate}=await import('../shared/import-semantics.js');const t={name:'agenda',language:'pt_BR',supported:true,body:'Olá {{1}}. Data: {{2}}',parameters:['1','2']};const p=defaultImportProfile();p.fixedTemplate='agenda:pt_BR';p.templates=[automaticTemplate(t)];const b=p.templates[0].bindings[1];b.source='column_datetime';
 for(const [date,time] of [['31/02/2026','07:00'],['11/12/2026','25:00'],['','07:00'],['11/12/2026','']]){const bytes=await workbook([{name:'05-11',headers:['Nome','Fone','Data','Horario'],rows:[['Ana','11999991234',date,time]]}]);const plan=await buildImportPlan(bytes,p,[t],{now});assert.equal(plan.summary.messages,0);assert.equal(plan.issues.length,1);}
 for(const extra of ['Data consulta','Hora']){const bytes=await workbook([{name:'Lista',headers:['Nome','Fone','Data','Horario',extra],rows:[['Ana','11999991234','11/12/26','07:00',extra==='Hora'?'08:00':'12/12/26']]}]);const plan=await buildImportPlan(bytes,p,[t],{now});assert.equal(plan.summary.messages,0);assert(plan.issues[0].message.includes('ambígua'));b.dateAliases=['Data'];b.timeAliases=['Horario'];const resolved=await buildImportPlan(bytes,p,[t],{now});assert.deepEqual(resolved.issues,[]);assert.equal(resolved.segments[0].recipients[0].variables[1],'11/12/2026 07:00');b.dateAliases=[];b.timeAliases=[];}
 const missing=await workbook([{name:'05-11',headers:['Nome','Fone','Horario'],rows:[['Ana','11999991234','07:00']]}]);assert((await buildImportPlan(missing,p,[t],{now})).issues[0].message.includes('Coluna de data'));
});
