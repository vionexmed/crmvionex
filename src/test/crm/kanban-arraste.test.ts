/**
 * O que um redesenho visual quebra sem aparecer em captura de tela.
 *
 * Mexer na aparência do kanban significa reescrever o JSX em volta do dnd-kit, e
 * as coisas que se perdem nesse processo não deixam rastro visual: o card
 * continua bonito e simplesmente não arrasta, ou arrasta e abre o negócio ao
 * soltar, ou o clone se desloca para o lado.
 *
 * Estes testes não julgam o visual -- isso só se verifica olhando. Eles travam
 * os contratos que o visual não revela.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const KANBAN = "src/components/crm/DealsKanban.tsx";
const src = readFileSync(KANBAN, "utf8");

/** Sem comentários: eles citam justamente o que não se deve fazer. */
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const codigo = semComentarios(src);

describe("o card continua arrastável", () => {
  /**
   * `{...attributes}` do useDraggable injeta role="button", tabIndex e
   * aria-roledescription. Remover o spread mata o arraste por teclado inteiro e
   * o foco do card -- e nada na tela muda.
   */
  it("espalha attributes e listeners no elemento raiz", () => {
    expect(codigo).toContain("{...attributes}");
    expect(codigo).toContain("{...listeners}");
    expect(codigo).toContain("ref={setNodeRef}");
  });

  /**
   * A ordem importa: `{...listeners}` já traz um onPointerDown, e o explícito
   * tem de vir DEPOIS para substituí-lo e rechamá-lo à mão. Invertido, a guarda
   * de arraste nunca reseta.
   */
  it("o onPointerDown explícito vem depois dos spreads", () => {
    const i = codigo.indexOf("{...listeners}");
    const j = codigo.indexOf("onPointerDown={(e) => {", i);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(codigo.slice(j, j + 200)).toContain("listeners?.onPointerDown?.(e)");
  });

  /**
   * Sem esta guarda, soltar um card conta como clique e abre o negócio que você
   * acabou de mover.
   */
  it("mantém a guarda que separa clique de arraste", () => {
    expect(codigo).toContain("arrastou.current = false");
    expect(codigo).toMatch(/if \(isDragging\) arrastou\.current = true/);
  });

  /**
   * O clone é o DragOverlay. Aplicar transform no card original fazia DOIS
   * cards se moverem ao mesmo tempo.
   */
  it("o card original só muda opacidade, nunca transform", () => {
    const bloco = codigo.slice(codigo.indexOf("function DealCard("));
    expect(bloco).toContain("opacity: 0.4");
    expect(bloco).not.toMatch(/isDragging \?[^}]*transform/);
  });
});

describe("as zonas de soltar continuam identificáveis", () => {
  // handleDragEnd compara por STRING: um id renomeado no JSX não dá erro de
  // tipo, só para de marcar ganho/perdido.
  it.each(["won-drop", "lost-drop"])("%s existe", (id) => {
    expect(codigo).toContain(`"${id}"`);
  });

  it("handleDragEnd trata os dois", () => {
    expect(codigo).toContain('overId === "won-drop"');
    expect(codigo).toContain('overId === "lost-drop"');
  });

  it("a coluna é droppable pelo id da etapa", () => {
    expect(codigo).toContain("useDroppable({ id: stage.id })");
  });
});

describe("os sensores mantêm as restrições de ativação", () => {
  /**
   * `distance: 8` é o que permite clicar sem iniciar arraste. O `delay: 200` do
   * toque é o que permite rolar a página no celular em vez de arrastar o card.
   * Perder qualquer um deles torna o quadro inutilizável no dispositivo
   * correspondente -- e nenhum dos dois aparece numa captura de tela.
   */
  it("ponteiro exige 8px de deslocamento", () => {
    expect(codigo).toMatch(/PointerSensor,\s*\{\s*activationConstraint:\s*\{\s*distance:\s*8/);
  });

  it("toque exige 200ms de pressão", () => {
    expect(codigo).toMatch(/TouchSensor,\s*\{\s*activationConstraint:\s*\{\s*delay:\s*200,\s*tolerance:\s*8/);
  });

  it("teclado continua registrado", () => {
    expect(codigo).toContain("KeyboardSensor");
  });

  it("a detecção de colisão continua closestCenter", () => {
    expect(codigo).toContain("collisionDetection={closestCenter}");
  });
});

describe("a armadilha do transform", () => {
  /**
   * `.vx-page` no <main> anima `transform`, e um ancestral com transform vira
   * bloco de contenção para position:fixed -- o DragOverlay passa a se
   * posicionar em relação ao <main> e "foge do cursor" pela largura da sidebar.
   * Já aconteceu neste projeto e custou três correções erradas.
   *
   * O portal é a proteção direta. A ausência de transform nos wrappers é a
   * indireta, e é o que este teste guarda: `scale-105` numa drop zone bastaria
   * para o bug voltar.
   */
  it("o DragOverlay vai para o body por portal", () => {
    expect(codigo).toContain("createPortal(");
    expect(codigo).toContain("document.body");
  });

  it("nenhum wrapper usa transform, scale, filter ou backdrop", () => {
    // `\bfilter\b` foi a primeira tentativa e reprovou por `deals.filter(...)`
    // -- método de array, não classe CSS. O que interessa são as utilidades
    // Tailwind que geram um filtro de verdade, e `filter:` em style inline.
    expect(codigo).not.toMatch(/\bscale-\d/);
    expect(codigo).not.toMatch(/\brotate-\d/);
    expect(codigo).not.toMatch(/\btranslate-[xy]-/);
    expect(codigo).not.toMatch(/\bbackdrop-(blur|filter)/);
    expect(codigo).not.toMatch(/\bblur-(sm|md|lg|xl|none|\[)/);
    expect(codigo).not.toMatch(/filter:\s*['"`]/);
    expect(codigo).not.toMatch(/transform:\s*['"`]/);
  });
});

describe("quadro e clone mostram o mesmo card", () => {
  /**
   * O overlay era um card próprio, simplificado, com largura fixa `w-[220px]`
   * que já estava dessincronizada de `sm:w-[240px]`. Você pegava um card com
   * empresa, probabilidade e responsável, e arrastava outro com título e valor.
   */
  it("existe um componente visual compartilhado", () => {
    expect(codigo).toContain("function DealCardVisual(");
  });

  it("o card do quadro o usa", () => {
    const bloco = codigo.slice(codigo.indexOf("function DealCard("));
    expect(bloco).toContain("<DealCardVisual");
  });

  it("o overlay o usa", () => {
    const bloco = codigo.slice(codigo.indexOf("createPortal("));
    expect(bloco).toContain("<DealCardVisual");
  });

  it("a largura do clone acompanha a da coluna", () => {
    // Os dois valores têm de casar, senão o clone tem tamanho diferente do card.
    expect(codigo).toContain("w-[264px] sm:w-[280px]");
    const ocorrencias = codigo.match(/w-\[264px\] sm:w-\[280px\]/g) ?? [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2);
  });
});

describe("o clique no nome da pessoa não vaza para o card", () => {
  /**
   * Sem o stopPropagation no pointerdown o dnd-kit captura o gesto e o clique
   * nunca chega; sem o do click, ele sobe para o card e o painel abre ao mesmo
   * tempo que a rota muda.
   */
  it("para a propagação nos dois eventos", () => {
    const i = codigo.indexOf("onContactClick(deal.contact!)");
    expect(i).toBeGreaterThan(-1);
    const volta = codigo.slice(Math.max(0, i - 400), i + 200);
    expect(volta).toContain("e.stopPropagation()");
    expect(volta).toContain("onPointerDown={(e) => e.stopPropagation()}");
  });
});

describe("a cor da etapa continua vindo do banco", () => {
  it("o card usa stage.color na borda", () => {
    expect(codigo).toContain("borderLeftColor: stageColor");
  });

  it("o cabeçalho da coluna usa stage.color", () => {
    expect(codigo).toContain("backgroundColor: stage.color");
  });

  /**
   * A cor de destaque é trocável em tempo de execução (ThemeContext sobrescreve
   * --primary). Teal fixo quebraria a escolha do usuário, e os hex --vx-* não
   * têm valores para o tema escuro.
   */
  it("o fallback é o token, não um teal fixo", () => {
    expect(codigo).toContain('"hsl(var(--primary))"');
    expect(codigo).not.toMatch(/#00[0-9a-f]{4}/i);
    expect(codigo).not.toContain("var(--vx-");
  });
});

describe("o CSS órfão foi removido", () => {
  const css = readFileSync("src/index.css", "utf8");

  it("vx-deal-card não é mais uma regra", () => {
    // Metade do card vinha do CSS e metade do Tailwind no JSX: mexer na
    // aparência exigia editar dois arquivos e lembrar qual ganhava.
    expect(semComentarios(css)).not.toContain(".vx-deal-card");
    expect(codigo).not.toContain("vx-deal-card");
  });
});
