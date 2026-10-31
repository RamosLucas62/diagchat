import {ArrowUpRight,Link2,Zap,ShieldCheck,Coins} from 'lucide-react';
import {Avatar,Badge,Progress} from './components';
import {brl,number} from './api';
import type {Client} from './types';
export function ClientCards({clients,onEdit,onPortal}:{clients:Client[];onEdit:(c:Client)=>void;onPortal:(c:Client)=>void}){
 return <div className="client-cards">{clients.map(c=>{
 const remaining=Math.max(0,c.current_limit-c.used-c.reserved);const pct=c.current_limit?Math.round(c.used/c.current_limit*100):c.used?100:0;
 return <article className="client-card" key={c.id}><header><Avatar name={c.name} photo={c.photo_url}/><Badge status={c.active?'running':'paused'} label={c.active?'Ativo':'Inativo'}/></header><button className="client-card-name" onClick={()=>onEdit(c)}>{c.name}</button><p className="client-card-email">{c.email}</p><div className="client-plan"><span>{c.plan_name}</span><strong>{brl(c.monthly_fee)}<small>/ mês</small></strong></div><div className="client-card-usage"><div><span>Consumo do mês</span><strong>{pct}%</strong></div><Progress used={c.used} total={c.current_limit}/><div><span><strong>{number(c.used)}</strong> / {number(c.current_limit)}</span><span>{number(remaining)} disponíveis</span></div></div><div className="client-card-details"><span><Zap size={14}/>{c.throughput} msg/s</span><span>{c.overage_mode==='charge'?<Coins size={14}/>:<ShieldCheck size={14}/>} {c.overage_mode==='charge'?`${brl(c.overage_rate)} / adicional`:'Bloqueio no limite'}</span></div><footer><button className="button secondary" aria-label={`Gerar portal para ${c.name}`} onClick={()=>onPortal(c)}><Link2 size={15}/>Portal do cliente</button><button className="icon-btn" title="Editar cliente" aria-label={`Editar ${c.name}`} onClick={()=>onEdit(c)}><ArrowUpRight size={18}/></button></footer></article>;
 })}</div>;
}
