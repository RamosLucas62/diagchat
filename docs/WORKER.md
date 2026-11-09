# Auditoria e otimização do polling de disparos

## Causa encontrada

Antes desta atualização, `server/worker.ts` executava um ciclo com `sleep(10)`. A cada ciclo com vaga em `WORKER_CONCURRENCY`, iniciava `dispatchOne()` e descartava seu retorno booleano. Uma fila vazia terminava rapidamente e liberava a vaga para outra tentativa 10 ms depois. Erros nessa tarefa eram registrados sem backoff. O máximo teórico era aproximadamente 100 chamadas de `app.claim_message()` por segundo por processo, ou 8,64 milhões por dia, sujeito à latência do banco, capacidade e manutenção. O total acumulado de 58.475.502 chamadas informado pelo usuário é compatível com esse comportamento, mas não determina quantos processos estavam ativos nem o período de coleta.

O repositório define **um serviço `worker`** em `compose.yaml`; o guia EasyPanel também define um serviço. `WORKER_CONCURRENCY` tem padrão 16, limite 100 e representa tarefas de envio simultâneas por processo, não 16 loops independentes. Antes, essas tarefas também podiam sobrepor chamadas de reserva quando o banco demorava mais de 10 ms. Não foi acessado o servidor de produção para contar réplicas, processos adicionais ou outros consumidores no Supabase.

## Todos os pontos de chamada no repositório

- Produção: `server/jobs.ts`, chamada SQL agora concentrada em `claimMessage()`. Antes ficava dentro de `dispatchOne()`.
- Consumidor de produção: `server/worker.ts` → `runDispatchLoop()` → `claimMessage()`. A API web, o portal, manutenção, financeiro e webhooks não chamam essa função.
- `dispatchOne()` permanece como adaptador de uma única tentativa, sem loop e sem consumidores de produção após esta alteração.
- Testes: `tests/queue.test.ts` chama diretamente a função no helper `claim()` e no teste de throughput; `tests/jobs.test.ts` chama diretamente no cenário de reconciliação de webhook. `tests/worker-queue.test.ts` usa `claimMessage()` em um banco PGlite temporário.
- `supabase/migrations/001_initial.sql` **define** a função. Não é um processo de polling. Não foram alteradas funções, migrações ou regras financeiras.

## Comportamento novo

Um produtor por processo reserva mensagens de forma serial. Envios e finalizações continuam concorrentes até `WORKER_CONCURRENCY`, com espera por uma tarefa terminar quando os slots estão cheios. Cada mensagem reservada segue uma única vez para o envio; o polling não repete a entrega de um objeto já reservado.

- Quando não há mensagens elegíveis ou futuras em campanhas ativas: espera 5 segundos. Novas campanhas podem levar até aproximadamente 5 segundos para serem percebidas.
- Quando `claim_message()` retorna vazio, uma consulta **somente de leitura** verifica o próximo `next_dispatch_at`/`scheduled_at` de campanhas com mensagens na fila. Isso distingue ociosidade de um slot de throughput que estará disponível em milissegundos. Não consulta a dica após reservas bem-sucedidas.
- Para um slot futuro: aguarda até o horário indicado, no máximo 5 segundos por verificação. Não há espera ociosa de 5 segundos entre mensagens de uma campanha ativa. A função SQL continua sendo a autoridade de velocidade, agendamento, saldo, bloqueio, opt-out e reserva atômica. A capacidade efetiva depende também da latência do banco/Meta e dos slots configurados.
- Se há fila aparentemente pronta, mas a reserva não encontra trabalho, a espera sobe de 10 a 500 ms para reduzir contenção entre processos. Uma reserva bem-sucedida reinicia essa espera. Todos os caminhos têm espera ou aguardam uma operação em andamento.
- Erros de banco, disponibilidade ou finalização e respostas temporárias da Meta (429, 408, 5xx, timeout ou resposta sem confirmação) interrompem **novas reservas** com backoff de 1, 2, 4, 8, 16 e 30 segundos, limitado a 30. Reservas já em andamento são concluídas normalmente. Sucesso de uma consulta de reserva não mascara erros persistentes de finalização.
- Não há retry automático de envio: a classificação anterior `accepted`/`failed`/`unknown` e `finish_message()` foram preservadas. Um erro ao persistir finalização deixa a mensagem reservada para a recuperação já existente; uma resposta incerta aguarda reconciliação, sem voltar para `queued`.
- SIGTERM/SIGINT interrompe as esperas e impede novas reservas. Uma reserva que já começou é entregue/finalizada; o processo aguarda tarefas em voo antes de fechar o pool.
- Manutenção/notificações (15 s) e Asaas (5 s) têm ciclos separados, seriais e sem sobreposição consigo mesmos. Uma espera ociosa ou um provedor lento não bloqueia o polling da outra fila. Seus erros também têm espera limitada a 30 s, mantendo as operações de negócio existentes.

## Métricas e comparação

O worker registra JSON no stdout ao iniciar (`worker_started`), a cada 60 segundos e ao encerrar (`worker_queue_metrics`). São contadores cumulativos por execução. `instance_id`, `host`, PID e horário identificam a instância; reiniciar cria um novo identificador e zera contadores.

- `database_calls.claim`, `.availability`, `.finish`: tentativas das três operações SQL da fila, inclusive as que falham. `queue_database_calls` soma essas operações; não inclui consultas de manutenção, financeiro, logs de erros ou da aplicação web.
- `messages_found`: reservas retornadas pelo banco. `empty_claims`: reservas sem mensagem.
- `dispatch_completed`: entregas com resultado persistido, inclusive falhas permanentes; não equivale a aceite pela Meta. `claim_errors` inclui erros da consulta de disponibilidade; `dispatch_errors` inclui erros temporários de provedor e erros de finalização.
- `idle_periods`/`idle_ms`: quantidade de esperas e tempo efetivamente passado em espera de fila vazia. Esperas de throughput/agendamento não entram como ociosidade.
- `backoff_periods`/`backoff_ms`: esperas por erro e tempo efetivo. `in_flight`/`max_in_flight`: entregas em andamento e máximo observado.

Em teste com relógio controlado, um minuto de fila vazia fez **12 chamadas de reserva e 12 consultas de disponibilidade**, independentemente de 16 slots. Comparado ao teto anterior de 6.000 reservas/minuto, são 99,8% menos chamadas à função; contando a dica de disponibilidade, 99,6% menos consultas de polling. Estes são resultados de teste, não medições de produção.

Para validar em produção, atualize o serviço worker e confira os eventos por `instance_id` numa mesma janela de tempo. Mantenha uma réplica inicialmente e verifique se há serviços antigos/duplicados; não execute EasyPanel e Compose simultaneamente para a mesma implantação. Compare os deltas dos contadores e das estatísticas PostgreSQL em janelas iguais, sem interpretar o total histórico como taxa atual. Não é necessário resetar estatísticas ou aplicar migrações para esta atualização.
