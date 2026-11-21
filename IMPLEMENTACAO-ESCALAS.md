# Meu Freela 2.1 — Escalas (primeiro módulo)

Esta entrega foi preparada com base no ZIP `meu-freela-dia-2.zip` enviado anteriormente. **Não alterei seu repositório GitHub nem o Supabase.** O ZIP da entrega contém somente os arquivos novos/alterados. **Não execute a migração diretamente no banco de produção.**

## Incluído
- `supabase/migrations/202611210001_schedule.sql`: tabelas `shift_templates`, `member_availability`, `shift_assignments`; políticas de acesso por perfil; detecção de escala sobreposta para o mesmo integrante, inclusive turnos que cruzam meia-noite.
- `src/features/schedule/Schedule.tsx`: tela com disponibilidade, criação de modelos, confirmação/cancelamento da escala e consulta individual do integrante.
- `src/features/schedule/schedule.css`: estilos do módulo.
- `src/App.tsx`: item **Escalas** adicionado ao menu.

## Implantação segura
1. Em seu VS Code, confira que a branch `main` está atualizada e crie `git switch -c feat/escala-trabalho`.
2. Extraia o ZIP no projeto, preservando a estrutura de pastas. Verifique o diff de `src/App.tsx`, pois ele foi preparado a partir da cópia que você enviou.
3. **Crie um projeto Supabase de testes separado** (com schema base e usuários fictícios) e execute nele a migração `202611210001_schedule.sql` pelo SQL Editor. Não aplique novamente o `schema.sql` no projeto de produção.
4. Em um arquivo `.env.local` apenas no computador, use a URL e a chave pública `anon` do Supabase de testes. Nunca envie esse arquivo ao GitHub.
5. Execute `npm install` (se preciso), `npm run build` e `npm run dev`. Este ambiente de preparação não conseguiu concluir a verificação final de build porque as dependências não estavam disponíveis para instalação; faça a validação no seu computador antes de qualquer publicação.
6. Faça testes com `owner`, `manager` e `member` em contas separadas; teste conflito entre escalas, turnos atravessando a meia-noite e restrição de leitura dos registros alheios.
7. Somente após os testes, planeje a migração em produção com backup e revisão das políticas RLS existentes. Não faça merge da branch até ter revisado o resultado.

## Limites desta primeira versão
- Aplicação ainda é de **um estabelecimento**. A migração para múltiplos estabelecimentos exigirá isolamento (`establishment_id`) em todas as tabelas e revisão de RLS.
- A disponibilidade é consultiva: a gerência pode confirmar escala fora dela com alerta, sem bloqueio.
- Não são enviados notificações ou lembretes, nem se registra presença/horas trabalhadas.
- O gerente pode cancelar a escala; não existe edição completa de uma escala confirmada (cancelar e criar outra).
- A regra de sobreposição de disponibilidade informada não está restrita no banco; a proteção é aplicada às escalas oficiais.
- Horários são locais do estabelecimento; uma futura versão com várias cidades precisará tratar fuso horário por estabelecimento.
- As políticas financeiras existentes não são alteradas por esta entrega e **ainda devem ser revisadas antes do uso real**.
