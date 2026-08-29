import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Sentry: ativo somente quando VITE_SENTRY_DSN estiver definido
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.2,
    integrations: [Sentry.browserTracingIntegration()],
  });
}

// O tema já foi aplicado pelo script inline no <head> do index.html -- ele roda
// antes do primeiro paint, que é a única forma de não piscar. Aqui era tarde
// demais, e ainda por cima este bloco ADICIONAVA a classe sem remover a que já
// estava no HTML: com tema claro o documento ficava "dark light" ao mesmo tempo.

createRoot(document.getElementById("root")!).render(<App />);
