const portalPath=location.pathname.replace(/\/+$/,'');
export const portalMode=portalPath.startsWith('/p')||/^\/[a-z0-9_]+$/.test(portalPath);
const portalSlug=portalPath.startsWith('/p/')||portalPath==='/p'?'':portalPath.slice(1);
const storageKey='diagchat_portal:'+portalPath;
// The secret stays in the fragment until first use, then in tab-scoped storage.
export const portalToken=portalMode?(location.hash.slice(1)||sessionStorage.getItem(storageKey)||(portalSlug?'':sessionStorage.getItem('diagchat_portal'))||''):'';
if(portalMode&&location.hash){sessionStorage.setItem(storageKey,portalToken);history.replaceState(null,'',location.pathname);}
export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{
 const headers=new Headers(options.headers);if(!(options.body instanceof FormData))headers.set('Content-Type','application/json');
 if(portalMode){headers.set('X-Portal-Token',portalToken);if(portalSlug)headers.set('X-Portal-Slug',portalSlug);}
 let response:Response;try{response=await fetch('/api'+path,{...options,headers,credentials:'same-origin'});}catch(error){if(path!=='/error-events')reportBrowserError(error,`Conexão: ${(options.method||'GET')} ${path.split('?')[0]}`);throw error;}
 const data=await response.json().catch(()=>({error:'Resposta inválida do servidor.'}));if(!response.ok){const error=new Error(data.error||'Não foi possível concluir a operação.') as Error&{status:number};error.status=response.status;throw error;}return data;
}
export const brl=(value:number|string=0)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value));
export const number=(value:number|string=0)=>new Intl.NumberFormat('pt-BR').format(Number(value));
export const date=(value:string)=>new Date(value).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
export function exportCSV(filename:string,rows:unknown[][]){const content='\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"').join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function reportBrowserError(error:unknown,operation='Interface do sistema'){
 const message=error instanceof Error?error.message:String(error||'Falha sem descrição');
 void api('/error-events',{method:'POST',body:JSON.stringify({operation:operation.slice(0,200),message:message.slice(0,2000)})}).catch(()=>{});
}
window.addEventListener?.('error',event=>reportBrowserError(event.error||event.message,'Erro de execução da interface'));
window.addEventListener?.('unhandledrejection',event=>reportBrowserError(event.reason,'Operação da interface não concluída'));
