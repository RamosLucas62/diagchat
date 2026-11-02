import {columnSemantic,templateSemantic,semanticLabels,words} from '../shared/import-semantics.js';
import {createHash} from 'node:crypto';
import {parseWorkbook,normalize,type SheetPreview} from './importer.js';
import type {ImportProfile,ImportIssue,ImportBinding} from '../shared/import-profile.js';
import type {Template} from './meta.js';
export const templateSignature=(t:Template)=>createHash('sha256').update(JSON.stringify([t.name,t.language,t.body,t.parameters])).digest('hex');
export type PlannedRecipient={phone:string;variables:string[];sourceRows:{sheet:string;row:number}[]};
export type PlannedSegment={sheet:string;template:string;scheduledAt:string;immediate:boolean;recipients:PlannedRecipient[]};
export type ImportPlan={issues:ImportIssue[];sheets:{name:string;headerRow:number;phoneColumn:string;columns:string[];invalid:number}[];segments:PlannedSegment[];summary:{rows:number;messages:number;duplicates:number;groups:number;sheets:number;segments:{sheet:string;template:string;scheduledAt:string;messages:number}[]}};
export type ImportOverride=Record<string,{headerRow?:number;phoneColumn?:string}>;
const column=(columns:string[],aliases:string[])=>{const matches=columns.filter(c=>aliases.some(a=>normalize(a)===normalize(c)));if(matches.length!==1)throw new Error(matches.length?'Mais de uma coluna corresponde a '+aliases.join(', ')+'.':'Coluna não encontrada: '+(aliases.join(', ')||'sem nomes configurados')+'.');return matches[0];};
export function calendarDate(value:string,year?:number|null):string|null{
 const s=value.trim();let y:number,m:number,d:number;let match=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
 if(match){y=+match[1];m=+match[2];d=+match[3];}else{match=s.match(/^(\d{1,2})[./_-](\d{1,2})(?:[./_-](\d{2}|\d{4}))?$/);if(!match)return null;d=+match[1];m=+match[2];if(!match[3]&&!year)return null;y=match[3]?+match[3]:year!;if(y<100)y+=2000;}
 if(y<2020||y>2100)return null;const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?date.toISOString().slice(0,10):null;
}
function sheetDate(name:string,year:number|null){const tokens=name.match(/\d{4}-\d{2}-\d{2}|\d{1,2}[./_-]\d{1,2}(?:[./_-](?:\d{4}|\d{2}))?/g)||[];const dates=[...new Set(tokens.map(t=>calendarDate(t,year)).filter((x):x is string=>!!x))];return dates.length===1?dates[0]:null;}
const localClock=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function saoPauloInstant(date:string,time:string){
 const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number);const target=Date.UTC(y,m-1,d,h,min);let instant=target;
 for(let i=0;i<3;i++){const parts=Object.fromEntries(localClock.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));const observed=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute);const delta=target-observed;if(!delta)break;instant+=delta;}
 return new Date(instant).toISOString();
}
function transform(value:string,b:ImportBinding){
 const v=value.trim();if(!v)throw new Error(`Valor vazio para ${b.label||'variável '+b.parameter}.`);
 if(b.transform==='first_name')return v.split(/\s+/)[0];
 if(b.transform==='date'){const date=calendarDate(v);if(!date)throw new Error(`Data inválida para ${b.label||b.parameter}.`);return date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4);}
 if(b.transform==='time'){const match=v.match(/(?:^|T|\s)([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?(?:Z)?$/);if(!match)throw new Error(`Horário inválido para ${b.label||b.parameter}.`);return match[1].padStart(2,'0')+':'+match[2];}
 return v;
}
function locationValue(value:string):boolean{
 const s=words(value);
 if(/^(?:dr|dra|doutor|doutora|medico|medica)\b/.test(s))return false;
 return /\b(rua|avenida|av|travessa|alameda|rodovia|estrada|praca|logradouro|endereco|unidade|clinica|hospital|laboratorio|street|avenue)\s+\S+/.test(s);
}
const combinedProcedureHeader=(header:string)=>/^procedimentos?\s+(?:n|no|numero)\s+(?:do\s+)?pedido$/.test(words(header));
const procedureText=(value:string)=>/[a-zA-ZÀ-ÿ]{4}/.test(value)&&!/^\s*(?:pedido|protocolo|codigo)\s*[:#-]?\s*\d+\s*$/i.test(value);
function automaticColumn(sheet:SheetPreview,body:string,b:ImportBinding):{name:string;binding:ImportBinding;locationFromContent:boolean;combinedProcedure:boolean}{
 const semantic=templateSemantic(body,b.parameter,b.label);
 if(!semantic)throw new Error(`Não foi possível interpretar a variável {{${b.parameter}}} pelo texto do template. A equipe precisa definir seu significado.`);
 let candidates=sheet.columns.filter(c=>columnSemantic(c)===semantic);let locationFromContent=false;
 // Provider columns may contain a physical unit/address rather than a person's name.
 // Only fall back when no location-labelled column exists and content provides strong evidence.
 if(!candidates.length&&semantic==='location'){
  candidates=sheet.columns.filter(c=>{if(columnSemantic(c)!=='provider')return false;const values=sheet.rows.slice(0,100).map(r=>r.fields[c]?.trim()).filter(Boolean);return values.length>0&&values.filter(locationValue).length/values.length>=0.9;});
  locationFromContent=candidates.length>0;
 }
 if(!candidates.length)throw new Error(`Coluna de ${semanticLabels[semantic].toLowerCase()} não identificada para {{${b.parameter}}}.`);
 // Validate the column across multiple rows, never choose a different column for each recipient.
 const quality=(c:string)=>{const values=sheet.rows.slice(0,100).map(r=>r.fields[c]?.trim()).filter(Boolean);return values.length?values.filter(v=>semantic==='date'?!!calendarDate(v):semantic==='time'?/(?:^|T|\s)([01]?\d|2[0-3]):[0-5]\d/.test(v):/[a-zA-ZÀ-ÿ]/.test(v)).length/values.length:0;};
 const ranked=candidates.map(name=>({name,quality:quality(name)})).sort((a,b)=>b.quality-a.quality);
 if(ranked.length>1&&ranked[0].quality-ranked[1].quality<0.5)throw new Error(`Mais de uma coluna de ${semanticLabels[semantic].toLowerCase()} corresponde à variável {{${b.parameter}}}. A equipe precisa revisar.`);
 const format=b.transform==='text'?(semantic==='date'?'date':semantic==='time'?'time':'text'):b.transform;
 return {name:ranked[0].name,binding:{...b,label:b.label||semanticLabels[semantic],transform:format},locationFromContent,combinedProcedure:semantic==='procedure'&&combinedProcedureHeader(ranked[0].name)};
}
export async function buildImportPlan(buffer:Buffer,profile:ImportProfile,templates:Template[],options:{chosenTemplate?:string;overrides?:ImportOverride;ignoredRows?:{sheet:string;row:number}[];now?:Date}={}):Promise<ImportPlan>{
 const now=options.now||new Date();const ignored=new Set((options.ignoredRows||[]).map(r=>JSON.stringify([r.sheet,r.row])));
 const hints=[profile.nameAliases,...profile.templates.flatMap(t=>t.bindings.filter(b=>b.source==='column').map(b=>b.aliases)),profile.routingAliases,profile.schedule.aliases].filter(a=>a.length);
 const sheets=await parseWorkbook(buffer,{...profile.layouts,...options.overrides},{phoneAliases:profile.phoneAliases,nameAliases:profile.nameAliases,headerHints:hints,keepDuplicates:true,headerRow:profile.headerRow});
 const issues:ImportIssue[]=[];const records:{sheet:string;row:number;phone:string;identity:string;original:string[];key:string;scheduledAt:string;immediate:boolean;variables:string[];bindings:ImportBinding[];groupValues:string[]}[]=[];
 let rows=0,duplicates=0,groups=0;const schedules=new Map<string,string>();
 const add=(sheet:string,row:number,message:string)=>{if(issues.length<1000)issues.push({sheet,row,message});};
 for(const sheet of sheets){
  const resolvedColumns=new Map<string,ReturnType<typeof automaticColumn>>();
  if(!sheet.headerRow||!sheet.phoneColumn){add(sheet.name,0,sheet.warnings[0]||'Cabeçalho ou telefone não identificado.');continue;}
  for(const rejected of sheet.rejectedRows||[])if(!ignored.has(JSON.stringify([sheet.name,rejected.row])))add(sheet.name,rejected.row,rejected.reason);
  for(const row of sheet.rows){if(ignored.has(JSON.stringify([sheet.name,row.row])))continue;rows++;
   try{
    let key=profile.fixedTemplate;
    if(profile.mode==='form')key=options.chosenTemplate||'';
    if(profile.mode==='column'){const field=column(sheet.columns,profile.routingAliases);const value=normalize(row.fields[field]||'');const rule=profile.routes.find(r=>normalize(r.value)===value);if(!rule)throw new Error('O valor da coluna de roteamento não possui um template configurado.');key=rule.template;}
    const allowed=profile.templates.find(t=>t.key===key);if(!allowed)throw new Error(profile.mode==='form'?'Selecione um template liberado pela equipe.':'Template sem configuração de variáveis no perfil.');
    const template=templates.find(t=>`${t.name}:${t.language}`===key&&t.supported);if(!template)throw new Error('Template não está aprovado ou compatível na Meta.');if(allowed.signature&&allowed.signature!==templateSignature(template))throw new Error('O template mudou na Meta. A equipe precisa conferir e salvar o perfil novamente.');
    let bindings=template.parameters.map(parameter=>{const b=allowed.bindings.find(b=>b.parameter===parameter);if(!b)throw new Error(`Configure a origem da variável {{${parameter}}} no perfil.`);return b;});
    const variables=bindings.map((b,i)=>{if(b.source==='auto'||(b.source==='column'&&!b.aliases.length)){const cacheKey=JSON.stringify([key,b.parameter]);let resolved=resolvedColumns.get(cacheKey);if(!resolved){resolved=automaticColumn(sheet,template.body,b);resolvedColumns.set(cacheKey,resolved);}const value=row.fields[resolved.name]||'';if(resolved.locationFromContent&&!locationValue(value))throw new Error(`O conteúdo de ${resolved.name} não identifica uma unidade ou endereço para {{${b.parameter}}}.`);if(resolved.combinedProcedure&&!procedureText(value))throw new Error(`O conteúdo de ${resolved.name} não identifica o procedimento para {{${b.parameter}}}.`);bindings[i]=resolved.binding;return transform(value,resolved.binding);}return transform(b.source==='fixed'?b.value:row.fields[column(sheet.columns,b.aliases)]||'',b);});
    if(variables.some(v=>v.length>1024))throw new Error('Uma variável ultrapassa 1.024 caracteres.');
    let immediate=profile.schedule.source==='immediate';let scheduledAt=now.toISOString();
    if(!immediate){const date=profile.schedule.source==='sheet'?sheetDate(sheet.name,profile.schedule.year):calendarDate(row.fields[column(sheet.columns,profile.schedule.aliases)]||'',profile.schedule.year);if(!date)throw new Error('Data de agendamento ausente, inválida ou ambígua. Configure o ano quando a aba não o informar.');const source=new Date(date+'T12:00:00Z');source.setUTCDate(source.getUTCDate()-profile.schedule.daysBefore);const day=source.toISOString().slice(0,10);scheduledAt=schedules.get(day)||saoPauloInstant(day,profile.schedule.time);schedules.set(day,scheduledAt);if(Date.parse(scheduledAt)<now.getTime()){if(profile.schedule.past==='now'){scheduledAt=now.toISOString();immediate=true;}else throw new Error('A data calculada para o disparo já passou. A equipe precisa revisar o agendamento.');}}
    const groupValues=profile.duplicates==='group'?profile.groupKeys.map(k=>{const value=row.fields[column(sheet.columns,k.aliases)]?.trim();if(!value)throw new Error('Identificador de compromisso vazio: '+k.label+'.');return value;}):[];
    records.push({sheet:sheet.name,row:row.row,phone:row.phone,identity:normalize(row.name),original:sheet.columns.map(c=>row.fields[c]||''),key,scheduledAt,immediate,variables,bindings,groupValues});
   }catch(e){add(sheet.name,row.row,(e as Error).message);}
  }
 }
 const exact=new Set<string>();const merged=new Map<string,{record:typeof records[number];recipient:PlannedRecipient;values:string[][]}>();
 for(const record of records){const signature=JSON.stringify([record.sheet,record.phone,record.key,record.scheduledAt,record.variables,record.groupValues,record.original]);if(exact.has(signature)){duplicates++;continue;}exact.add(signature);
  const groupKey=profile.duplicates==='group'?JSON.stringify([record.sheet,record.phone,record.key,record.scheduledAt,record.identity,record.groupValues,record.variables.map((v,i)=>record.bindings[i].transform==='join'?null:v)]):signature;
  const current=merged.get(groupKey);
  if(current){groups++;current.recipient.sourceRows.push({sheet:record.sheet,row:record.row});record.bindings.forEach((b,i)=>{if(b.transform==='join'){if(!current.values[i].includes(record.variables[i]))current.values[i].push(record.variables[i]);current.recipient.variables[i]=current.values[i].join(b.separator||', ');}});if(current.recipient.variables.some(v=>v.length>1024))add(record.sheet,record.row,'Procedimentos agrupados ultrapassam 1.024 caracteres.');}
  else merged.set(groupKey,{record,values:record.variables.map(v=>[v]),recipient:{phone:record.phone,variables:[...record.variables],sourceRows:[{sheet:record.sheet,row:record.row}]}});
 }
 const buckets=new Map<string,PlannedSegment[]>();const phones=new Map<PlannedSegment,Set<string>>();
 for(const {record,recipient} of merged.values()){
  const key=JSON.stringify([record.sheet,record.key,record.scheduledAt]);const bucket=buckets.get(key)||[];let segment=bucket.find(s=>s.recipients.length<50000&&!phones.get(s)!.has(recipient.phone));
  if(!segment){segment={sheet:record.sheet,template:record.key,scheduledAt:record.scheduledAt,immediate:record.immediate,recipients:[]};bucket.push(segment);phones.set(segment,new Set());buckets.set(key,bucket);}segment.recipients.push(recipient);phones.get(segment)!.add(recipient.phone);
 }
 const segments=[...buckets.values()].flat();if(segments.length>250)add('',0,'A importação gera mais de 250 lotes. Divida a planilha.');if(!segments.length&&!issues.length)add('',0,'Nenhum contato válido foi encontrado.');
 return {issues,sheets:sheets.map(s=>({name:s.name,headerRow:s.headerRow,phoneColumn:s.phoneColumn,columns:s.columns,invalid:s.invalid})),segments,summary:{rows,messages:segments.reduce((n,s)=>n+s.recipients.length,0),duplicates,groups,sheets:sheets.length,segments:segments.map(s=>({sheet:s.sheet,template:s.template,scheduledAt:s.scheduledAt,messages:s.recipients.length}))}};
}
