# DiagChat

Central administrativa de campanhas via WhatsApp Cloud API, portal exclusivo por cliente, importação XLSX e fechamento financeiro. Interface em português, inspirada na referência fornecida, com tema escuro e verde.

## Executar a demonstração

Requer Node.js 22 e npm.

```sh
npm ci
npm run demo
```

Abra http://127.0.0.1:5173. A demonstração usa PostgreSQL em memória via PGlite, com registros fictícios. Cadastro, importação, solicitações, aprovações e financeiro funcionam nesse banco temporário. Não inicia o worker, não chama Meta, Resend ou Evolution, e não aceita segredos reais. Reiniciar o servidor restaura os exemplos. `DEMO_MODE=true` é recusado em produção.

Planilha fictícia para experimentar: `public/exemplo-importacao.xlsx` (duas abas, cabeçalho na linha 8, duplicata e telefone inválido). Nunca use esses contatos de teste em envios reais.

## Implementado

- Dashboard: clientes ativos, aceites no mês, média diária, faturamento previsto, custo e lucro estimados. Filtros por cliente e data (mês atual, 7/30/90 dias, último ano ou período personalizado de até 366 dias), aceites, falhas e exportação CSV. As métricas operacionais respeitam os dias selecionados; o financeiro considera as competências mensais incluídas.
- Clientes em cards com busca e rolagem interna: nome, foto, e-mail financeiro, WABA ID, Phone Number ID, token, App Secret, grupo Evolution, throughput, plano, mensalidade, franquia, política de excedente, tarifa em reais, custo unitário e vencimento.
- Webhook `APP_URL/api/webhook/:clientId`, com verificação GET e HMAC SHA-256 sobre o corpo bruto no POST; filtro de WABA e Phone ID; caixa de entrada durável e deduplicada.
- Portal no endereço `APP_URL/nome_do_cliente`, com slug estável e único; o link compartilhado contém uma chave no fragmento, removida da barra após abrir. Solicitações recebem nome automático `Cliente | DD.MM.AA | NN` por data agendada de São Paulo; escolha de template opcional por cliente e padrão definido pela equipe. Portal com token aleatório de 256 bits no fragmento do link; só o hash fica no banco. Token enviado ao servidor por cabeçalho, sem exposição em logs de URL. Rotação revoga o link anterior. Portal sem credenciais Meta ou dados de outros clientes.
- Importação de XLSX com múltiplas abas, detecção de cabeçalho nas primeiras 100 linhas e correção manual, escolha de telefone em colunas ambíguas, normalização internacional/BR, remoção de duplicatas por aba, prévia e mapeamento de variáveis.
- Uma campanha por aba selecionada, com agendamento independente. Portal solicita e administrador aprova; administrador pode pausar, retomar e cancelar pendentes.
- Templates aprovados da Meta com variáveis posicionais de texto no corpo. Componentes dinâmicos de mídia, cabeçalho, URL, Flow e código de oferta não são suportados nesta versão.
- Fila PostgreSQL com reserva de cota atômica e espaçamento por cliente, inclusive com múltiplos workers. Throughput cadastrado é teto, não garantia de capacidade: o volume real depende de latência, concorrência, VPS e limites Meta.
- Aceite conta uma vez; rejeição explícita antes do aceite libera reserva; timeout/HTTP 5xx vira envio incerto sem reenvio automático. Webhook pode reconciliar a resposta tardia.
- Supressão de contatos que responderem SAIR, PARAR, STOP ou CANCELAR.
- Financeiro com submenu expansível: dashboard e e-mails de cobrança. Modelo por cliente com assunto, corpo, instruções de pagamento, variáveis clicáveis e prévia. Envio automático opcional por cliente e envio manual por cobrança.
- Login administrativo via magic link do Supabase, com PKCE, sessão de 30 dias em cookie HttpOnly, renovação automática e autorização pela lista de administradores. Tokens do provedor ficam criptografados no banco privado.
- Relatório PDF mensal anexo à cobrança: imagem das métricas, franquia, consumo e discriminação de mensalidade, excedentes e total. NF e boleto em espera.
- Fechamento mensal automático e cobrança pelo Resend; outbox persistente e idempotência. Confirmação de pagamento manual, sem gateway de pagamento.
- Resumo de conclusão pela Evolution v2 no grupo do cliente com aceitos, falhas de envio, cancelados, consumo e saldo. Entregas/leituras podem continuar chegando depois.

## Regras financeiras e de operação

Ciclo por mês de calendário, em `America/Sao_Paulo`. A mensagem entra no ciclo em que a tentativa foi reservada; só é contabilizada após aceite. Planos com bloqueio usam aceitos + reservas em voo. Excedentes são `max(0, aceitos − franquia) × tarifa`; o total é arredondado para centavos no fechamento. A franquia pode ser ajustada imediatamente no mês atual, preservando o consumo e os meses fechados. Nome do plano, mensalidade e tarifa ficam congelados no ciclo; alterações nesses campos valem no mês seguinte; política de bloqueio, velocidade e custo unitário mudam imediatamente. Não há pró-rata na primeira mensalidade.

Faturamento do dashboard é previsão de cobrança, não caixa recebido. Custo e lucro são estimativas pelo custo cadastrado por envio; não são conciliação da fatura da Meta. Valores em reais são armazenados como `numeric` no PostgreSQL, sem cálculo monetário de ponto flutuante na cobrança.

Solicitações com limite atingido ficam bloqueadas na fila até renovar o mês ou mudar a política. Pausar/cancelar não interrompe uma requisição já enviada à Meta. Telefones duplicados são removidos dentro de cada campanha, mas podem participar de abas/dias diferentes.

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
```

Testes cobrem importação, criptografia, assinatura, reserva de franquia, idempotência de aceite, falhas incertas, bloqueio e excedentes, agendamento/pausa/opt-out, fechamento, outbox e reconciliação de eventos fora de ordem. Testes usam PGlite e provedores simulados; não substituem um envio de homologação com suas contas conectadas nem um teste de carga na VPS.

## Limites desta entrega

- Integrações externas dependem das credenciais e configuração real. Nenhum domínio, banco remoto ou conta externa foi criado automaticamente.
- Nenhum disparo real foi realizado. Primeiro valide um template com destinatário autorizado de teste.
- Upload até 10 MB, descompactação declarada até 60 MB, 31 abas visíveis, 50 mil linhas por aba / 100 mil linhas por arquivo, 50 mil contatos por campanha. Arquivos maiores devem ser divididos. A detecção é assistida; ambiguidades exigem revisão humana.
- Respostas incertas não são reenviadas automaticamente. Consulte o guia operacional antes de reconciliar manualmente.
- Resend envia a cobrança; emissão fiscal, boleto, PIX automático e baixa bancária dependem de um gateway ainda não definido.
- Templates são consultados em até 100 registros na primeira versão. Consulte o guia para paginação e formatos futuros.
