-- New imports enter the queue directly. Legacy consent is retained without fabricating a confirmation.
alter table app.campaigns drop constraint campaigns_consent_confirmed_check;
alter table app.campaigns alter column consent_confirmed set default false;
alter table app.clients add column late_interest_rate numeric(9,4) not null default 0 check(late_interest_rate between 0 and 100);
alter table app.clients add column late_interest_basis text not null default 'monthly' check(late_interest_basis in ('daily','monthly'));
alter table app.invoices add column late_interest_rate numeric(9,4) not null default 0 check(late_interest_rate between 0 and 100);
alter table app.invoices add column late_interest_basis text not null default 'monthly' check(late_interest_basis in ('daily','monthly'));
alter table app.invoices add column paid_total numeric(14,2);
update app.invoices set paid_total=total where status='paid';
create function app.invoice_balance(principal numeric,due date,rate numeric,basis text,until_at timestamptz)
returns table(overdue_days integer,interest_amount numeric,amount_due numeric) language sql stable as $$
 with delay as (select greatest(0,(until_at at time zone 'America/Sao_Paulo')::date-due) as days),
 amounts as (select days,round(principal*rate/100*days/(case when basis='monthly' then 30 else 1 end),2) as interest from delay)
 select days,interest,principal+interest from amounts
$$;
create table app.error_logs (
 id uuid primary key default gen_random_uuid(),occurred_at timestamptz not null default now(),
 source text not null,operation text not null,code text not null default '',message text not null,details text not null default '',
 client_id uuid references app.clients(id) on delete set null,campaign_id uuid references app.campaigns(id) on delete set null,
 request_id text not null default '',resolved_at timestamptz
);
create index error_logs_recent on app.error_logs(occurred_at desc);
revoke all on app.error_logs from public;

-- Upgrade the untouched default only; custom client messages are preserved.
alter table app.billing_email_settings alter column body_template set default E'Olá, {{cliente_nome}}!\n\nConfira sua cobrança de {{competencia}}:\n\nPlano: {{plano}}\nMensalidade: {{mensalidade}}\nMensagens enviadas: {{disparos_enviados}} de {{limite_mensal}}\nAdicionais: {{disparos_excedentes}} · {{valor_excedente}}\n\nValor original: {{valor_original}}\nJuros por atraso: {{juros}} · {{dias_atraso}} dias\nTaxa contratada: {{taxa_juros}}\nTotal: {{total}}\nVencimento: {{vencimento}}\n\n{{instrucoes_pagamento}}\n\nSe precisar, fale com nossa equipe.\nReferência: {{referencia}}';
update app.billing_email_settings set body_template=E'Olá, {{cliente_nome}}!\n\nConfira sua cobrança de {{competencia}}:\n\nPlano: {{plano}}\nMensalidade: {{mensalidade}}\nMensagens enviadas: {{disparos_enviados}} de {{limite_mensal}}\nAdicionais: {{disparos_excedentes}} · {{valor_excedente}}\n\nValor original: {{valor_original}}\nJuros por atraso: {{juros}} · {{dias_atraso}} dias\nTaxa contratada: {{taxa_juros}}\nTotal: {{total}}\nVencimento: {{vencimento}}\n\n{{instrucoes_pagamento}}\n\nSe precisar, fale com nossa equipe.\nReferência: {{referencia}}',version=version+1 where body_template=E'Olá, {{cliente_nome}}!\n\nConfira sua cobrança de {{competencia}}:\n\nPlano: {{plano}}\nMensalidade: {{mensalidade}}\nMensagens enviadas: {{disparos_enviados}} de {{limite_mensal}}\nAdicionais: {{disparos_excedentes}} · {{valor_excedente}}\n\nTotal: {{total}}\nVencimento: {{vencimento}}\n\n{{instrucoes_pagamento}}\n\nSe precisar, fale com nossa equipe.\nReferência: {{referencia}}';
