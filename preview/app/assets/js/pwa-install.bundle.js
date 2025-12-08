// Lightweight fallback for pwa-install. Handles beforeinstallprompt and exposes a prompt() API.
(() => {
  let deferredPrompt = null;
  const readyCallbacks = [];

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    readyCallbacks.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error("pwa-install callback error", err);
      }
    });
  });

  const api = {
    prompt() {
      if (!deferredPrompt) {
        return Promise.reject(new Error("Install prompt not available"));
      }
      const evt = deferredPrompt;
      deferredPrompt = null;
      evt.prompt();
      return evt.userChoice;
    },
    onReady(cb) {
      if (typeof cb === "function") readyCallbacks.push(cb);
    },
  };

  if (!window.pwaInstall) {
    window.pwaInstall = api;
  }

  if (!customElements.get("pwa-install")) {
    customElements.define(
      "pwa-install",
      class extends HTMLElement {
        connectedCallback() {
          this.style.display = "none";
        }
      }
    );
  }
})();
