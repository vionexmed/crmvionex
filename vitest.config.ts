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
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
