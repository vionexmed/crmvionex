import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl = env.VITE_SUPABASE_URL || "https://kschuwekbrrwmhzinsrv.supabase.co";
  const supabasePublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzY2h1d2VrYnJyd21oemluc3J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNTczODIsImV4cCI6MjA5NTYzMzM4Mn0.WdcNw7VhHzlXCDEMkgvVbgzUpmFyji2dGVmBSf6hkfQ";
  const supabaseProjectId = env.VITE_SUPABASE_PROJECT_ID || "kschuwekbrrwmhzinsrv";

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: { overlay: false },
    },
    plugins: [react()],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabasePublishableKey),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(supabaseProjectId),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      // Blindagem 1 — uma cópia só, sempre.
      // Se qualquer dependência transitiva trouxer a própria versão destas
      // libs, o contexto do React/Router/Query passa a ser registrado numa
      // instância e lido de outra. Os sintomas são sempre de contexto perdido:
      //   "null is not an object (evaluating 'dispatcher.useContext')"
      //   "No QueryClient set, use QueryClientProvider to set one"
      //   "useNavigate() may be used only in the context of a <Router>"
      dedupe: ["react", "react-dom", "react-router-dom", "@tanstack/react-query"],
    },

    // Blindagem 2 — pré-empacotar tudo que é compartilhado, de uma vez.
    // As páginas entram por import() dinâmico, então o Vite ia descobrindo
    // dependência nova a cada navegação e RE-OTIMIZANDO no meio da sessão.
    // A cada re-otimização o hash `?v=` muda: a aba já aberta continua com os
    // módulos antigos e mistura com os novos — duas cópias vivas ao mesmo
    // tempo. Declarando aqui, a descoberta acontece no arranque e o hash não
    // muda mais durante o uso.
    optimizeDeps: {
      include: [
      // Import estático do main.tsx. Fora da lista, o Vite o descobria em
      // tempo de execução, re-otimizava e trocava o hash `?v=` — dois React na
      // mesma sessão, que é o que estoura `dispatcher` nulo.
      "@sentry/react",
        "react",
        "react-dom",
        "react-dom/client",
        "react-router-dom",
        "@tanstack/react-query",
        "@supabase/supabase-js",
        "lucide-react",
        "date-fns",
        "date-fns/locale",
        "cmdk",
        "react-markdown",
        "canvas-confetti",
        "libphonenumber-js",
        "dompurify",
        "class-variance-authority",
        "clsx",
        "tailwind-merge",
        "@dnd-kit/core",
        // Radix: cada primitivo é um pacote, e cada um descoberto tarde
        // dispara uma re-otimização.
        "@radix-ui/react-avatar", "@radix-ui/react-checkbox", "@radix-ui/react-dialog",
        "@radix-ui/react-dropdown-menu", "@radix-ui/react-hover-card", "@radix-ui/react-label",
        "@radix-ui/react-popover",
        "@radix-ui/react-progress", "@radix-ui/react-scroll-area", "@radix-ui/react-select",
        "@radix-ui/react-separator", "@radix-ui/react-slot", "@radix-ui/react-switch",
        "@radix-ui/react-tabs", "@radix-ui/react-toast", "@radix-ui/react-tooltip",
      ],
    },
    build: {
      rollupOptions: {
        output: {
          // Divide as libs pesadas em chunks próprios (cacheáveis entre deploys)
          // — o chunk principal caía tudo junto e passava de 880KB
          // Formato de FUNÇÃO, não de objeto. O formato de objeto só casa com o
          // id exato do módulo, e por isso não alcançava as cópias de
          // interoperabilidade CJS que o recharts embute (o shim do
          // use-sync-external-store). Resultado: o chunk do radix importava do
          // chunk do recharts, e QUALQUER página com uma aba ou um diálogo
          // baixava os 394 kB de gráfico. Era o que anulava, na prática, a
          // saída do recharts do painel.
          manualChunks(id) {
            if (!id.includes("node_modules")) return;

            // Compartilhados primeiro: quem os reivindica define o acoplamento.
            // clsx/tailwind-merge/cva são usados por TODO componente de UI (via
            // `cn`). Sem reivindicá-los aqui, o Rollup os deixava no chunk do
            // recharts e a ENTRADA passava a importar de lá — carregando 392 kB
            // de gráfico em toda visita, inclusive no login.
            if (/node_modules\/(clsx|tailwind-merge|class-variance-authority)\//.test(id)) return "shared";


            // React em chunk próprio garante a ordem de execução pelo grafo —
            // sem isso, um chunk dependente rodava antes de o React inicializar
            // e qualquer hook estourava com "dispatcher is null".
            // use-sync-external-store e react-is ficam JUNTO do React, não num
            // chunk aparte. O shim faz `const ur = React.useState` no escopo do
            // módulo — leitura imediata, na hora de carregar. Separado em outro
            // chunk, ele executava antes do React inicializar e a produção
            // subia em branco com "Cannot read properties of undefined
            // (reading 'useState')". Shim de React pertence ao chunk do React.
            if (/node_modules\/(react|react-dom|scheduler|react-is|use-sync-external-store)\//.test(id)) return "react";
            // react-router NÃO entra no chunk do React. Ele depende de
            // @remix-run/router, que caía no `vendor`, e isso fazia o chunk do
            // React importar do vendor — fechando o ciclo react → vendor →
            // radix → react. Com ciclo, o radix executava antes do React e a
            // produção subia em branco com `forwardRef` de undefined.
            // O chunk do React precisa ser FOLHA: não importa nada.
            if (id.includes("react-router") || id.includes("@remix-run")) return "router";

            // A regra do recharts saiu junto com a biblioteca. `d3-*` e
            // `victory-vendor` vinham só como dependências dela; se algum dia
            // voltarem por outro caminho, caem no `vendor` e aparecem na
            // medição do build.
            if (id.includes("@supabase")) return "supabase";
            if (id.includes("@radix-ui")) return "radix";
            if (id.includes("@sentry")) return "sentry";
            if (id.includes("@dnd-kit")) return "dnd";
            if (id.includes("@tanstack")) return "query";

            // Bibliotecas PESADAS de consumidor único, cada uma no próprio
            // chunk.
            //
            // Todas caíam no `vendor`, e o `vendor` é pré-carregado inteiro na
            // entrada -- então a tela de LOGIN baixava validação de telefone,
            // renderizador de markdown, paleta de comandos, sanitizador de HTML
            // e confete. Nenhum deles é usado ali.
            //
            // Separadas, o navegador só as busca quando o módulo que as importa
            // é carregado. Medido: libphonenumber 156 KB, react-markdown 117 KB,
            // cmdk 44 KB, dompurify 26 KB, canvas-confetti 11 KB -- 87% do
            // vendor em cinco pacotes com um ou dois importadores cada.
            if (id.includes("libphonenumber")) return "telefone";
            // Leitor de xlsx: UM importador, e dinâmico. Sem regra própria ele
            // cai no catch-all `vendor`, que é pré-carregado na entrada -- e a
            // tela de login passa a baixar um parser de planilha. Medido: 19 kB
            // comprimidos indo para dentro do vendor.
            //
            // As DEPENDÊNCIAS dela acompanham, e não é detalhe: separar só o
            // pacote de entrada deixou 5,2 kB comprimidos no vendor -- medido.
            // Mesmo caso do pipeline do markdown, logo abaixo.
            if (
              id.includes("read-excel-file") ||
              id.includes("/fflate") ||
              id.includes("/saxen") ||
              id.includes("unzipper-esm") ||
              id.includes("/worker-f")
            ) return "planilha";
            if (
              id.includes("react-markdown") ||
              id.includes("/micromark") ||
              id.includes("/mdast") ||
              id.includes("/hast") ||
              id.includes("/unist") ||
              id.includes("/remark") ||
              id.includes("/unified") ||
              id.includes("/vfile") ||
              id.includes("/bail") ||
              id.includes("/trough") ||
              id.includes("/decode-named-character-reference") ||
              id.includes("/character-entities") ||
              id.includes("/property-information") ||
              id.includes("/space-separated-tokens") ||
              id.includes("/comma-separated-tokens") ||
              id.includes("/html-url-attributes") ||
              id.includes("/devlop") ||
              id.includes("/zwitch") ||
              id.includes("/longest-streak") ||
              id.includes("/ccount") ||
              id.includes("/escape-string-regexp") ||
              id.includes("/markdown-table") ||
              id.includes("/estree")
            ) {
              return "markdown";
            }
            if (id.includes("/cmdk")) return "paleta";
            if (id.includes("dompurify")) return "sanitizador";
            if (id.includes("canvas-confetti")) return "confete";
            if (id.includes("date-fns")) return "datas";

            // Resto do node_modules num chunk só. Sem esta linha eu devolvia
            // `undefined` e o Rollup decidia sozinho onde pôr cada módulo
            // compartilhado — e às vezes decidia pelo chunk do recharts, o que
            // fazia a ENTRADA importar de lá e baixar 392 kB de gráfico em toda
            // visita. Reivindicar tudo remove a decisão do acaso.
            return "vendor";
          },
        },
      },
    },
  };
});
