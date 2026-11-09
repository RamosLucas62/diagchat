# DiagChat

Central administrativa de campanhas via WhatsApp Cloud API, portal exclusivo por cliente, importação XLSX e fechamento financeiro. Interface em português, inspirada na referência fornecida, com tema escuro e verde.

## Executar a demonstração

Requer Node.js 22 e npm.

```sh
npm ci
npm run demo
```

Abra http://127.0.0.1:5173. A demonstração usa PostgreSQL em memória via PGlite, com registros fictícios. Cadastro, importação, solicitações e financeiro funcionam nesse banco temporário. Não inicia o worker, não chama Meta, Resend ou Evolution, e não aceita segredos reais. Reiniciar o servidor restaura os exemplos. `DEMO_MODE=true` é recusado em produção.

Planilha fictícia para experimentar: `public/exemplo-importacao.xlsx` (duas abas, cabeçalho na linha 8, duplicata e telefone inválido). Nunca use esses contatos de teste em envios reais.

## Implementado

- Dashboard: clientes ativos, aceites no mês, média diária, faturamento previsto, custo e lucro estimados. Filtros por cliente e data (mês atual, 7/30/90 dias, último ano ou período personalizado de até 366 dias), aceites, falhas e exportação CSV. As métricas operacionais respeitam os dias selecionados; o financeiro considera as competências mensais incluídas.
- Clientes em cards com busca e rolagem interna: nome, foto, e-mail financeiro, WABA ID, Phone Number ID, token, App Secret, grupo Evolution, throughput, plano, mensalidade, franquia, política de excedente, tarifa em reais, custo unitário e vencimento.
- Webhook `APP_URL/api/webhook/:clientId`, com verificação GET e HMAC SHA-256 sobre o corpo bruto no POST; filtro de WABA e Phone ID; caixa de entrada durável e deduplicada.
- Portal no endereço `APP_URL/nome_do_cliente`, com slug estável e único; o link compartilhado contém uma chave no fragmento, removida da barra após abrir. Solicitações recebem nome automático `Cliente | DD.MM.AA | NN` por data agendada de São Paulo; escolha de template opcional por cliente e padrão definido pela equipe. Portal com token aleatório de 256 bits no fragmento do link; só o hash fica no banco. Token enviado ao servidor por cabeçalho, sem exposição em logs de URL. Novos links têm chaves próprias e coexistem com os anteriores, para várias pessoas do mesmo cliente. Todos respeitam a ativação da conta. Portal sem credenciais Meta ou dados de outros clientes.
- Importação automática de XLSX por perfil do cliente: cabeçalho até a linha 500, reconhecimento automático de telefone e variáveis pelo contexto de cada template, texto fixo e formatação, roteamento por coluna ou escolha no formulário, datas por aba/coluna e agrupamento de procedimentos. O cliente não faz associações de colunas; ambiguidades ficam na revisão administrativa. Guia: [docs/IMPORTACAO.md](docs/IMPORTACAO.md).
- Lotes independentes por aba, template e data. Importações são reprocessadas no servidor e criadas de forma atômica e idempotente. Planilhas válidas entram direto na fila ao enviar o formulário, sem checkbox ou aprovação manual. O administrador pode pausar, retomar e cancelar campanhas.
- Templates aprovados da Meta com variáveis posicionais de texto no corpo. Componentes dinâmicos de mídia, cabeçalho, URL, Flow e código de oferta não são suportados nesta versão.
- Fila PostgreSQL com reserva de cota atômica e espaçamento por cliente, inclusive com múltiplos workers. Throughput cadastrado é teto, não garantia de capacidade: o volume real depende de latência, concorrência, VPS e limites Meta.
- Aceite conta uma vez; rejeição explícita antes do aceite libera reserva; timeout/HTTP 5xx vira envio incerto sem reenvio automático. Webhook pode reconciliar a resposta tardia.
- Supressão de contatos que responderem SAIR, PARAR, STOP ou CANCELAR.
- Financeiro com submenu expansível: dashboard e e-mails de cobrança. Modelo por cliente com assunto, corpo, instruções de pagamento, variáveis clicáveis e prévia. Envio automático opcional por cliente e envio manual por cobrança.
- Login administrativo via magic link do Supabase, com PKCE, sessão de 30 dias em cookie HttpOnly, renovação automática e autorização pela lista de administradores. Tokens do provedor ficam criptografados no banco privado.
- Relatório PDF mensal anexo à cobrança: imagem das métricas, franquia, consumo e discriminação de mensalidade, excedentes e total. NF e boleto em espera.
- Fechamento mensal automático e cobrança pelo Resend; outbox persistente e idempotência. Confirmação de pagamento manual, sem gateway de pagamento.
- Relatório de conclusão pela Evolution v2 no grupo do cliente: data/hora de São Paulo, campanha, total de contatos, aceites, falhas, franquia, consumo, reservas, saldo real e renovação. Cancelados e excedentes aparecem quando existem; alerta com 10% ou menos disponível, respeitando a política de bloqueio ou adicional.

## Regras financeiras e de operação

Ciclo por mês de calendário, em `America/Sao_Paulo`. A mensagem entra no ciclo em que a tentativa foi reservada; só é contabilizada após aceite. Planos com bloqueio usam aceitos + reservas em voo. Excedentes são `max(0, aceitos − franquia) × tarifa`; o total é arredondado para centavos no fechamento. A franquia pode ser ajustada imediatamente no mês atual, preservando o consumo e os meses fechados. Nome do plano, mensalidade e tarifa ficam congelados no ciclo; alterações nesses campos valem no mês seguinte; política de bloqueio, velocidade e custo unitário mudam imediatamente. Não há pró-rata na primeira mensalidade.

Faturamento do dashboard é previsão de cobrança, não caixa recebido. Custo e lucro são estimativas pelo custo cadastrado por envio; não são conciliação da fatura da Meta. Valores em reais são armazenados como `numeric` no PostgreSQL, sem cálculo monetário de ponto flutuante na cobrança.

Solicitações com limite atingido ficam bloqueadas na fila até renovar o mês ou mudar a política. Pausar/cancelar não interrompe uma requisição já enviada à Meta. Linhas exatamente iguais são removidas na importação. Agrupamento depende do perfil; o mesmo telefone com mensagens distintas é preservado em campanhas separadas.

E-mails e avisos são processados pelo worker, independentemente de alguém estar com o painel aberto. O portal consulta os dados a cada 10 segundos e ao recuperar o foco. Links são capacidades de acesso: quem possui o link pode ver o portal e solicitar campanhas; a aprovação administrativa evita início automático pelo cliente.

## Atualizações automáticas

Os serviços web e worker aplicam as migrações pendentes ao iniciar, com bloqueio no PostgreSQL para impedir execução duplicada. Ative **Enable Auto Deploy** nos dois serviços EasyPanel, usando a origem GitHub `RamosLucas62/diagchat`, branch `main`. A integração GitHub precisa de acesso a conteúdo e metadados (leitura) e webhooks (leitura e escrita) para configurar o gatilho. Consulte [docs/DEPLOY.md](docs/DEPLOY.md).

## Instalar em produção

Siga [docs/DEPLOY.md](docs/DEPLOY.md). São necessários projeto Supabase, domínio com HTTPS, VPS/EasyPanel, conta Resend e instância Evolution. Configure os segredos diretamente no ambiente do servidor; nunca os publique no repositório.

```sh
cp .env.example .env
# Preencha as variáveis no ambiente local seguro ou no EasyPanel.
npm run migrate
npm run build
npm start
# Outro processo/container:
npm run worker
```

## Verificação

```sh
npm test
npm run build
# Integração local, sem envios reais:
node --import tsx tests/imports.integration.ts
```

Testes cobrem importação, criptografia, assinatura, reserva de franquia, idempotência de aceite, falhas incertas, bloqueio e excedentes, agendamento/pausa/opt-out, fechamento, outbox e reconciliação de eventos fora de ordem. Testes usam PGlite e provedores simulados; não substituem um envio de homologação com suas contas conectadas nem um teste de carga na VPS.

## Limites desta entrega

- Integrações externas dependem das credenciais e configuração real. Nenhum domínio, banco remoto ou conta externa foi criado automaticamente.
- Nenhum disparo real foi realizado. Primeiro valide um template com destinatário autorizado de teste.
- Upload até 10 MB, descompactação declarada até 60 MB, 31 abas visíveis, 50 mil linhas por aba / 100 mil linhas por arquivo, 50 mil contatos por campanha. Arquivos maiores devem ser divididos. A detecção é assistida; ambiguidades exigem revisão humana.
- Respostas incertas não são reenviadas automaticamente. Consulte o guia operacional antes de reconciliar manualmente.
- Resend envia a cobrança; emissão fiscal, boleto, PIX automático e baixa bancária dependem de um gateway ainda não definido.
- Templates são consultados em até 100 registros na primeira versão. Consulte o guia para paginação e formatos futuros.

## Pós-pago, juros e histórico de erros

O consumo de cada competência é fechado e cobrado no mês seguinte, no dia de vencimento do cliente. Em **Clientes → Plano & cobrança**, configure juros simples por atraso: percentual por dia ou percentual mensal proporcional aos dias, com base de 30 dias. Zero desativa juros. A taxa fica congelada na emissão de cada fatura; alterar o cliente vale para faturas futuras e não muda faturas antigas. Não há multa fixa nem juros compostos. O painel mostra principal, dias de atraso, juros e total atualizado. Marcar como pago congela o total e a data; repetir a ação não altera o pagamento. Faturas existentes começam sem juros. O PDF mensal preserva os dados e o total original da competência; e-mails usam o saldo atualizado no momento de entrar na fila, mantendo o conteúdo estável nas tentativas de reenvio.

**Histórico de erros** é exclusivo da equipe: descrição, horário de São Paulo, origem, operação e referências de cliente/campanha quando disponíveis. Filtre por origem e situação e marque como resolvido após corrigir a causa. Registra falhas HTTP, importações com pendências, Meta, worker, Resend, Evolution e eventos da interface. Credenciais são ocultadas; planilhas e corpos completos das requisições não são incluídos. Se o banco estiver indisponível, há fallback estruturado nos logs do serviço. Não envia avisos externos.

Reimplante **web e worker** no EasyPanel para aplicar esta versão. A migração `007_operations_and_interest.sql` é automática na inicialização, sem novas variáveis de ambiente. O worker continua necessário para disparos e fechamento mensal. Campanhas antigas pendentes não são liberadas automaticamente pela atualização.

A versão com múltiplos links usa a migração automática `008_multiple_portal_links.sql`. Reimplante o **web** no EasyPanel; não há novas variáveis. O link ativo anterior é preservado. Links que já foram substituídos e invalidados em versões antigas não podem ser recuperados porque suas chaves não eram armazenadas; gere novos links para essas pessoas.

Os relatórios de conclusão no grupo são consolidados por solicitação de disparo, somando todos os lotes e templates, após o último lote terminar. A migração automática `009_campaign_report_groups.sql` mantém o vínculo mesmo após expirar o arquivo enviado. Reimplante **web e worker** juntos para que novas solicitações recebam o vínculo e o worker emita somente o relatório consolidado. Sem novas variáveis de ambiente.

## Asaas — boleto, NFS-e e conciliação

A migração `010_asaas.sql` é automática. Reimplante **web e worker** com as mesmas variáveis:

- `ASAAS_ENVIRONMENT=sandbox` para homologação ou `production` para cobranças reais.
- `ASAAS_API_KEY`: chave da conta no respectivo ambiente, somente no servidor.
- `ASAAS_WEBHOOK_TOKEN`: token independente da chave, com 32–255 caracteres, igual ao token cadastrado manualmente no webhook Asaas.
- `ASAAS_DOCUMENT_HOSTS`: opcional, lista de domínios HTTPS exatos adicionais caso os PDFs retornados pela API utilizem hospedagem fora de `*.asaas.com`. Downloads têm limite de 8 MB por documento e não enviam a chave da API.

Cadastre o pagador **manualmente no Asaas**, com dados fiscais e endereço completos. Copie o ID `cus_…` para **Clientes → Plano & cobrança → ID do pagador no Asaas**. A aplicação não cadastra pagadores e não provisiona chaves nem configurações de webhook na conta Asaas.

Configure sua empresa para emissão de NFS-e no Asaas. Em **Financeiro → Asaas → Configurar emissão automática**, salve o código/nome do serviço, descrição, observações e impostos e ative a integração. O Portal Nacional utiliza `municipalServiceCode`. As alíquotas iniciais zeradas são campos a conferir, não uma determinação tributária. Esses dados são enviados em cada NFS-e e ficam congelados na fatura. Desativar a criação impede novos POSTs; consultas e conciliação de registros existentes continuam funcionando. Revise no Asaas as notificações próprias de cobrança/NF para evitar e-mails duplicados, já que o DiagChat envia os documentos pelo Resend.

Cadastre manualmente no Asaas o webhook **POST `https://SEU_DOMINIO/api/webhooks/asaas`**, API v3, com o mesmo `ASAAS_WEBHOOK_TOKEN`. Eventos recomendados:

- `PAYMENT_CREATED`, `PAYMENT_UPDATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_DUNNING_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED`, `PAYMENT_RESTORED`;
- `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_REFUND_IN_PROGRESS`, `PAYMENT_RECEIVED_IN_CASH_UNDONE`, `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`;
- `INVOICE_CREATED`, `INVOICE_UPDATED`, `INVOICE_AUTHORIZED`, `INVOICE_ERROR`, `INVOICE_CANCELED`, `INVOICE_PROCESSING_CANCELLATION`, `INVOICE_CANCELLATION_DENIED`.

O receptor valida `asaas-access-token`, grava apenas identificadores antes de responder HTTP 200 e ignora eventos repetidos pelo ID. O worker consulta o recurso na API autenticada para obter valores, status e URLs confiáveis; o corpo do webhook não dá baixa diretamente. Eventos fora de ordem não fazem o pagamento regredir, porque a consulta usa o estado atual. Há reconciliação diária de documentos prontos e consulta a cada 30 minutos enquanto aguarda autorização, para recuperar notificações perdidas.

No fechamento pós-pago, uma cobrança Asaas é criada com `POST /v3/payments` (`BOLETO`) e referência `diagchat/ID_DA_FATURA`. Uma NFS-e é criada com `POST /v3/invoices`, vinculada pelo campo `payment`, com o principal original e `updatePayment:false`. O worker aguarda `AUTHORIZED`, baixa boleto e nota e o Resend envia **três PDFs**: relatório mensal, boleto e NFS-e. Se o cliente pagar antes da autorização da nota, o e-mail ainda envia os documentos e informa que não deve pagar novamente. O XML fica referenciado no registro privado da integração.

Juros contratuais são enviados na base mensal proporcional a 30 dias: uma taxa diária é multiplicada por 30. O Asaas limita os juros a 10% ao mês; taxas acima disso ficam em revisão, sem alteração silenciosa. O painel mantém a estimativa contratual, enquanto a baixa registra o valor efetivamente retornado pelo Asaas. O provedor também aplica suas regras de vencimento em dias não úteis. Não somamos os juros novamente ao principal enviado ao Asaas.

`PAYMENT_CONFIRMED` registra pagamento confirmado; `PAYMENT_RECEIVED` registra também a disponibilidade na conta. São preservados bruto pago, líquido após tarifas, data de pagamento do cliente e estornos. Estorno total, parcial e disputa têm estados próprios e não disparam nova cobrança automaticamente. Faturas gerenciadas pelo Asaas não podem ser marcadas como pagas pelo botão manual.

Erros ficam em **Histórico de erros → Financeiro · Asaas** e na própria fatura. **Sincronizar Asaas** consulta os registros pela referência antes de criar. Em timeout ou execução interrompida, nunca repete cegamente um POST: se a criação anterior não puder ser localizada, mantém revisão para conferência no Asaas. Notas já criadas em `ERROR` precisam ser corrigidas no Asaas antes da sincronização; editar o padrão fiscal não altera notas já emitidas. Cobranças antigas já enviadas não são recriadas automaticamente.

Rotas administrativas:

- `GET/PUT /api/finance/asaas-settings` — padrão fiscal, ativação e indicadores de configuração, sem devolver segredos;
- `POST /api/finance/:id/asaas-sync` — reconciliar a fatura;
- `GET /api/finance/:id/asaas-documents/boleto` e `/nf` — PDFs privados, somente para administradores.

As rotas financeiras não são acessíveis pelos links do portal do cliente. Testes locais simulam o Asaas e o Resend; valide a configuração fiscal e os documentos no Sandbox antes de ativar cobranças reais.

### Falhas de linhas na importação

Telefones inválidos e horários ausentes ou inválidos não colocam a solicitação em revisão: os contatos válidos entram na fila e as outras linhas são contadas como falhas. Em **Disparos → campanha → Falhas da planilha**, equipe e cliente podem consultar aba, linha original, motivo e horário do registro, com rolagem e paginação. Esses registros permanecem após a expiração do XLSX e não consomem franquia. Também entram nas métricas, no relatório consolidado do grupo e no resumo mensal. Problemas de configuração ou associações ambíguas continuam em revisão. Solicitações antigas podem ser revalidadas pelo botão **Revalidar e iniciar**.

Esta atualização exige a migração `011_import_failures.sql` antes de executar a nova versão do web e do worker; o início do serviço aplica as migrações pendentes.
