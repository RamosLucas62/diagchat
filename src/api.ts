export const portalMode=location.pathname.startsWith('/p/');
// Fragment is never sent in HTTP requests or referrers. Keep the capability scoped to this tab.
export const portalToken=portalMode?(location.hash.slice(1)||sessionStorage.getItem('diagchat_portal')||''):'';
if(portalMode&&location.hash){sessionStorage.setItem('diagchat_portal',portalToken);history.replaceState(null,'',location.pathname);}
export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{
 const headers=new Headers(options.headers);if(!(options.body instanceof FormData))headers.set('Content-Type','application/json');
 if(portalMode)headers.set('X-Portal-Token',portalToken);
 const response=await fetch('/api'+path,{...options,headers,credentials:'same-origin'});
 const data=await response.json().catch(()=>({error:'Resposta inválida do servidor.'}));if(!response.ok){const error=new Error(data.error||'Não foi possível concluir a operação.') as Error&{status:number};error.status=response.status;throw error;}return data;
}
export const brl=(value:number|string=0)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value));
export const number=(value:number|string=0)=>new Intl.NumberFormat('pt-BR').format(Number(value));
export const date=(value:string)=>new Date(value).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
export function exportCSV(filename:string,rows:unknown[][]){const content='\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"').join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
