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
    // Já esteve dessincronizado: o overlay tinha w-[220px] fixo enquanto a
    // coluna já ia a sm:w-[240px].
    // Cada largura tem de aparecer duas vezes: uma na coluna, uma no clone.
    expect((codigo.match(/w-\[288px\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((codigo.match(/w-\[300px\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("o clique no nome da pessoa não vaza para o card", () => {
  /**
   * Sem o stopPropagation no pointerdown o dnd-kit captura o gesto e o clique
   * nunca chega; sem o do click, ele sobe para o card e o painel abre ao mesmo
   * tempo que a rota muda.
   */
  it("para a propagação nos dois eventos", () => {
    const i = codigo.indexOf("onContactClick(contato)");
    expect(i).toBeGreaterThan(-1);
    const volta = codigo.slice(Math.max(0, i - 400), i + 200);
    expect(volta).toContain("e.stopPropagation()");
    expect(volta).toContain("onPointerDown={(e) => e.stopPropagation()}");
  });

  /**
   * Telefone e e-mail são <a> DENTRO de um card arrastável. Sem parar os dois
   * eventos, tocar no telefone no celular arrasta o card em vez de discar -- e
   * no desktop, clicar abre o negócio junto com o cliente de e-mail.
   */
  it.each(["tel:", "mailto:"])("o link %s não dispara o arraste", (esquema) => {
    const i = codigo.indexOf(esquema);
    expect(i).toBeGreaterThan(-1);
    const bloco = codigo.slice(i, i + 500);
    expect(bloco).toContain("onClick={(e) => e.stopPropagation()}");
    expect(bloco).toContain("onPointerDown={(e) => e.stopPropagation()}");
  });
});

describe("a cor da etapa continua vindo do banco", () => {
  it("a coluna consome stage.color", () => {
    expect(codigo).toContain("const cor = stage.color");
  });

  /**
   * A cor banha a coluna num tom dissolvido e preenche a pílula do cabeçalho.
   * Nenhum dos dois pode sair de classe Tailwind: o compilador não gera classe
   * para valor que só existe em runtime.
   */
  it("a pílula usa a cor por style inline", () => {
    expect(codigo).toContain("backgroundColor: cor");
  });

  /**
   * O tom da coluna passa pelo CSS, não por um rgba() inline, porque a
   * intensidade certa NÃO é a mesma nos dois temas: 10% da cor delimita sobre a
   * página quase branca e desaparece sobre o navy do tema escuro. Com o alfa
   * cravado no valor inline não havia como diferenciar.
   */
  it("o tom da coluna é definido por tema, via variável CSS", () => {
    expect(codigo).toContain("canaisDaCor(");
    expect(codigo).toContain('"--etapa-rgb"');
    expect(codigo).toContain("vx-coluna-etapa");

    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/\.vx-coluna-etapa\s*\{[^}]*rgb\(var\(--etapa-rgb\)/);
    expect(css).toMatch(/\.dark \.vx-coluna-etapa\s*\{[^}]*rgb\(var\(--etapa-rgb\)/);
  });

  /**
   * O usuário escolhe a cor da etapa livremente. Branco sobre amarelo é
   * ilegível, então o texto da pílula é decidido pela luminância da cor.
   */
  it("o texto da pílula respeita a luminância da cor escolhida", () => {
    expect(codigo).toContain("textoSobre(");
    expect(codigo).toMatch(/0\.2126 \* r \+ 0\.7152 \* g \+ 0\.0722 \* b/);
  });

  it("etapa sem cor cai no token, não numa cor fixa", () => {
    expect(codigo).toContain("bg-primary text-primary-foreground");
    expect(codigo).toContain("bg-primary/[0.06]");
  });

  /**
   * A cor de destaque é trocável em tempo de execução (ThemeContext sobrescreve
   * --primary), e os hex --vx-* do projeto não têm valores para o tema escuro:
   * usá-los aqui quebraria o modo escuro em silêncio.
   *
   * As duas únicas cores literais permitidas são o par de contraste do texto da
   * pílula, que existe justamente porque a cor de fundo é imprevisível.
   */
  it("não usa os hex --vx-, que não têm versão escura", () => {
    expect(codigo).not.toContain("var(--vx-");
  });

  it("as únicas cores literais são o par de contraste do texto", () => {
    const literais = codigo.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(literais).toEqual(["#ffffff"]);
    expect(codigo).toContain("hsl(213 41% 10%)");
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
