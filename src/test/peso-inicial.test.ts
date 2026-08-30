/**
 * O que a tela de login baixa.
 *
 * Eram 1,32 MB (370 KB comprimidos) para exibir um formulário de e-mail e
 * senha — porque `AppLayout` importava estaticamente o copiloto de IA, a paleta
 * de comandos e o wizard de onboarding, e porque o `manualChunks` jogava todo
 * pacote sem regra própria dentro de `vendor`, que é pré-carregado inteiro.
 *
 * Cinco bibliotecas de UM ou DOIS importadores respondiam por 87% do vendor:
 * validação de telefone (156 KB), renderizador de markdown (117 KB), paleta de
 * comandos (44 KB), sanitizador de HTML (26 KB) e confete (11 KB). Nenhuma é
 * usada na tela de login.
 *
 * Este teste lê a configuração, não o build: rodar `vite build` dentro do teste
 * levaria segundos e tornaria a suíte lenta o bastante para alguém desligá-la.
 * O que ele guarda é a REGRA — se a separação sumir do config, o peso volta.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const VITE = readFileSync("vite.config.ts", "utf8");
const LAYOUT = readFileSync("src/components/layout/AppLayout.tsx", "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("as bibliotecas pesadas têm chunk próprio", () => {
  /**
   * Sem regra própria elas caem no catch-all `vendor`, e o vendor é
   * pré-carregado na entrada — então a tela de login baixa todas.
   */
  const pesadas: [string, string][] = [
    ["libphonenumber", "telefone"],
    ["react-markdown", "markdown"],
    ["/cmdk", "paleta"],
    ["dompurify", "sanitizador"],
    ["canvas-confetti", "confete"],
    ["date-fns", "datas"],
  ];

  it.each(pesadas)("%s vai para o chunk %s", (pacote, chunk) => {
    // Sem janela de proximidade: a regra do markdown tem vinte condições
    // encadeadas antes do `return`, e exigir vizinhança falharia por formatação
    // em vez de por comportamento.
    const iPacote = VITE.indexOf(`id.includes("${pacote}")`);
    const iChunk = VITE.indexOf(`return "${chunk}"`);
    expect(iPacote, `regra para ${pacote} não encontrada`).toBeGreaterThan(-1);
    expect(iChunk, `chunk ${chunk} não encontrado`).toBeGreaterThan(-1);
    expect(iPacote).toBeLessThan(iChunk);
  });

  /**
   * O markdown arrasta um pipeline inteiro (micromark, mdast, hast, unified…).
   * Separar só o pacote de entrada deixaria as dependências no vendor, e o
   * ganho seria quase nenhum.
   */
  it("o pipeline do markdown acompanha o pacote", () => {
    for (const dep of ["/micromark", "/mdast", "/hast", "/unified"]) {
      expect(VITE).toContain(`id.includes("${dep}")`);
    }
  });

  /**
   * A regra específica tem de vir ANTES do `return "vendor"`, senão o catch-all
   * reivindica primeiro e a separação não acontece.
   */
  it("as regras vêm antes do catch-all", () => {
    expect(VITE.indexOf('return "telefone"')).toBeLessThan(VITE.indexOf('return "vendor"'));
    expect(VITE.indexOf('return "markdown"')).toBeLessThan(VITE.indexOf('return "vendor"'));
  });
});

describe("as sobreposições globais não entram no primeiro acesso", () => {
  /**
   * `AppLayout` monta as três em toda página autenticada, e importá-las
   * estaticamente colocava o grafo inteiro no pacote da entrada — inclusive na
   * tela de login, onde nenhuma delas existe.
   */
  const adiadas = ["CommandPalette", "AICopilot", "OnboardingModal"];

  it.each(adiadas)("%s é carregado sob demanda", (nome) => {
    const codigo = semComentarios(LAYOUT);
    expect(codigo).toMatch(new RegExp(`const ${nome} = lazy\\(`));
    expect(codigo).not.toMatch(new RegExp(`^import \\{ ${nome} \\}`, "m"));
  });

  it("há Suspense em volta", () => {
    expect(semComentarios(LAYOUT)).toContain("<Suspense");
  });

  /**
   * A paleta só existe depois do ⌘K. Montá-la sempre, mesmo fechada, faria o
   * cmdk ser baixado no primeiro acesso apesar do lazy.
   */
  it("a paleta só monta depois de aberta", () => {
    expect(semComentarios(LAYOUT)).toMatch(/\{searchOpen && <CommandPalette/);
  });
});

describe("as dependências mortas não voltam", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const todas = { ...pkg.dependencies, ...pkg.devDependencies };

  // Removidas por terem ZERO importadores — não por preferência.
  it.each([
    "sonner",
    "@dnd-kit/sortable",
    "@dnd-kit/utilities",
    "@types/dompurify",
    "lovable-tagger",
    "@playwright/test",
  ])("%s continua fora", (nome) => {
    expect(todas).not.toHaveProperty(nome);
  });
});

describe("as fontes pedem só os pesos usados", () => {
  const HTML = readFileSync("index.html", "utf8");

  /**
   * O `<link>` do Google Fonts é BLOQUEANTE de renderização: cada peso a mais é
   * uma requisição a mais no caminho crítico. Eram 12 pedidos e 8 usados.
   */
  it("Nunito não pede o peso 300", () => {
    expect(HTML).toMatch(/Nunito:wght@400;500;600;700/);
  });

  it("Poppins pede só semibold e bold", () => {
    // Os 12 usos de font-heading resolvem em 600 ou 700, e h1–h4 herdam bold.
    expect(HTML).toMatch(/Poppins:wght@600;700/);
  });

  it("JetBrains não pede o peso 600", () => {
    expect(HTML).toMatch(/JetBrains\+Mono:wght@400;500(&|")/);
  });
});
