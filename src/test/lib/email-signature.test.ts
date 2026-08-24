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

  it("com logo, a imagem entra em coluna própria", () => {
    const html = montarAssinaturaHtml({ nome: "Ana", logoUrl: "https://x.com/l.png" });
    expect(html).toContain("<img");
    expect(html).toContain("border-right");
  });

  it("sem logo, a barra fica à esquerda do texto", () => {
    const html = montarAssinaturaHtml({ nome: "Ana" });
    expect(html).not.toContain("<img");
    expect(html).toContain("border-left");
  });

  it("quebra de linha do texto adicional vira <br/>", () => {
    const html = montarAssinaturaHtml({ extra: "Rua A, 1\nSão Paulo" });
    expect(html).toContain("Rua A, 1<br/>São Paulo");
  });
});
