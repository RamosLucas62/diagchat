import {useEffect,useState} from 'react';
import {api,number} from './api';
import {ScrollArea} from './components';
type Failure={id:string;sheet_name:string;row_number:number;message:string;created_at:string};
type Page={items:Failure[];total:number;offset:number;limit:number};
export function CampaignImportFailures({campaignId}:{campaignId:string}){
 const [offset,setOffset]=useState(0),[page,setPage]=useState<Page>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;setBusy(true);setError('');api<Page>(`/campaigns/${campaignId}/import-failures?offset=${offset}`).then(data=>{if(active)setPage(data);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[campaignId,offset]);
 return <section className="campaign-import-failures"><h4>Falhas da planilha</h4><p>Estas linhas não foram enviadas e não consumiram a franquia.</p>{error&&<div className="alert error" role="alert">{error}</div>}<ScrollArea label="Linhas com falha na importação" className="failure-rows"><table><thead><tr><th>Aba</th><th>Linha</th><th>Motivo</th></tr></thead><tbody>{page?.items.map(item=><tr key={item.id}><td>{item.sheet_name}</td><td>{item.row_number}</td><td className="failure-reason">{item.message}<small>Registrada em {new Date(item.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</small></td></tr>)}</tbody></table>{busy&&!page&&<p role="status">Carregando falhas…</p>}</ScrollArea>{page&&<div className="failure-pagination"><small>{number(offset+1)}–{number(Math.min(offset+page.limit,page.total))} de {number(page.total)} falhas</small><div className="actions"><button type="button" className="button secondary" disabled={busy||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-100))}>Anterior</button><button type="button" className="button secondary" disabled={busy||offset+page.limit>=page.total} onClick={()=>setOffset(n=>n+100)}>Próxima</button></div></div>}</section>;
}
