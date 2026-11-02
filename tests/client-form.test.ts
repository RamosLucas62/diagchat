import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {automaticTemplate} from '../shared/import-semantics.js';
import {defaultImportProfile} from '../shared/import-profile.js';

test('cadastro abre a etapa 4 sem fechar, não duplica o cliente ao voltar e só entrega o link ao concluir',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,location:{pathname:'/',hash:''},document:{body:{style:{overflow:''}}},window:{confirm:()=>true}});
 const {ClientForm}=await import('../src/ClientForm.js');
 const templates=[{name:'consulta',language:'pt_BR',supported:true,body:'Olá {{1}}',parameters:['1']},{name:'retorno',language:'pt_BR',supported:true,body:'Olá {{1}}',parameters:['1']}];
 const config=defaultImportProfile();const requests:{path:string;method:string;body:any}[]=[];let rejectProfile=true;let completed=0;let resultUrl='';let closed=0;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(input,options)=>{const path=String(input),method=options?.method||'GET',body=options?.body?JSON.parse(String(options.body)):undefined;requests.push({path,method,body});
  if(path==='/api/clients'&&method==='POST')return Response.json({id:'new-client',portalUrl:'https://example.com/cliente#secret'});
  if(path==='/api/clients/new-client'&&method==='PUT')return Response.json({id:'new-client'});
  if(path.endsWith('/import-profile')&&method==='GET')return Response.json({config,version:0,templates});
  if(path.endsWith('/import-profile')&&method==='PUT')return rejectProfile?Response.json({error:'Corrija o perfil antes de concluir.'},{status:400}):Response.json({version:1});
  throw new Error('Unexpected request '+method+' '+path);
 };
 let tree:ReactTestRenderer;try{
  await act(async()=>{tree=create(React.createElement(ClientForm,{demo:true,baseUrl:'https://example.com',onClose:()=>{closed++;},onSaved:(url?:string)=>{completed++;resultUrl=url||'';}}));});
  const button=(text:string)=>tree.root.findAllByType('button').find(b=>b.children.join('').includes(text))!;
  for(let i=0;i<3;i++)await act(async()=>{await button('Continuar').props.onClick();});
  assert.equal(completed,0);assert.equal(closed,0);assert.equal(requests.filter(r=>r.method==='POST').length,1);
  assert.equal(tree!.root.findAllByType('input').filter(i=>i.props.type==='checkbox').length,0,'fixed mode must not expose multi-selection');
  assert.equal(tree!.root.findAllByType('input').some(i=>i.props.value==='Telefone | Celular | WhatsApp | Fone | Contato'),false);
  // Going back and entering step 4 again updates the same client.
  await act(async()=>{await tree.root.findAllByType('button').find(b=>b.props.children?.[0]==='03')!.props.onClick();});
  await act(async()=>{await button('Continuar').props.onClick();});
  assert.equal(requests.filter(r=>r.path==='/api/clients'&&r.method==='POST').length,1);
  assert.equal(requests.filter(r=>r.path==='/api/clients/new-client'&&r.method==='PUT').length,1);
  const select=tree!.root.findAllByType('select').find(s=>s.findAllByType('option').some(o=>o.props.value==='consulta:pt_BR'))!;
  await act(async()=>{select.props.onChange({target:{value:'consulta:pt_BR'}});});
  assert.equal(completed,0);await act(async()=>{await button('Concluir cadastro').props.onClick();});assert.equal(completed,0,'profile validation must keep the wizard open');assert.equal(closed,0);rejectProfile=false;await act(async()=>{await button('Concluir cadastro').props.onClick();});
  assert.equal(completed,1);assert.equal(resultUrl,'https://example.com/cliente#secret');
  const profileSave=requests.find(r=>r.path.endsWith('/import-profile')&&r.method==='PUT')!;
  assert.deepEqual(profileSave.body.config.templates,[automaticTemplate(templates[0])]);
 }finally{await act(async()=>{tree?.unmount();});globalThis.fetch=originalFetch;}
});

test('solicitar disparo dispensa checkbox e envia o formulário diretamente para a fila',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,location:{pathname:'/',hash:''},document:{body:{style:{overflow:''}}},window:{confirm:()=>true}});
 const {CampaignForm}=await import('../src/CampaignForm.js');let completed=false;let submitted:any;const originalFetch=globalThis.fetch;
 globalThis.fetch=async(input,options)=>{const path=String(input);if(path.endsWith('/import-options'))return Response.json({mode:'fixed',templates:[]});if(path==='/api/import-batches')return Response.json({id:'batch',status:'ready',issues:[],summary:{rows:1,messages:1,sheets:1,duplicates:0,groups:0,segments:[]}});if(path.endsWith('/submit')){submitted=JSON.parse(String(options?.body));return Response.json({status:'submitted'});}throw new Error('Unexpected '+path);};
 let tree:ReactTestRenderer;try{
  await act(async()=>{tree=create(React.createElement(CampaignForm,{clients:[{id:'client'}] as any,portal:true,onClose:()=>{},onSaved:review=>{assert.equal(review,false);completed=true;}}));});
  await act(async()=>{tree.root.findByType('input').props.onChange({target:{files:[new File(['xlsx'],'lista.xlsx')],value:''}});});
  assert.equal(tree!.root.findAllByType('input').some(i=>i.props.type==='checkbox'),false);
  const submit=tree!.root.findAllByType('button').find(b=>b.children.join('').includes('Iniciar disparo'))!;assert.equal(submit.props.disabled,false);
  await act(async()=>{await submit.props.onClick();});assert.equal(completed,true);assert.deepEqual(submitted,{});
 }finally{await act(async()=>tree?.unmount());globalThis.fetch=originalFetch;}
});
