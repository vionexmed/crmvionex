import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    // `node` por padrão, `jsdom` só onde o arquivo pedir.
    //
    // Montar um DOM inteiro custa por ARQUIVO, e dos 30 arquivos de teste
    // apenas 3 tocam em DOM -- os outros 27 leem código-fonte ou exercitam
    // função pura. Quem precisa declara no topo do próprio arquivo:
    //
    //     // @vitest-environment jsdom
    //
    // que é local e visível, ao contrário de uma lista de globs no config que
    // ninguém lembra de atualizar.
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // `client.ts` chama `createClient` no topo do módulo, que LANÇA se a URL
    // vier vazia. Qualquer teste que importe (mesmo indiretamente, via um
    // hook) morria na coleta com "supabaseUrl is required" -- a suíte só
    // passava em quem tivesse um `.env` local, nunca em clone limpo nem em CI.
    //
    // Valores de fachada: nenhum teste vai à rede, só precisam ser aceitos
    // pelo validador de URL do supabase-js.
    env: {
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "chave-de-teste",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
