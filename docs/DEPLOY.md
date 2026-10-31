# Instalação no EasyPanel

A aplicação tem dois processos: `web` atende o painel/portal/webhooks; `worker` executa a fila, fecha ciclos e envia cobranças e avisos. Ambos usam o mesmo PostgreSQL do Supabase. O painel funciona sem Redis.

## 1. Supabase

Crie o projeto e copie a string de conexão PostgreSQL. Para uma VPS persistente, use conexão direta ou pooler em modo **session**. A disponibilidade de IPv4 depende da opção escolhida. Use TLS na conexão e a configuração de certificado recomendada pelo Supabase. Não adicione `rejectUnauthorized: false` ao código.

Copie também a URL do projeto e sua chave pública/anon para as variáveis do servidor. Não é necessário expor a service role no frontend.

Execute a migração uma única vez após configurar o ambiente:

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
| `PAYMENT_INSTRUCTIONS` | Instruções de pagamento incluídas nas cobranças. |
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

Configure as variáveis em ambos. Execute a migração antes de iniciar os serviços. O worker usa reinício automático e deve receber tempo de encerramento suficiente para aguardar requisições em voo, por exemplo 40 segundos.

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

Verifique o domínio remetente no Resend e configure `RESEND_FROM`. Ao fechar uma competência sem reservas pendentes, o worker gera uma cobrança única por cliente e agenda o e-mail. A fatura é um registro de cobrança, não emissão fiscal ou boleto. Marque como paga após confirmar o recebimento.

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
