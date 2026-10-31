# Instalação no EasyPanel

A aplicação tem dois processos: `web` atende o painel/portal/webhooks; `worker` executa a fila, fecha ciclos e envia cobranças e avisos. Ambos usam o mesmo PostgreSQL do Supabase. O painel funciona sem Redis.

## 1. Supabase

Crie o projeto e copie a string de conexão PostgreSQL. Para uma VPS persistente, use conexão direta ou pooler em modo **session**. A disponibilidade de IPv4 depende da opção escolhida. Use TLS na conexão e a configuração de certificado recomendada pelo Supabase. Não adicione `rejectUnauthorized: false` ao código.

Copie também a URL do projeto e sua chave pública/anon para as variáveis do servidor. Não é necessário expor a service role no frontend.

Os dois serviços aplicam automaticamente as migrações pendentes ao iniciar, preservando os registros existentes. O bloqueio transacional impede que web e worker apliquem o mesmo arquivo em paralelo. Para executar manualmente, use:

```sh
# Checkout local com dependências instaladas:
npm run migrate
# Ou no terminal do container da aplicação já compilada:
node build/server/migrate.js
```

As tabelas ficam no schema privado `app`, fora dos schemas expostos pela Data API. Não exponha esse schema no Supabase. O acesso do navegador passa pela aplicação.

Crie seu usuário administrativo no Supabase Auth. No SQL Editor, autorize o UUID exato desse usuário:

```sql
insert into app.admins(user_id)
values ('UUID_DO_USUARIO_SUPABASE_AUTH');
```

Somente usuários dessa lista entram no painel. Não há cadastro público nem permissão administrativa automática. A sessão expira de acordo com o access token do Supabase; entre novamente quando solicitado.

## 2. Ambiente

Preencha no ambiente do EasyPanel as variáveis listadas em `.env.example`:

| Variável | Finalidade |
| --- | --- |
| `NODE_ENV=production` | Ativa as proteções de produção. |
| `APP_URL` | URL pública canônica, com HTTPS e sem barra final. |
| `DATABASE_URL` | Conexão PostgreSQL do Supabase. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Autenticação administrativa. |
| `ENCRYPTION_KEY` | Chave hexadecimal de 32 bytes para criptografar credenciais. |
| `META_GRAPH_VERSION` | Versão suportada pela sua aplicação Meta, no formato `vN.N`. |
| `RESEND_API_KEY`, `RESEND_FROM` | Chave e remetente com domínio verificado no Resend. |
| Instruções de pagamento | Configure por cliente em **Financeiro → E-mails de cobrança**. |
| `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` | Instância Evolution v2 destinada aos avisos nos grupos. |
| `DEMO_MODE=false` | Em produção o modo de demonstração é recusado. |
| `WORKER_CONCURRENCY=16` | Máximo de envios simultâneos por processo worker. |

Gere a chave de criptografia em um terminal seguro com `openssl rand -hex 32`. Guarde uma cópia segura. Alterá-la depois de cadastrar clientes torna os segredos anteriores ilegíveis; uma rotação exige recriptografar os registros.

A mesma `APP_URL` deve ser usada para abrir a aplicação. As gravações rejeitam origens diferentes. Não configure segredos como variáveis `VITE_*`: variáveis com esse prefixo podem ser incluídas no JavaScript público.

## 3. Dois serviços App

Use o `Dockerfile` incluído e a mesma versão do código nos dois serviços.

| Serviço | Comando | Porta pública |
| --- | --- | --- |
| `diagchat-web` | `node build/server/index.js` | Encaminhe o domínio HTTPS à porta interna 3000. |
| `diagchat-worker` | `node build/server/worker.js` | Nenhuma. |

Configure as variáveis em ambos. As migrações são executadas automaticamente antes de iniciar o atendimento ou o worker. O worker usa reinício automático e deve receber tempo de encerramento suficiente para aguardar requisições em voo, por exemplo 40 segundos.

A imagem final executa como usuário `node`. O web oferece `GET /api/health` para verificação de banco. Não use `npm run demo` em serviços de produção.

O `compose.yaml` também está disponível para uma implantação com Docker Compose. A porta publicada fica em loopback para receber tráfego de um proxy HTTPS na VPS. Não execute simultaneamente as duas estratégias para a mesma aplicação.

## 4. Meta por cliente

No cadastro, informe WABA ID, Phone Number ID, token com permissões adequadas, App Secret e velocidade autorizada pela Meta. Depois de salvar, a aba de WhatsApp do cadastro mostra:

- Callback: `APP_URL/api/webhook/UUID_DO_CLIENTE`.
- Verify Token: valor individual gerado pelo sistema.

Cadastre o callback e o Verify Token na Meta, assine o campo `messages` e confirme a assinatura do aplicativo na WABA. Quando várias WABAs compartilham o mesmo aplicativo, use o override de callback por WABA oferecido pela Meta (`override_callback_uri` e `verify_token` em `/{WABA-ID}/subscribed_apps`), em vez de substituir repetidamente o único callback padrão do aplicativo.

O callback confere a assinatura do corpo bruto e os identificadores WABA/Phone ID. O worker reconcilia os status recebidos. A API deve receber o corpo sem alteração por proxies intermediários.

Templates precisam estar aprovados. A primeira versão aceita templates de texto com variáveis posicionais no corpo; mídia e componentes dinâmicos adicionais exigem extensão do adaptador. São consultados até 100 templates por WABA.

## 5. Resend e Evolution

Verifique o domínio remetente no Resend e configure `RESEND_FROM`. Em **Financeiro → E-mails de cobrança**, selecione o cliente e configure assunto, mensagem, instruções de pagamento e envio automático. As variáveis são substituídas pelos dados da fatura. O worker gera uma cobrança única por cliente ao fechar a competência; só agenda o e-mail automaticamente se a opção estiver ativada. No modo manual, use **Enviar cobrança** no dashboard financeiro. A fatura é um registro de cobrança, não emissão fiscal ou boleto. Marque como paga após confirmar o recebimento.

Conecte a instância Evolution v2, inclua-a nos grupos e preencha o JID de cada grupo no cadastro do cliente, normalmente terminado em `@g.us`. O sistema usa `POST /message/sendText/{instance}` com cabeçalho `apikey`. Somente os avisos de conclusão usam essa integração; as campanhas usam a API oficial da Meta.

## 6. Homologação

1. Faça login com o usuário administrativo autorizado.
2. Cadastre um cliente de teste com franquia pequena e destinatários que autorizaram os testes.
3. Configure o webhook e confirme o desafio GET pela Meta.
4. Importe uma planilha pequena e revise a prévia. Não envie para os números fictícios do exemplo incluído.
5. Use um template aprovado e confirme aceite, entrega e leitura.
6. Gere o portal, solicite uma campanha por ele e confira a aprovação administrativa.
7. Verifique bloqueio no limite, aviso no grupo e domínio remetente do Resend.
8. Antes de aumentar o volume, meça latência e concorrência na sua VPS. Throughput é um teto por cliente, não promessa de entrega nem aumento de limite da Meta.

## Operação e recuperação

- Status `unknown` preserva a reserva e impede reenvio automático. Aguarde o webhook e consulte o provedor. Uma competência com reservas pendentes não fecha para evitar cobrança incorreta.
- O sistema não oferece um botão de reenvio de respostas incertas. Qualquer reconciliação manual exige confirmar se o provedor aceitou a mensagem. `app.finish_message` é idempotente e deve ser usado para uma resolução confirmada, preservando o histórico.
- A outbox do Resend reutiliza uma chave de idempotência e o mesmo payload. Após 23 horas desde a primeira tentativa, não faz uma nova tentativa automática; exige revisão porque a janela do provedor é de 24 horas.
- A Evolution não oferece aqui a mesma garantia de idempotência. Em caso de resposta incerta, o aviso vai para revisão e não é repetido automaticamente.
- Monitore `app.messages` com estado `unknown` e `app.outbox` com estado `review`. A tela de configurações foi retirada a pedido; as credenciais permanecem nas variáveis de ambiente e os avisos operacionais no banco.
- Tenha backup do banco e da chave de criptografia. Os arquivos XLSX são processados em memória e os contatos normalizados ficam vinculados às campanhas. Reiniciar o worker não apaga a fila.
- O painel filtra mensagens por datas no horário de São Paulo. Valores financeiros da visão geral consideram integralmente as competências mensais abrangidas; não há rateio diário da mensalidade.

## Referências

- [EasyPanel: serviço App](https://easypanel.io/docs/services/app)
- [Supabase: conexão PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Meta: override de callback por WABA](https://www.postman.com/meta/whatsapp-business-platform/request/un84tul/override-callback-url)
- [Resend: idempotência](https://resend.com/changelog/idempotency-keys)


## Atualizar a VPS ao enviar para o GitHub

1. Em **web → Source**, selecione GitHub, repositório `RamosLucas62/diagchat`, branch `main`, Build Path `/`. Mantenha o builder Dockerfile.
2. Repita no **worker**, preservando o comando `node build/server/worker.js` e sem domínio público.
3. Na integração GitHub do EasyPanel, configure um token fine-grained limitado a esse repositório: **Metadata: Read**, **Contents: Read**, **Webhooks: Read and write**. O token é configurado no EasyPanel, nunca no código ou neste repositório público.
4. Na visão geral de **cada um** dos dois serviços, ative **Enable Auto Deploy**. Isso cria os gatilhos de push no GitHub.
5. A cada push em `main`, acompanhe o build e os logs nos dois serviços. Um build malsucedido não significa que a atualização foi publicada.

A implantação inicial ainda exige domínio, ambiente e autenticação administrativa configurados. Nenhuma configuração remota de EasyPanel foi feita por este código. Não é necessário adicionar um terceiro serviço de migração.

O `PAYMENT_INSTRUCTIONS` antigo é aceito somente como padrão de compatibilidade: na migração 002, se existir, seu valor preenche os modelos dos clientes existentes. Depois de salvar um modelo no financeiro, o valor armazenado por cliente prevalece. Não há necessidade de preencher essa variável em instalações novas.

E-mails são materializados na fila com o conteúdo da cobrança. Alterar o modelo vale para novos e-mails, sem alterar uma tentativa já iniciada nem reenviar uma cobrança já enviada. Desativar o automático pausa as mensagens automáticas pendentes; não cancela uma ação de envio manual. Reativar libera mensagens automáticas pausadas que ainda não começaram. Faturas antigas que nunca foram enfileiradas continuam disponíveis para envio manual.

Referência: [integração e permissões GitHub no EasyPanel](https://easypanel.io/docs/code-sources/github).
