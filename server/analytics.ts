import {z} from 'zod';
import {query} from './db.js';
export function parseAnalyticsFilter(input:unknown,portalClientId?:string){
 const value=z.object({start:z.iso.date(),end:z.iso.date(),client_id:z.uuid().optional()}).parse(input);
 const days=Math.round((Date.parse(value.end)-Date.parse(value.start))/86400000)+1;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(days<1||days>366||value.end>today)throw new Error('Selecione um período válido de até 366 dias, sem datas futuras.');
 if(portalClientId&&value.client_id&&value.client_id!==portalClientId)return null;
 return {...value,days,clientId:portalClientId||value.client_id||null};
}
export async function analytics(filter:NonNullable<ReturnType<typeof parseAnalyticsFilter>>,portal:boolean){
 const args=[filter.clientId,filter.start,filter.end];
 const [messages]=await query(`select count(*)::int as sent,
 count(*) filter(where delivery in ('delivered','read'))::int as delivered,
 count(*) filter(where delivery='read')::int as read,
 count(*) filter(where delivery='failed')::int as delivery_failed
 from app.messages where accepted_at>=($2::date::timestamp at time zone 'America/Sao_Paulo')
 and accepted_at<(($3::date+1)::timestamp at time zone 'America/Sao_Paulo')
 and ($1::uuid is null or client_id=$1)`,args);
 const [attempts]=await query(`select count(*) filter(where state='failed')::int as failed,
 count(*) filter(where state='unknown')::int as uncertain from app.messages
 where claimed_at>=($2::date::timestamp at time zone 'America/Sao_Paulo')
 and claimed_at<(($3::date+1)::timestamp at time zone 'America/Sao_Paulo')
 and ($1::uuid is null or client_id=$1)`,args);
 const [imports]=await query(`select count(*)::int as failed from app.import_failures where created_at>=($2::date::timestamp at time zone 'America/Sao_Paulo') and created_at<(($3::date+1)::timestamp at time zone 'America/Sao_Paulo') and ($1::uuid is null or client_id=$1)`,args);
 const [usage]=await query(`select coalesce(sum(u.reserved),0)::int as reserved,coalesce(sum(u.monthly_limit),0)::int as quota,
 coalesce(sum(round(u.monthly_fee+greatest(0,u.accepted-u.monthly_limit)*u.overage_rate,2)),0)::float as revenue,
 coalesce(sum(u.cost),0)::float as cost from app.usage u
 where u.period>=date_trunc('month',$2::date)::date and u.period<=date_trunc('month',$3::date)::date
 and ($1::uuid is null or u.client_id=$1)`,args);
 const [clients]=await query(`select count(*)::int as clients from app.clients where active and ($1::uuid is null or id=$1)
 and created_at<(($2::date+1)::timestamp at time zone 'America/Sao_Paulo')`,[filter.clientId,filter.end]);
 const daily=await query(`with counts as (
 select (accepted_at at time zone 'America/Sao_Paulo')::date as day,count(*)::int as sent from app.messages
 where accepted_at>=($2::date::timestamp at time zone 'America/Sao_Paulo')
 and accepted_at<(($3::date+1)::timestamp at time zone 'America/Sao_Paulo')
 and ($1::uuid is null or client_id=$1) group by day)
 select d::date::text as date,coalesce(c.sent,0)::int as sent
 from generate_series($2::date,$3::date,interval '1 day') d left join counts c on c.day=d::date order by d`,args);
 const result={...usage,...clients,sent:messages.sent,delivered:messages.delivered,read:messages.read,
 failed:messages.delivery_failed+attempts.failed+imports.failed,uncertain:attempts.uncertain,
 average:Math.round(messages.sent/filter.days),profit:usage.revenue-usage.cost,daily};
 if(portal){const {revenue,cost,profit,...safe}=result;return safe;}return result;
}
