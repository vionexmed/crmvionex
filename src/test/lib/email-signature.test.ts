/**
 * A assinatura vai por e-mail, então erro aqui chega ao cliente do usuário —
 * e não dá para corrigir depois de enviado.
 *
 * Dois riscos que estes testes cobrem: HTML quebrado por entrada do usuário
 * (aspas num cargo, `<` num nome) e assinatura vazia virando um traço solto no
 * rodapé.
 */
import { describe, it, expect } from "vitest";
import { montarAssinaturaHtml, temAssinatura } from "@/lib/email-signature";

describe("temAssinatura()", () => {
  it("é falso para objeto vazio", () => {
    expect(temAssinatura({})).toBe(false);
  });

  it("é falso quando os campos só têm espaço", () => {
    expect(temAssinatura({ nome: "   ", cargo: "" })).toBe(false);
  });

  it("basta um campo preenchido", () => {
    expect(temAssinatura({ telefone: "11999999999" })).toBe(true);
  });
});

describe("montarAssinaturaHtml() — vazio não vira rodapé", () => {
  it("devolve string vazia sem dados", () => {
    // Sem isto, o e-mail levaria uma linha horizontal sozinha no rodapé.
    expect(montarAssinaturaHtml({})).toBe("");
  });

  it("devolve string vazia com só espaços", () => {
    expect(montarAssinaturaHtml({ nome: "  ", extra: "\n" })).toBe("");
  });
});

describe("montarAssinaturaHtml() — escapa entrada do usuário", () => {
  it("neutraliza HTML no nome", () => {
    const html = montarAssinaturaHtml({ nome: '<script>alert("x")</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapa aspas, que quebrariam o atributo de estilo", () => {
    const html = montarAssinaturaHtml({ cargo: 'Diretor "Comercial"' });
    expect(html).toContain("&quot;Comercial&quot;");
  });

  it("escapa o e-mail dentro do mailto", () => {
    const html = montarAssinaturaHtml({ email: 'a"b@x.com' });
    expect(html).not.toMatch(/href="mailto:a"b/);
  });
});

describe("montarAssinaturaHtml() — links utilizáveis", () => {
  it("o tel: fica só com dígitos e +, o texto mantém a formatação", () => {
    const html = montarAssinaturaHtml({ telefone: "+55 (11) 99999-9999" });
    expect(html).toContain('href="tel:+5511999999999"');
    expect(html).toContain("+55 (11) 99999-9999");
  });

  it("site sem protocolo ganha https, senão o link vira relativo", () => {
    const html = montarAssinaturaHtml({ site: "vionex.med.br" });
    expect(html).toContain('href="https://vionex.med.br"');
    // O texto visível não mostra o protocolo.
    expect(html).toContain(">vionex.med.br<");
  });

  it("site com protocolo é preservado", () => {
    expect(montarAssinaturaHtml({ site: "http://x.com" })).toContain('href="http://x.com"');
  });
});

describe("montarAssinaturaHtml() — estrutura para cliente de e-mail", () => {
  it("usa table e estilo inline, não classe CSS", () => {
    // Outlook ignora <style> e classes. Só inline sobrevive.
    const html = montarAssinaturaHtml({ nome: "Ana", empresa: "Vionex" });
    expect(html).toContain("<table");
    expect(html).toContain("style=");
    expect(html).not.toContain("class=");
  });

  it("não traz as quebras de linha da frente", () => {
    // gmail-send adiciona o <br/><br/> ao usar signature_html; guardá-las aqui
    // dobraria o espaço entre a mensagem e a assinatura.
    expect(montarAssinaturaHtml({ nome: "Ana" }).startsWith("<br")).toBe(false);
  });

  it("com imagem, ela fica centralizada na altura do texto", () => {
    // Alinhada ao topo, a imagem encostava na primeira linha enquanto o texto
    // seguia por mais quatro — a assinatura parecia torta.
    const html = montarAssinaturaHtml({ nome: "Ana", fotoUrl: "https://x.com/a.png" });
    expect(html).toContain("<img");
    expect(html.match(/vertical-align:middle/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("a imagem não é recortada em círculo", () => {
    // O campo aceita retrato E logotipo. Recorte circular serve ao primeiro e
    // desfigura o segundo; canto levemente arredondado serve aos dois.
    const html = montarAssinaturaHtml({ fotoUrl: "https://x.com/a.png" });
    expect(html).not.toContain("border-radius:50%");
    expect(html).toContain("object-fit:contain");
  });

  it("a imagem traz width e height como ATRIBUTO, não só em CSS", () => {
    // Vários clientes de e-mail ignoram dimensão em CSS e renderizam a imagem
    // no tamanho original — o que estouraria a largura da assinatura.
    const html = montarAssinaturaHtml({ fotoUrl: "https://x.com/a.png" });
    expect(html).toMatch(/<img[^>]*\swidth="104"/);
    expect(html).toMatch(/<img[^>]*\sheight="104"/);
  });

  it("sem imagem, não sobra célula nem borda vazia", () => {
    const html = montarAssinaturaHtml({ nome: "Ana" });
    expect(html).not.toContain("<img");
    // A barra vertical entre imagem e texto saiu: era decoração, e sem imagem
    // virava um traço solto ao lado do nome.
    expect(html).not.toContain("border-left");
  });

  it("a foto sozinha já conta como assinatura", () => {
    expect(montarAssinaturaHtml({ fotoUrl: "https://x.com/a.png" })).not.toBe("");
  });

  it("não usa dingbat nem emoji nos contatos", () => {
    // ✆ (U+2706) quase nenhuma fonte de sistema traz, e o cliente substitui pelo
    // glifo mais próximo — sai um símbolo estranho. 🌐 é emoji: colorido no
    // Apple Mail, monocromático no Outlook, quadrado vazio em fonte antiga.
    const html = montarAssinaturaHtml({
      telefone: "11999999999",
      email: "a@b.com",
      site: "x.com",
    });
    for (const glifo of ["✆", "✉", "🌐", "☎", "📧", "📱"]) {
      expect(html, `${glifo} não renderiza igual em todo cliente de e-mail`).not.toContain(glifo);
    }
  });

  it("não rotula os contatos — eles se identificam sozinhos", () => {
    // "TEL", "E-MAIL" e "SITE" na frente dobravam o texto para dizer o que já
    // estava dito: um tem @, outro tem dígitos, outro é domínio. Era isso que
    // dava peso de formulário a um bloco que deveria ser um cartão.
    const html = montarAssinaturaHtml({ telefone: "11999999999", email: "a@b.com", site: "x.com" });
    expect(html).not.toContain(">TEL<");
    expect(html).not.toContain(">E-MAIL<");
    expect(html).not.toContain(">SITE<");
  });

  it("cada contato é clicável", () => {
    const html = montarAssinaturaHtml({ telefone: "11999999999", email: "a@b.com", site: "x.com" });
    expect(html).toContain("href=\"tel:");
    expect(html).toContain("href=\"mailto:");
    expect(html).toContain("href=\"https://x.com\"");
  });

  it("um único ponto de cor: a empresa e o site", () => {
    // Assinatura minimalista tem UM acento. Nome e cargo em neutro; o teal
    // marca a empresa e o link, que é o que se quer que a pessoa clique.
    const html = montarAssinaturaHtml({ nome: "Ana", cargo: "Consultora", empresa: "Vionex" });
    expect(html.match(/#007B8A/g)?.length).toBe(1);
  });

  it("usa o teal da marca, não um azul genérico", () => {
    // Assinatura é onde a identidade importa: ela sai da empresa. O template
    // nasceu com #2563eb, azul padrão de framework sem relação com a Vionex.
    const html = montarAssinaturaHtml({ empresa: "Vionex" });
    expect(html).toContain("#007B8A");
    expect(html).not.toContain("#2563eb");
  });

  it("quebra de linha do texto adicional vira <br/>", () => {
    const html = montarAssinaturaHtml({ extra: "Rua A, 1\nSão Paulo" });
    expect(html).toContain("Rua A, 1<br/>São Paulo");
  });
});
