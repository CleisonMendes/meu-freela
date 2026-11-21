# Meu Freela 2.1 — Instalação como aplicativo (PWA)

## Arquivos

- `index.html` — **SUBSTITUIR** na raiz ao lado de `package.json`.
- `src/main.tsx` — **SUBSTITUIR**. Se tiver outras mudanças locais, acrescente somente o import e a chamada de `registerPwa()` ao seu arquivo atual.
- `src/pwa/register.ts` — **NOVO**.
- `public/manifest.webmanifest` — **NOVO**.
- `public/sw.js` — **NOVO**.
- `public/offline.html` — **NOVO**.
- `public/icons/icon-192.png` — **NOVO**.
- `public/icons/icon-512.png` — **NOVO**.
- `public/icons/icon-maskable-512.png` — **NOVO**.

## Teste

1. Copie todos os arquivos nos caminhos acima.
2. Execute `npm run build`.
3. Execute `npm run preview` (PWA só registra seu service worker na versão compilada).
4. Abra o URL local informado, normalmente `http://localhost:4173`.
5. Inspecione Chrome DevTools > Application > Manifest e Service Workers.
6. No Chrome/Edge, use o ícone de instalação da barra de endereço, se oferecido. Em Android, use Instalar aplicativo/Adicionar à tela inicial; no iOS Safari, Compartilhar > Adicionar à Tela de Início.

## Restrições de segurança

- **Não usa armazenamento offline para pagamentos, tokens ou dados de usuários.** O service worker só guarda recursos estáticos imutáveis e uma página de aviso de ausência de conexão.
- **Não é possível consultar/confirmar pagamentos sem internet.** Evita sincronização financeira indevida.
- Nenhum SQL, alteração no Supabase ou mudança de dependências é necessário.
- Não publique para `main` / Vercel de produção até concluir os testes.
- Ao abrir em aba normal `npm run dev` (porta 5173), o registro do worker não é feito. Se já tinha um worker antigo no mesmo domínio, remova-o pelo DevTools.
