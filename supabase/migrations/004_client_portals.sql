alter table app.clients add column portal_slug text;
alter table app.clients add column allow_template_selection boolean not null default false;
alter table app.clients add column default_template_name text not null default '';
alter table app.clients add column default_template_language text not null default 'pt_BR';
-- Existing URLs remain valid. Slugs are stable after creation, including client renames.
with names as (
 select id,trim(both '_' from regexp_replace(translate(lower(name),'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn'),'[^a-z0-9]+','_','g')) as slug from app.clients
), ranked as (
 select id,slug,row_number() over(partition by slug order by id) as n from names
)
update app.clients c set portal_slug=case when r.slug='' or r.slug in ('api','p','assets','favicon_ico','robots_txt') then 'cliente_'||replace(c.id::text,'-','') when r.n>1 then r.slug||'_'||replace(c.id::text,'-','') else r.slug end from ranked r where c.id=r.id;
alter table app.clients alter column portal_slug set not null;
alter table app.clients alter column portal_slug set default ('cliente_'||replace(gen_random_uuid()::text,'-',''));
create unique index clients_portal_slug on app.clients(portal_slug);
-- Apply previously edited quotas to the open month. Closed months and prices stay intact.
update app.usage u set monthly_limit=c.monthly_limit from app.clients c where c.id=u.client_id and u.period=app.current_period();
create table app.campaign_daily_counters (
 client_id uuid not null references app.clients(id) on delete cascade,
 day date not null, sequence integer not null check(sequence>0),primary key(client_id,day)
);
revoke all on app.campaign_daily_counters from public;
