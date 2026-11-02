// Document URLs come from an authenticated Asaas API response. Never send the API key to a download host.
export function documentUrl(value:string){
 const u=new URL(value);const hosts=(process.env.ASAAS_DOCUMENT_HOSTS||'').split(',').map(h=>h.trim().toLowerCase()).filter(Boolean);
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!(u.hostname==='asaas.com'||u.hostname.endsWith('.asaas.com')||hosts.includes(u.hostname)))throw new Error('Domínio de documento não permitido. Configure ASAAS_DOCUMENT_HOSTS com o domínio exato retornado pelo Asaas.');
 return u;
}
export async function downloadAsaasPdf(url:string):Promise<string>{
 let current=documentUrl(url);
 for(let redirects=0;redirects<=3;redirects++){
  const response=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(20000)});
  if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();current=documentUrl(new URL(response.headers.get('location')||'',current).href);continue;}
  if(!response.ok||!response.body)throw new Error('Falha ao baixar documento Asaas: HTTP '+response.status);
  if(Number(response.headers.get('content-length'))>8*1024*1024){await response.body.cancel();throw new Error('Documento Asaas excede 8 MB.');}
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();throw new Error('Documento Asaas excede 8 MB.');}chunks.push(value);}
  const bytes=Buffer.concat(chunks);if(bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('O documento retornado pelo Asaas não é PDF.');return bytes.toString('base64');
 }
 throw new Error('Redirecionamentos excessivos no documento Asaas.');
}
