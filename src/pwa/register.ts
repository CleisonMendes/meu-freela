/** Registra o Service Worker apenas na versão compilada (nunca durante o Vite dev). */
export function registerPwa(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .then((registration) => {
        // Procura atualizações ao abrir a aplicação, sem recarregar formulários em andamento.
        void registration.update().catch((error: unknown) => {
          console.warn("Não foi possível verificar a atualização do PWA:", error);
        });
      })
      .catch((error: unknown) => {
        console.warn("Não foi possível registrar o PWA:", error);
      });
  }, { once: true });
}
