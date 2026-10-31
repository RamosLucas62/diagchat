import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {parseWorkbook,normalizePhone} from '../server/importer.js';
test('normaliza telefone brasileiro e internacional sem inventar números',()=>{
 assert.equal(normalizePhone('(11) 99999-1234'),'5511999991234');assert.equal(normalizePhone('55 11 99999 1234'),'5511999991234');assert.equal(normalizePhone('+1 202-555-0123'),'12025550123');assert.equal(normalizePhone('123'),null);assert.equal(normalizePhone('5.511999991234E+12'),null);
});
test('detecta cabeçalho na linha 8, abas, duplicatas e linhas inválidas',async()=>{
 const book=new ExcelJS.Workbook();const a=book.addWorksheet('01 novembro');a.getCell('A1').value='Relatório de clientes';a.getRow(8).values=['Nome','WhatsApp','Data'];a.getRow(9).values=['Ana','(11) 99999-1234','2026-11-01'];a.getRow(10).values=['Repetido','5511999991234',''];a.getRow(11).values=['Inválido','123',''];a.getRow(12).values=['Nome','WhatsApp','Data'];
 const b=book.addWorksheet('02 novembro');b.addRow(['Cliente','Telefone']);b.addRow(['Bruno',5511988881234]);
 const parsed=await parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()));assert.equal(parsed.length,2);assert.equal(parsed[0].headerRow,8);assert.equal(parsed[0].rows[0].row,9);assert.equal(parsed[0].rows[0].phone,'5511999991234');assert.equal(parsed[0].duplicates,1);assert.equal(parsed[0].invalid,1);assert.equal(parsed[1].rows.length,1);
});
test('exige escolha em caso de colunas ambíguas e aceita mapeamento manual',async()=>{
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Lista');sheet.addRow(['Nome','Telefone','Celular']);sheet.addRow(['Ana','11999991234','11988881234']);const bytes=Buffer.from(await book.xlsx.writeBuffer());
 const first=await parseWorkbook(bytes);assert.equal(first[0].rows.length,0);assert.match(first[0].warnings[0],/Mais de uma/);const manual=await parseWorkbook(bytes,{Lista:{headerRow:1,phoneColumn:'Celular'}});assert.equal(manual[0].rows[0].phone,'5511988881234');
});
test('não usa fórmulas como contato e permite cabeçalho sem nome conhecido',async()=>{
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Lista');sheet.addRow(['Pessoa','Número destino']);sheet.addRow(['Ana',{formula:'1+1',result:5511999991234}]);sheet.addRow(['Bruno','11988881234']);const bytes=Buffer.from(await book.xlsx.writeBuffer());assert.equal((await parseWorkbook(bytes))[0].headerRow,0);const result=await parseWorkbook(bytes,{Lista:{headerRow:1,phoneColumn:'Número destino'}});assert.equal(result[0].rows.length,1);assert.equal(result[0].invalid,1);
});
test('rejeita arquivo não XLSX',async()=>{await assert.rejects(()=>parseWorkbook(Buffer.from('invalid')),/XLSX inválido/);});
