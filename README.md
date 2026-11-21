# Meu Freela Dia 2.0

Aplicação inicial para organizar equipe, freelas, vendas, ganhos e pagamentos.

## Requisitos

- Windows 10 ou 11
- Node.js LTS (recomendado)
- Visual Studio Code

## Como executar

1. Extraia o ZIP para uma pasta, por exemplo `C:\Projetos\meu-freela-dia-2`.
2. Abra essa pasta no VS Code.
3. No terminal do VS Code, execute:

```powershell
node -v
npm -v
npm install
npm run dev
```

4. Abra no navegador o endereço local exibido pelo Vite (normalmente `http://localhost:5173`).

## O que já existe nesta primeira base

- React + TypeScript + Vite.
- Tailwind CSS 4 configurado pelo plugin do Vite.
- Navegação inicial.
- Cadastro de integrantes com as funções Garçom, Caixa, Bar e Cozinha.
- Ativação/desativação lógica de integrantes.
- Persistência local no navegador (`localStorage`).
- Exportação de backup JSON.
- Nenhuma venda, pagamento ou ganho fictício é criado.

## Importante sobre os dados

Nesta etapa, os dados ficam no navegador e no perfil do Windows em que o app for aberto. Limpar os dados do site ou trocar de navegador/perfil pode apagar ou ocultar os cadastros. Use **Exportar backup** para guardar uma cópia. Ainda não existe sincronização em nuvem.

## Próximas etapas

1. Completar edição e histórico de equipe.
2. Implementar presença diária e lançamentos de vendas.
3. Implementar o motor financeiro usando centavos inteiros.
4. Implementar pagamentos, metas, dashboard e relatórios.
5. Criar adaptador Supabase sem acoplar regras financeiras à interface.


## Gestão da equipe - versão 0.2.0

- Edição de nome e função.
- Filtros de ativos, inativos e todos.
- Busca por nome.
- Desativação e reativação com confirmação.
- Exclusão definitiva com confirmação.
- Histórico local de alterações, cadastros, ativações e exclusões.
- Compatibilidade com os cadastros existentes no `localStorage` (mesma chave e versão de dados).

**Atenção:** a exclusão definitiva está disponível nesta etapa porque ainda não existem lançamentos financeiros vinculados no aplicativo. Depois que vendas, pagamentos e fechamentos forem implantados, o sistema deverá bloquear a exclusão de integrantes com movimentações e oferecer arquivamento no lugar.
