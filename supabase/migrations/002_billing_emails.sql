create table app.billing_email_settings (
 client_id uuid primary key references app.clients(id) on delete cascade,
 auto_send boolean not null default true,
 subject_template text not null default 'Sua cobrança DiagChat — {{competencia}}',
 body_template text not null default E'Olá, {{cliente_nome}}!\n\nConfira sua cobrança de {{competencia}}:\n\nPlano: {{plano}}\nMensalidade: {{mensalidade}}\nMensagens enviadas: {{disparos_enviados}} de {{limite_mensal}}\nAdicionais: {{disparos_excedentes}} · {{valor_excedente}}\n\nTotal: {{total}}\nVencimento: {{vencimento}}\n\n{{instrucoes_pagamento}}\n\nSe precisar, fale com nossa equipe.\nReferência: {{referencia}}',
 payment_instructions text not null default 'Entre em contato com nosso financeiro para os dados de pagamento.',
 version integer not null default 0,
 updated_at timestamptz not null default now(),
 check(length(subject_template) between 1 and 200),check(length(body_template) between 1 and 12000),
 check(length(payment_instructions)<=4000)
);
revoke all on app.billing_email_settings from public;
alter table app.outbox add column automatic boolean not null default false;
update app.outbox set automatic=true where kind='invoice';
alter table app.outbox drop constraint outbox_status_check;
alter table app.outbox add constraint outbox_status_check check(status in ('pending','sending','sent','review','held'));
