import type {DB} from './db.js';
export function portalSlug(name:string){const slug=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,120);return !slug||['api','p','assets','favicon_ico','robots_txt'].includes(slug)?'cliente':slug;}
export function portalTemplate<T extends {name:string;language:string;supported:boolean}>(client:{default_template_name:string;default_template_language:string},available:T[]){
 const supported=available.filter(t=>t.supported);
 if(client.default_template_name)return supported.find(t=>t.name===client.default_template_name&&t.language===client.default_template_language);
 return supported.length===1?supported[0]:undefined;
}
export async function nextPortalCampaignName(db:DB,client:{id:string;name:string},scheduledAt:string){
 const [counter]=(await db.query(`insert into app.campaign_daily_counters(client_id,day,sequence) values($1,($2::timestamptz at time zone 'America/Sao_Paulo')::date,1) on conflict(client_id,day) do update set sequence=app.campaign_daily_counters.sequence+1 returning to_char(day,'DD.MM.YY') as label,sequence`,[client.id,scheduledAt])).rows;
 return `${client.name} | ${counter.label} | ${String(counter.sequence).padStart(2,'0')}`;
}
