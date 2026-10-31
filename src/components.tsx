import { useEffect,useRef,type ReactNode } from 'react';
import { X,ArrowUpRight,Check,Copy,Inbox } from 'lucide-react';
import { useState } from 'react';
export function Modal({title,subtitle,children,onClose,wide=false}:{title:string;subtitle?:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();const old=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=old;};},[]);
 return <dialog ref={ref} className={wide?'modal wide':'modal'} onCancel={onClose}><div className="modal-head"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-btn" aria-label="Fechar" onClick={onClose}><X size={22}/></button></div>{children}</dialog>;
}
export function Field({label,hint,children,full=false}:{label:string;hint?:string;children:ReactNode;full?:boolean}){return <label className={'field'+(full?' full':'')}><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;}
export function Avatar({name,photo,size=''}:{name:string;photo?:string;size?:string}){return <span className={'avatar '+size}>{photo?<img alt="" src={photo} onError={e=>{e.currentTarget.style.display='none';}}/>:name.split(' ').slice(0,2).map(s=>s[0]).join('')}</span>;}
const statuses:Record<string,[string,string]>={running:['Em andamento','green'],completed:['Concluído','green'],pending:['Aguardando aprovação','amber'],paused:['Pausado','muted'],blocked:['Limite atingido','amber'],cancelled:['Cancelado','muted'],paid:['Pago','green'],open:['Em aberto','amber'],sent:['Enviado','green'],sending:['Enviando','amber'],review:['Revisar','amber']};
export function Badge({status,label}:{status:string;label?:string}){const [text,color]=statuses[status]||[status,'muted'];return <span className={'badge '+color}><span className="dot"/>{label||text}</span>;}
export function Progress({used,total}:{used:number;total:number}){return <div className="progress"><span className={used>=total?'at-limit':''} style={{width:`${total?Math.min(100,100*used/total):0}%`}}/></div>;}
export function Empty({title,text,action}:{title:string;text:string;action?:ReactNode}){return <div className="empty"><span className="empty-icon"><Inbox size={28}/></span><h3>{title}</h3><p>{text}</p>{action}</div>;}
export function CopyValue({value,label='Copiar'}:{value:string;label?:string}){const [copied,setCopied]=useState(false);return <button type="button" className="button secondary" onClick={async()=>{try{await navigator.clipboard.writeText(value);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{setCopied(false);}}}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'Copiado':label}</button>;}
export function Metric({label,value,note,icon,accent=false}:{label:string;value:string;note:string;icon:ReactNode;accent?:boolean}){return <div className={'metric'+(accent?' accent':'')}><div className="metric-label">{label}<span>{icon}</span></div><strong>{value}</strong><small>{accent&&<ArrowUpRight size={14}/>} {note}</small></div>;}

export function ScrollArea({label,children,className=""}:{label:string;children:ReactNode;className?:string}){return <div className={"scroll-region "+className} role="region" aria-label={label} tabIndex={0}>{children}</div>;}
