import { CalendarDays,Filter,RotateCcw } from 'lucide-react';
import type {Client} from './types';
export type DashboardFilter={start:string;end:string;clientId:string;preset:string};
export function todayInSaoPaulo(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function rangeFor(preset:string):DashboardFilter {
 const end=todayInSaoPaulo();const d=new Date(end+'T12:00:00Z');
 if(preset==='month')return {start:end.slice(0,7)+'-01',end,clientId:'',preset};
 d.setUTCDate(d.getUTCDate()-(Number(preset)||30)+1);
 return {start:d.toISOString().slice(0,10),end,clientId:'',preset};
}
export function DashboardFilters({value,onChange,clients,portal}:{value:DashboardFilter;onChange:(v:DashboardFilter)=>void;clients:Client[];portal:boolean}){
 const presets=[['month','Este mês'],['7','Últimos 7 dias'],['30','Últimos 30 dias'],['90','Últimos 90 dias'],['365','Último ano'],['custom','Personalizado']];
 return <section className="dashboard-filters" aria-label="Filtros da visão geral"><div className="filter-heading"><span><Filter size={15}/> Filtrar resultados</span><button className="text-button" onClick={()=>onChange(rangeFor('month'))}><RotateCcw size={13}/>Limpar filtros</button></div><div className="period-options" aria-label="Períodos rápidos">{presets.map(([id,label])=><button key={id} aria-pressed={value.preset===id} className={value.preset===id?'selected':''} onClick={()=>onChange(id==='custom'?{...value,preset:id}:{...rangeFor(id),clientId:value.clientId})}>{label}</button>)}</div><div className={'filter-fields '+(portal?'portal-filters':'')}><label className="field"><span><CalendarDays size={14}/> Data inicial</span><input type="date" value={value.start} max={value.end||todayInSaoPaulo()} required onChange={e=>{if(e.target.value)onChange({...value,start:e.target.value,preset:'custom'});}}/></label><label className="field"><span>Data final</span><input type="date" value={value.end} min={value.start} max={todayInSaoPaulo()} required onChange={e=>{if(e.target.value)onChange({...value,end:e.target.value,preset:'custom'});}}/></label>{!portal&&<label className="field"><span>Cliente</span><select value={value.clientId} onChange={e=>onChange({...value,clientId:e.target.value})}><option value="">Todos os clientes</option>{clients.map(c=><option value={c.id} key={c.id}>{c.name}{c.active?'':' · inativo'}</option>)}</select></label>}</div></section>;
}
