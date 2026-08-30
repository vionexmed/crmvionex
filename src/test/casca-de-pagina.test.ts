/**
 * A casca comum das páginas.
 *
 * O levantamento mediu por que a interface parece "esquisita e confusa", e a
 * causa nº 1 não é decoração: **o título muda de tamanho e de FONTE conforme a
 * tela**. `PageHeader` aparecia em 9 de 27 páginas; 16 montavam `<h1>` próprio
 * em quatro tamanhos (`text-2xl`, `text-xl sm:text-2xl`, `text-lg sm:text-xl`,
 * `text-[20px]`), herdando Nunito, enquanto o `PageHeader` usa Poppins.
 *
 * O espaçamento raiz também variava sem hierarquia: `space-y-3`, `space-y-4`,
 * `space-y-5`. Ter UM valor importa mais do que qual valor -- ritmo vertical só
 * é perceptível quando se repete.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * As cinco telas do dia a dia. A replicação nas outras 22 é a onda seguinte, e
 * esta lista cresce junto -- é o que impede a casca de virar mais um primitivo
 * construído e não usado.
 */
const COM_CASCA = [
  "src/pages/Dashboard.tsx",
  "src/pages/Contacts.tsx",
  "src/pages/Deals.tsx",
  "src/pages/Companies.tsx",
  "src/pages/Activities.tsx",
];

describe("as telas do dia a dia usam a mesma casca", () => {
  it.each(COM_CASCA)("%s monta PageShell", (arquivo) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    expect(src).toContain('from "@/components/layout/PageShell"');
    expect(src).toContain("<PageShell");
  });

  /**
   * `<h1>` solto é o que fazia o título mudar de fonte entre telas vizinhas.
   * Só o `PageHeader` deve montar um.
   */
  it.each(COM_CASCA)("%s não monta título próprio", (arquivo) => {
    expect(semComentarios(readFileSync(arquivo, "utf8"))).not.toContain("<h1");
  });

  /**
   * O wrapper raiz vinha com três valores diferentes. Agora quem decide é o
   * PageShell, e a página não repete a decisão.
   */
  it.each(COM_CASCA)("%s não decide o espaçamento raiz", (arquivo) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    expect(src).not.toMatch(/return \(\n\s*<div className="space-y-\d/);
  });

  it("o PageShell é quem fixa o ritmo vertical", () => {
    const src = readFileSync("src/components/layout/PageShell.tsx", "utf8");
    expect(src).toMatch(/cn\("space-y-4"/);
  });
});

describe("o PageHeader não carrega prop morta", () => {
  /**
   * `pattern` estava marcada no próprio código como "kept for API
   * compatibility, no longer used" -- e cinco páginas passavam valores
   * diferentes ("grid", "waves", "dots", "ticks", "diagonal") acreditando que
   * mudavam alguma coisa.
   */
  it("pattern saiu do componente", () => {
    expect(readFileSync("src/components/layout/PageHeader.tsx", "utf8")).not.toContain("pattern");
  });

  it.each([
    "src/pages/Reports.tsx",
    "src/pages/Tasks.tsx",
    "src/pages/Conversations.tsx",
    "src/pages/Activities.tsx",
    "src/pages/Companies.tsx",
  ])("%s não passa mais pattern", (arquivo) => {
    expect(readFileSync(arquivo, "utf8")).not.toMatch(/pattern="/);
  });
});

describe("Negócios usa o controle segmentado compartilhado", () => {
  const src = semComentarios(readFileSync("src/pages/Deals.tsx", "utf8"));

  /**
   * Era a quarta cópia escrita à mão do mesmo grupo de pílulas, com medidas
   * próprias e sem `aria-pressed` -- nenhuma das quatro anunciava a seleção
   * para leitor de tela.
   */
  it("monta SegmentedControl", () => {
    expect(src).toContain("<SegmentedControl<ViewMode>");
  });

  it("não sobrou grupo de pílulas à mão", () => {
    expect(src).not.toMatch(/rounded-md border border-border bg-muted\/50 p-0\.5/);
  });
});
