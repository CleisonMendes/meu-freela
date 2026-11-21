Meu Freela Dia 2.0
Sistema web para gestão de equipes freelancers, acompanhamento de operações diárias, apuração de ganhos, pagamentos, metas e relatórios.
Estado do projeto: versão funcional informada pelo autor, em preparação para publicação e uso piloto. A identificação Dia 2.0 é o nome apresentado pela aplicação; o package.json do código analisado ainda declara a versão 0.1.0.

Visão geral
O Meu Freela Dia 2.0 reúne a gestão de integrantes, lançamentos de vendas e presença, cálculos de ganhos e acompanhamento de pagamentos em uma interface web. Foi desenvolvido para apoiar uma operação real de trabalho freelancer, com possibilidade de uso compartilhado por usuários autorizados quando conectado ao Supabase.
Funcionalidades implementadas
Equipe
- Cadastro de integrantes nas funções Garçom, Caixa, Bar e Cozinha.
- Edição de nome e função; busca e filtros por situação.
- Ativação, desativação, reativação e exclusão com confirmações.
- Histórico de movimentações da equipe.
- Proteções relacionadas a integrantes com movimentações financeiras vinculadas.
Lançamento diário e fechamento
- Seleção da data da operação e registro de presença por integrante.
- Registro de vendas individuais, vendas totais da equipe e caixinhas.
- Diferenciação entre valores confirmados e estimados.
- Ajustes justificados da base de bônus.
- Prévia de cálculos, fechamento e reabertura do dia.
- Registro de eventos de fechamento/reabertura; bloqueio de reabertura quando existem pagamentos ativos vinculados.
- Fechamento com cópia dos valores e integrantes considerados naquele momento (snapshot).
Cálculo financeiro
O motor financeiro trabalha com centavos inteiros, para evitar imprecisões de cálculo com valores monetários.
- Valor fixo por diária trabalhada.
- Comissão coletiva sobre vendas.
- Bônus de garçons por faixas de vendas.
- Caixinhas individuais.
- Cálculo dos ganhos por integrante e dos totais da equipe.
- Parâmetros de cálculo armazenados no fechamento.
Os valores padrão previstos nos tipos do sistema são R$ 100,00 por diária, 10% de comissão coletiva e R$ 50,00 de bônus por faixa completa de R$ 1.000,00 em vendas. As regras aplicáveis a cada fechamento são determinadas pelas configurações utilizadas no cálculo, incluindo o critério de presença.
Pagamentos
- Controle de valores conquistados, pagos e pendentes.
- Registro de pagamentos parciais ou integrais.
- Data efetiva do pagamento, observações e histórico.
- Data prevista de pagamento por dia de serviço.
- Anulação de pagamentos com registro, sem apagamento do lançamento original.
- Indicadores e filtros para acompanhar recebimentos.
Painel e relatórios
- Visão geral de vendas e ganhos da equipe.
- Resumo de valores fixos, bônus, comissões e caixinhas.
- Filtros por período e consulta de evolução dos resultados.
- Comparação mensal e acompanhamento de metas.
- Relatórios e recursos de exportação de dados.
Autenticação e níveis de acesso
No modo conectado ao Supabase, a aplicação utiliza autenticação por e-mail e senha e três perfis:
Perfil	Responsabilidade na aplicação
Dono	Gestão geral, inclusive administração de acessos.
Gerente	Gestão operacional da equipe, lançamentos e fechamentos.
Integrante	Acesso às operações permitidas para sua conta e aos próprios lançamentos editáveis.


O projeto contém uma Supabase Edge Function (manage-access) para operações administrativas de acesso e fluxo de troca de senha.
Atenção: controles de visibilidade no frontend não substituem permissões no banco. Antes de uso com dados reais, revise as políticas de Row Level Security (RLS) do supabase/schema.sql: várias políticas de leitura atuais autorizam qualquer usuário cadastrado a consultar registros da equipe, inclusive dados financeiros.

Tecnologias
- React 19 e TypeScript — interface e tipagem.
- Vite 7 — ambiente de desenvolvimento e build.
- Tailwind CSS 4 e CSS — estilização.
- Lucide React — ícones.
- Supabase — autenticação, banco PostgreSQL e Edge Function.
- SQL / PostgreSQL — tabelas, políticas de acesso, funções e gatilhos.
Estrutura principal
meu-freela-dia-2/
├── src/
│   ├── auth/                 # Login, perfis e troca de senha
│   ├── components/           # Componentes reutilizáveis e gráficos
│   ├── features/
│   │   ├── access/           # Administração de acessos
│   │   ├── daily/            # Lançamento e fechamento diário
│   │   ├── dashboard/        # Indicadores e metas
│   │   ├── payments/         # Pagamentos
│   │   └── reports/          # Relatórios
│   ├── lib/                  # Cálculos, datas, relatórios e Supabase
│   ├── services/             # Persistência local e sincronização na nuvem
│   ├── App.tsx
│   └── main.tsx
├── supabase/
│   ├── functions/manage-access/
│   └── schema.sql
├── tests/                    # Arquivos de testes de cálculos e transformações
├── index.html
├── package.json
└── vite.config.ts
Executar localmente
Pré-requisito: Node.js e npm instalados.
npm install
npm run dev
Abra no navegador o endereço exibido pelo Vite, normalmente http://localhost:5173.
Modos de armazenamento
O projeto possui dois modos, definidos automaticamente pelas variáveis de ambiente:
- Modo local: sem configuração Supabase, utiliza localStorage no navegador; não sincroniza dados entre aparelhos.
- Modo nuvem: com as duas variáveis Supabase configuradas, usa autenticação e armazenamento no Supabase, permitindo acesso compartilhado conforme as permissões do banco.
Para ativar o modo nuvem, crie um arquivo .env.local na raiz:
VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA
Preencha com os valores do seu projeto Supabase. O arquivo .env.local não deve ser enviado ao GitHub. Nunca use uma chave service_role em variáveis VITE_ ou no frontend.
O arquivo supabase/schema.sql contém a definição das tabelas e políticas. Não execute esse SQL novamente sobre um banco existente sem revisar seu efeito, pois o arquivo inclui instruções de criação de objetos. A função supabase/functions/manage-access/ precisa estar implantada no projeto Supabase para as operações administrativas correspondentes.

Build para produção
npm run build
npm run preview
O comando de build executa a verificação TypeScript (tsc -b) e gera os arquivos estáticos na pasta dist/. O preview permite inspecionar localmente a compilação.
Publicação web
Como a aplicação é um frontend React/Vite com backend Supabase, os arquivos compilados podem ser hospedados em uma plataforma de sites estáticos, como Cloudflare Pages.

Configuração sugerida:
Configuração	Valor
Repositório	CleisonMendes/meu-freela
Branch	main
Comando de build	npm run build
Diretório publicado	dist
Variáveis de ambiente	VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY


Após publicar, ajuste Authentication → URL Configuration no Supabase com o endereço de produção e os redirects necessários ao fluxo de login utilizado.

Antes de liberar o acesso para testes no trabalho: valide as permissões de leitura e escrita no banco, confirme o funcionamento do login, utilize inicialmente dados fictícios e faça backup dos dados importantes.
Segurança e repositório
Mantenha fora do Git:
node_modules/
dist/
.env
.env.*
!.env.example
*.log
*backup*.json
*preview*.json
Se credenciais ou backups já tiverem sido incluídos em commits anteriores, adicionar .gitignore não os remove do histórico: será necessário corrigir o histórico e, se houver exposição de segredos, rotacionar as credenciais.
Testes
O repositório inclui os arquivos:
- tests/finance.test.ts
- tests/reports.test.ts
- tests/cloudmap.test.ts
Eles cobrem partes das regras financeiras, dos relatórios e do mapeamento de dados. O package.json fornecido não possui um script npm test configurado; por isso, não há um comando de testes documentado como operacional nesta versão.
Uso pretendido
Projeto desenvolvido para organizar e acompanhar atividades de trabalho freelancer. A publicação inicial é destinada a um piloto controlado, com usuários autorizados, antes de ampliar a utilização com dados reais.
Autoria
Cleison Mendes
GitHub: @CleisonMendes
Repositório: CleisonMendes/meu-freela
