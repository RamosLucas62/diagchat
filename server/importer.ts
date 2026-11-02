import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
export type ImportRow = {sheet:string;row:number;phone:string;name:string;fields:Record<string,string>};
export type SheetPreview = {name:string;headerRow:number;phoneColumn:string;columns:string[];rows:ImportRow[];invalid:number;duplicates:number;warnings:string[];sample:string[][];rejectedRows?:{row:number;reason:string}[]};
export const normalize = (s:string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
export function normalizePhone(value:string):string|null {
 if (!value || /[a-z]/i.test(value)) return null;
 let cleaned=value.trim().replace(/[^\d+]/g,'');
 if (cleaned.startsWith('00')) cleaned='+'+cleaned.slice(2);
 if (!cleaned.startsWith('+')&&cleaned.startsWith('55')&&cleaned.length>=12) cleaned='+'+cleaned;
 const number=parsePhoneNumberFromString(cleaned,'BR');
 return number?.isValid()?number.number.slice(1):null;
}
const phoneHeader=(s:string)=>/^(telefone|celular|whatsapp|whats|fone|phone|phone number|numero|numero whatsapp|numero de telefone|contato|tel)(\s*\d+)?$/.test(normalize(s));
function cellText(cell:ExcelJS.Cell) {
 const v=cell.value;
 if(v==null)return '';
 // Formula results are not trusted as contact data, and formulas are never evaluated.
 if(typeof v==='object'&&('formula' in v||'sharedFormula' in v))return '';
 if(typeof v==='object'&&'richText' in v)return v.richText.map(x=>x.text).join('').trim();
 if(v instanceof Date)return v.toISOString().replace(/T00:00:00.000Z$/,'').replace(/\.000Z$/,'');
 return cell.text.trim();
}
async function validateZip(buffer:Buffer) {
 await new Promise<void>((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(error,zip)=>{
  if(error||!zip)return reject(new Error('Arquivo XLSX inválido.'));
  let expanded=0,entries=0,done=false;
  const fail=()=>{if(!done){done=true;zip.close();reject(new Error('Planilha muito grande após descompactar. Limite: 60 MB e 1.500 arquivos internos.'));}};
  zip.on('error',reject);zip.on('end',()=>{if(!done)resolve();});
  zip.on('entry',entry=>{expanded+=entry.uncompressedSize;entries++;if(expanded>60*1024*1024||entries>1500)fail();else zip.readEntry();});zip.readEntry();
 }));
}
export async function parseWorkbook(buffer:Buffer,overrides:Record<string,{headerRow?:number;phoneColumn?:string}>={},options:{phoneAliases?:string[];nameAliases?:string[];headerHints?:string[][];keepDuplicates?:boolean;headerRow?:number}={}) {
 if(buffer.length>10*1024*1024)throw new Error('Limite de upload: 10 MB.');
 await validateZip(buffer);
 const book=new ExcelJS.Workbook();await book.xlsx.load(buffer as any);
 if(book.worksheets.length>31)throw new Error('Importe até 31 abas por vez.');
 const sheets:SheetPreview[]=[];let totalRows=0;
 for(const sheet of book.worksheets) {
  if(sheet.state!=='visible')continue;
  if(sheet.rowCount>50000||sheet.columnCount>100)throw new Error('Cada aba pode ter até 50.000 linhas e 100 colunas.');
  totalRows+=sheet.rowCount;if(totalRows>100000)throw new Error('Limite de 100.000 linhas por arquivo.');
  const raw:string[][]=[];
  for(let i=1;i<=sheet.rowCount;i++)raw.push(Array.from({length:sheet.columnCount},(_,j)=>cellText(sheet.getCell(i,j+1))));
  const matchesPhone=(s:string)=>options.phoneAliases?options.phoneAliases.some(a=>normalize(a)===normalize(s)):phoneHeader(s);
  const override=overrides[sheet.name]; let header=(override?.headerRow||options.headerRow||0)-1;
  if(header<0) {
   let best=-1,tied=false;
   raw.slice(0,options.keepDuplicates?500:100).forEach((row,i)=>{const matches=row.filter(matchesPhone).length;const hints=(options.headerHints||[]).filter(aliases=>row.some(c=>aliases.some(a=>normalize(a)===normalize(c)))).length;const phoneCols=row.map((s,j)=>matchesPhone(s)?j:-1).filter(j=>j>=0);const evidence=raw.slice(i+1,i+6).reduce((n,r)=>n+(phoneCols.some(j=>normalizePhone(r[j]||''))?1:0),0);const score=matches*10+hints*3+Math.min(row.filter(Boolean).length,9)+evidence*2;if(matches&&score>best){best=score;header=i;tied=false;}else if(matches&&score===best&&evidence&&JSON.stringify(row.map(normalize))!==JSON.stringify(raw[header].map(normalize)))tied=true;});
   if(options.keepDuplicates&&tied)header=-1;
  }
  const result:SheetPreview={name:sheet.name,headerRow:header+1,phoneColumn:'',columns:[],rows:[],invalid:0,duplicates:0,warnings:[],sample:raw.slice(0,12),rejectedRows:[]};
  if(header<0||header>=raw.length){result.warnings.push('Cabeçalho não identificado. Informe a linha do cabeçalho.');sheets.push(result);continue;}
  const counts=new Map<string,number>();
  result.columns=raw[header].map((s,i)=>{const base=s||`Coluna ${i+1}`;const n=(counts.get(base)||0)+1;counts.set(base,n);return n>1?`${base} (${n})`:base;});
  const candidates=raw[header].map((s,i)=>matchesPhone(s)?i:-1).filter(i=>i>=0);
  let phoneIndex=override?.phoneColumn?result.columns.indexOf(override.phoneColumn):candidates.length===1?candidates[0]:-1;
  if(phoneIndex<0){result.warnings.push(candidates.length>1?'Mais de uma coluna de telefone. Selecione a correta.':'Selecione a coluna de telefone.');sheets.push(result);continue;}
  result.phoneColumn=result.columns[phoneIndex];
  const nameIndex=raw[header].findIndex(s=>options.nameAliases?options.nameAliases.some(a=>normalize(a)===normalize(s)):/^(nome|name|cliente|nome completo)$/.test(normalize(s)));const seen=new Set<string>();
  raw.slice(header+1).forEach((row,index)=>{
   if(!row.some(Boolean)||matchesPhone(row[phoneIndex]||''))return;
   if(options.keepDuplicates&&!row[phoneIndex]&&row.filter(Boolean).length<=1)return;
   const phone=normalizePhone(row[phoneIndex]||'');if(!phone){result.invalid++;result.rejectedRows!.push({row:index+header+2,reason:'Telefone ausente ou inválido.'});return;}
   if(!options.keepDuplicates&&seen.has(phone)){result.duplicates++;return;}seen.add(phone);
   result.rows.push({sheet:sheet.name,row:index+header+2,phone,name:nameIndex>=0?row[nameIndex]:'',fields:Object.fromEntries(result.columns.map((c,i)=>[c,row[i]||'']))});
  });
  if(result.invalid)result.warnings.push(`${result.invalid} linha(s) sem telefone válido serão ignoradas.`);
  if(result.duplicates)result.warnings.push(`${result.duplicates} telefone(s) repetido(s) removidos nesta aba.`);
  sheets.push(result);
 }
 return sheets;
}
