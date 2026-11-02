-- Additional links coexist with the original client link. Tokens remain hashed.
create table app.portal_links (
 token_hash text primary key,client_id uuid not null references app.clients(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index portal_links_client on app.portal_links(client_id);
insert into app.portal_links(token_hash,client_id) select portal_hash,id from app.clients on conflict do nothing;
revoke all on app.portal_links from public;
