/**
 * Monta o HTML da assinatura de e-mail.
 *
 * Porte fiel do construtor que vive em gmail-send. Existir aqui é o que permite
 * a PRÉVIA ser exatamente o que vai ser enviado — não uma aproximação: a tela
 * gera este HTML, guarda esta string em email_connections.signature_html, e o
 * envio a usa sem alterar nada.
 *
 * O e-mail é renderizado por clientes que ignoram <style> e classes CSS. Por
 * isso tudo é estilo inline e a estrutura é <table>: é feio de ler e é o que
 * funciona no Outlook.
 */

export type DadosAssinatura = {
  nome?: string;
  cargo?: string;
  empresa?: string;
  telefone?: string;
  email?: string;
  site?: string;
  /** Foto de quem assina. Redonda, ao lado do texto. */
  fotoUrl?: string;
  extra?: string;
};

/**
 * Teal da Vionex, o mesmo --vx-teal do tema. Era #2563eb, um azul genérico de
 * framework que não tem relação com a marca — e assinatura é justamente onde a
 * identidade importa, porque ela sai da empresa.
 */
const ACCENT = "#007B8A";
const TEXTO_FORTE = "#0F1923";
const TEXTO_MEDIO = "#4A5568";
const TEXTO_FRACO = "#9AA3B0";

function escapar(s: string): string {
  return String(s).replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

const limpo = (v: string | undefined) => (typeof v === "string" ? v.trim() : "");

/** Há algo para desenhar? Assinatura vazia não deve virar um traço solto. */
export function temAssinatura(d: DadosAssinatura): boolean {
  return [d.nome, d.cargo, d.empresa, d.telefone, d.email, d.site, d.fotoUrl, d.extra]
    .some((v) => limpo(v) !== "");
}

/**
 * Devolve o bloco da assinatura, SEM as quebras de linha da frente.
 *
 * O `<br/><br/>` que separa do corpo da mensagem é responsabilidade de quem
 * envia — gmail-send já o adiciona ao usar signature_html. Guardar as quebras
 * aqui produziria espaço dobrado.
 */
export function montarAssinaturaHtml(d: DadosAssinatura): string {
  if (!temAssinatura(d)) return "";

  const nome = limpo(d.nome);
  const cargo = limpo(d.cargo);
  const empresa = limpo(d.empresa);
  const telefone = limpo(d.telefone);
  const email = limpo(d.email);
  const site = limpo(d.site);
  const fotoUrl = limpo(d.fotoUrl);
  const extra = limpo(d.extra);

  const FONTE = "Arial,Helvetica,sans-serif";
  const linhas: string[] = [];

  if (nome) {
    linhas.push(
      `<div style="font-family:${FONTE};font-size:19px;font-weight:600;color:${TEXTO_FORTE};line-height:1.3;letter-spacing:-0.01em">${escapar(nome)}</div>`,
    );
  }

  if (cargo || empresa) {
    // Ponto médio em vez de barra: separa sem desenhar. A empresa é a única
    // palavra em destaque na assinatura inteira — é o que identifica de onde a
    // pessoa fala, e um único ponto de cor pesa mais que vários.
    const c = cargo ? escapar(cargo) : "";
    const sep = cargo && empresa ? `<span style="color:${TEXTO_FRACO};padding:0 6px">·</span>` : "";
    const e = empresa
      ? `<span style="color:${ACCENT};font-weight:600">${escapar(empresa)}</span>`
      : "";
    linhas.push(
      `<div style="font-family:${FONTE};font-size:14px;color:${TEXTO_MEDIO};line-height:1.45;margin-top:3px">${c}${sep}${e}</div>`,
    );
  }

  // SEM RÓTULOS. Telefone, e-mail e site se identificam sozinhos — um tem @,
  // outro tem dígitos, outro é domínio. "TEL", "E-MAIL" e "SITE" na frente
  // dobravam a quantidade de texto para dizer o que já estava dito, e era isso
  // que dava peso de formulário a um bloco que deveria ser um cartão.
  const contatos: string[] = [];
  const contato = `font-family:${FONTE};font-size:13px;line-height:1.5;margin-top:4px`;

  if (telefone) {
    // O href só aceita dígitos e o "+" do código do país; o texto visível
    // mantém a formatação que a pessoa digitou.
    const discar = telefone.replace(/[^+\d]/g, "");
    contatos.push(
      `<div style="${contato}"><a href="tel:${escapar(discar)}" style="color:${TEXTO_MEDIO};text-decoration:none">${escapar(telefone)}</a></div>`,
    );
  }

  if (email) {
    contatos.push(
      `<div style="${contato}"><a href="mailto:${escapar(email)}" style="color:${TEXTO_MEDIO};text-decoration:none">${escapar(email)}</a></div>`,
    );
  }

  if (site) {
    // Sem protocolo o link vira relativo e quebra dentro do cliente de e-mail.
    const url = site.startsWith("http") ? site : `https://${site}`;
    const visivel = site.replace(/^https?:\/\//, "").replace(/\/$/, "");
    contatos.push(
      `<div style="${contato}"><a href="${escapar(url)}" style="color:${ACCENT};text-decoration:none">${escapar(visivel)}</a></div>`,
    );
  }

  if (contatos.length) linhas.push(`<div style="margin-top:12px">${contatos.join("")}</div>`);

  if (extra) {
    linhas.push(
      `<div style="font-family:${FONTE};color:${TEXTO_FRACO};font-size:11px;margin-top:14px;line-height:1.55">${escapar(extra).replace(/\n/g, "<br/>")}</div>`,
    );
  }

  // SEM BARRA VERTICAL entre imagem e texto. Ela era decoração: não separava
  // nada que o espaço não separe, e puxava o olho para si em vez de para o
  // nome. Sobra um respiro maior, que é o que dá ar ao bloco.
  //
  // `vertical-align:middle` nas DUAS células: alinhada ao topo, a imagem
  // encostava na primeira linha enquanto o texto seguia por mais quatro.
  //
  // `width` e `height` como ATRIBUTO além do estilo, porque vários clientes de
  // e-mail ignoram dimensão em CSS e renderizam no tamanho original — uma
  // imagem de 2000px estouraria a largura inteira.
  //
  // Canto levemente arredondado em vez de círculo: o campo aceita retrato E
  // logotipo, e recorte circular desfigura o segundo. O Outlook ignora
  // border-radius e mostra quadrado — com 6px a diferença é imperceptível.
  const abertura = fotoUrl
    ? `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding-right:22px;vertical-align:middle"><img src="${escapar(fotoUrl)}" alt="" width="104" height="104" style="width:104px;height:104px;border-radius:6px;display:block;border:0;object-fit:contain"/></td><td style="vertical-align:middle">`
    : `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="vertical-align:middle">`;

  return `<div style="border-top:1px solid #E4E7EC;padding-top:20px;margin-top:24px">${abertura}${linhas.join("")}</td></tr></table></div>`;
}
