# Planilhas e disparos

O cliente envia somente a planilha e, se habilitado no perfil, escolhe a mensagem. O servidor interpreta o arquivo original usando regras administrativas, monta as variáveis e cria campanhas pendentes para aprovação. O cliente não associa variáveis, corrige cabeçalhos ou escolhe colunas.

## Configuração inicial

Em **Clientes → Editar → Planilhas e disparos**, configure e salve o perfil de cada cliente. Uma planilha de exemplo e o texto de cada template ajudam a definir o significado das variáveis. `{{1}}`, por exemplo, não informa por si só se o conteúdo é nome, data ou endereço; essa semântica deve ser cadastrada pela equipe.

1. **Escolha da mensagem:** template fixo, escolha no formulário ou roteamento por coluna. No roteamento, cadastre os nomes possíveis da coluna e a correspondência entre cada valor e o template aprovado. Valores desconhecidos viram pendências.
2. **Cabeçalho:** automático nas primeiras 500 linhas ou linha fixa. Logotipos, títulos e linhas vazias acima da tabela não são tratados como dados. Cabeçalhos equivalentes podem aparecer novamente no arquivo; se houver estruturas diferentes igualmente prováveis, a leitura fica para revisão.
3. **Colunas:** cadastre nomes equivalentes separados por `|`. São ignoradas diferenças de acento, maiúsculas/minúsculas e espaços repetidos. A posição da coluna não importa. Mais de uma coluna candidata exige revisão, sem escolha arbitrária.
4. **Variáveis por template:** escolha coluna ou texto fixo e o formato: texto completo, primeiro nome, data brasileira, horário ou reunir valores ao agrupar. Todas as variáveis exigidas devem ter origem configurada. Se o texto ou as variáveis do template mudarem na Meta após salvar o perfil, a equipe precisa conferir e salvar novamente.
5. **Datas:** após aprovação, data de cada aba ou coluna de data. Datas aceitas: `DD/MM/AAAA`, `DD.MM.AAAA`, `DD-MM-AAAA` e `AAAA-MM-DD`; abas também aceitam esses trechos dentro do nome. Anos com dois dígitos representam 2000–2099. Abas sem ano exigem um ano explícito no perfil. Configure hora no fuso `America/Sao_Paulo` e antecedência em dias. Datas de atendimento usadas nas mensagens são independentes da data de disparo. Datas de disparo passadas exigem revisão, salvo quando a equipe habilita expressamente enviar após aprovação.
6. **Repetições:** por padrão são removidas somente linhas completamente iguais dentro da mesma aba, mantendo compromissos diferentes. Para juntar exames, habilite agrupamento e defina identificadores como data e local. Telefone, template, data de disparo, nome completo detectado e demais variáveis não agrupáveis também precisam coincidir. Somente as variáveis marcadas para reunir valores serão concatenadas. Não há junção entre abas diferentes.

Use **Testar planilha** para salvar o perfil e conferir a leitura. O teste não cria campanhas. A equipe pode selecionar colunas detectadas no teste como nomes equivalentes de cada variável.

## Solicitação e revisão

No portal, o cliente envia XLSX, recebe um resumo por aba/template/data e confirma a autorização dos contatos. Se houver qualquer pendência, nenhuma campanha é criada; a solicitação aparece em **Disparos → Importações e pendências** para a equipe.

A equipe pode baixar o arquivo original, corrigir o cabeçalho e o nome da coluna de telefone por aba, excluir explicitamente linhas com problema e reprocessar. Opcionalmente, as correções de estrutura são salvas por nome exato de aba no perfil. Para abas cujo nome muda diariamente, prefira aliases e cabeçalho automático ou uma linha fixa global no perfil. Reprocessar também aplica as últimas alterações feitas na configuração das variáveis.

Quando a leitura fica sem pendências, crie as campanhas para aprovação. Cada combinação de aba, template e data forma um lote. Se o mesmo telefone tiver mensagens diferentes no mesmo lote, ele é separado em campanhas distintas; os dados não são descartados pela restrição de telefone único de cada campanha. O limite é de 250 lotes por importação, com até 50 mil contatos por lote.

A criação de todas as campanhas ocorre em uma transação. Repetir a solicitação ou receber duas confirmações simultâneas não cria campanhas em duplicidade. Alterações concorrentes de perfil ou correções do arquivo exigem atualização antes de concluir. As campanhas registram a origem por aba e linha nas mensagens; o worker envia os valores já resolvidos, sem interpretar a planilha.

A aprovação e o funcionamento do worker continuam necessários. Salvar ou testar um perfil não faz envios reais. A antiga criação de campanhas com destinatários enviados diretamente pelo navegador foi desabilitada para o portal.

## Arquivos e limites

Os arquivos originais e os planos de importação ficam no schema privado `app`, sem links públicos de armazenamento. O portal recebe apenas seu próprio resumo; download do original, regras e reprocessamento exigem acesso administrativo. Arquivos de importação expiram em sete dias e são removidos pela manutenção do worker. Campanhas já criadas permanecem, com suas mensagens e referências de origem.

Continuam os limites de 10 MB por XLSX, 60 MB após descompactar, 31 abas, 50 mil linhas por aba e 100 mil linhas por arquivo. Fórmulas não são executadas nem usadas como valores de contatos ou variáveis. Linhas com telefone inválido ou variável obrigatória ausente geram pendências. Por resposta são exibidas até mil pendências; após resolvê-las e reprocessar, outras pendências podem aparecer.

Clientes existentes recebem um perfil inicial a partir do modo anterior, mas as origens das variáveis precisam ser configuradas pela equipe antes da primeira importação automática. Nenhuma configuração clínica ou significado de variável é inventado a partir de um exemplo fictício. Os perfis prontos da demonstração usam exclusivamente dados de teste.
