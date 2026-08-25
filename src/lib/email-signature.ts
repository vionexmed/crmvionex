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

const ACCENT = "#2563eb";

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

  const linhas: string[] = [];

  if (nome) {
    linhas.push(
      `<div style="font-family:Arial,Helvetica,sans-serif;font-weight:700;color:#0f172a;font-size:22px;line-height:1.2;letter-spacing:-0.02em">${escapar(nome)}</div>`,
    );
  }

  if (cargo || empresa) {
    const c = cargo ? `<span style="color:#475569">${escapar(cargo)}</span>` : "";
    const sep = cargo && empresa ? `<span style="color:#cbd5e1;margin:0 8px">•</span>` : "";
    const e = empresa
      ? `<span style="color:${ACCENT};font-weight:600">${escapar(empresa)}</span>`
      : "";
    linhas.push(
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;margin-top:4px">${c}${sep}${e}</div>`,
    );
  }

  // SEM ÍCONES, e é decisão, não esquecimento.
  //
  // O template usava ✆ (U+2706), um dingbat raro que quase nenhuma fonte de
  // sistema traz — o cliente substitui pelo glifo mais próximo e sai um símbolo
  // estranho. E 🌐 é emoji: colorido no Apple Mail, monocromático no Outlook,
  // quadrado vazio em fontes antigas. Ícone que não se pode garantir é ruído.
  //
  // Rótulo curto em maiúscula resolve com tipografia: identifica a linha, é
  // legível em qualquer fonte, e não depende de suporte a caractere nenhum.
  const contatos: string[] = [];
  const rotulo = `display:inline-block;width:52px;color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;vertical-align:middle`;
  const linhaContato = `font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#334155;margin-top:7px`;

  if (telefone) {
    // O href só aceita dígitos e o "+" do código do país; o texto visível
    // mantém a formatação que a pessoa digitou.
    const discar = telefone.replace(/[^+\d]/g, "");
    contatos.push(
      `<div style="${linhaContato}"><span style="${rotulo}">Tel</span><a href="tel:${escapar(discar)}" style="color:#334155;text-decoration:none;vertical-align:middle">${escapar(telefone)}</a></div>`,
    );
  }

  if (email) {
    contatos.push(
      `<div style="${linhaContato}"><span style="${rotulo}">E-mail</span><a href="mailto:${escapar(email)}" style="color:#334155;text-decoration:none;vertical-align:middle">${escapar(email)}</a></div>`,
    );
  }

  if (site) {
    // Sem protocolo o link vira relativo e quebra dentro do cliente de e-mail.
    const url = site.startsWith("http") ? site : `https://${site}`;
    const visivel = site.replace(/^https?:\/\//, "");
    contatos.push(
      `<div style="${linhaContato}"><span style="${rotulo}">Site</span><a href="${escapar(url)}" style="color:${ACCENT};text-decoration:none;font-weight:600;vertical-align:middle">${escapar(visivel)}</a></div>`,
    );
  }

  if (contatos.length) linhas.push(`<div style="margin-top:16px">${contatos.join("")}</div>`);

  if (extra) {
    linhas.push(
      `<div style="font-family:Arial,Helvetica,sans-serif;color:#64748b;font-size:14px;margin-top:14px;line-height:1.5">${escapar(extra).replace(/\n/g, "<br/>")}</div>`,
    );
  }

  // COM IMAGEM: à esquerda, CENTRALIZADA na altura do bloco de texto.
  //
  // `vertical-align:middle` nas DUAS células: alinhada ao topo, a imagem ficava
  // encostada na primeira linha enquanto o texto seguia por mais quatro — e a
  // assinatura parecia torta.
  //
  // 110px em vez de 84: no tamanho anterior um logotipo virava um borrão.
  //
  // `width` e `height` como ATRIBUTO além do estilo, porque vários clientes de
  // e-mail ignoram dimensão em CSS e renderizam no tamanho original — uma
  // imagem de 2000px estouraria a largura inteira.
  //
  // Canto levemente arredondado em vez de círculo: o recorte circular serve a
  // retrato e desfigura logotipo, e o campo aceita os dois. O Outlook ignora
  // border-radius e mostra quadrado — com 8px a diferença é imperceptível,
  // enquanto com 50% seria gritante.
  //
  // SEM IMAGEM: uma coluna, com a barra de destaque à esquerda.
  const abertura = fotoUrl
    ? `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding-right:22px;vertical-align:middle"><img src="${escapar(fotoUrl)}" alt="" width="110" height="110" style="width:110px;height:110px;border-radius:8px;display:block;border:0;object-fit:contain"/></td><td style="vertical-align:middle;border-left:3px solid ${ACCENT};padding-left:22px">`
    : `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding-right:0;vertical-align:middle;border-left:3px solid ${ACCENT};padding-left:20px">`;

  return `<div style="border-top:1px solid #e2e8f0;padding-top:16px;margin-top:16px">${abertura}${linhas.join("")}</td></tr></table></div>`;
}
