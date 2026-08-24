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
  logoUrl?: string;
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
  return [d.nome, d.cargo, d.empresa, d.telefone, d.email, d.site, d.logoUrl, d.extra]
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
  const logoUrl = limpo(d.logoUrl);
  const extra = limpo(d.extra);

  const linhas: string[] = [];

  if (nome) {
    linhas.push(
      `<div style="font-family:Arial,Helvetica,sans-serif;font-weight:700;color:#0f172a;font-size:24px;line-height:1.25;letter-spacing:-0.01em">${escapar(nome)}</div>`,
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

  const contatos: string[] = [];
  const icone = `display:inline-block;width:18px;color:${ACCENT};font-weight:700;margin-right:10px;text-align:center;font-size:16px`;

  if (telefone) {
    // O href só aceita dígitos e o "+" do código do país; o texto visível
    // mantém a formatação que a pessoa digitou.
    const discar = telefone.replace(/[^+\d]/g, "");
    contatos.push(
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#334155;margin-top:8px"><span style="${icone}">✆</span><a href="tel:${escapar(discar)}" style="color:#334155;text-decoration:none">${escapar(telefone)}</a></div>`,
    );
  }

  if (email) {
    contatos.push(
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#334155;margin-top:6px"><span style="${icone}">✉</span><a href="mailto:${escapar(email)}" style="color:#334155;text-decoration:none">${escapar(email)}</a></div>`,
    );
  }

  if (site) {
    // Sem protocolo o link vira relativo e quebra dentro do cliente de e-mail.
    const url = site.startsWith("http") ? site : `https://${site}`;
    const visivel = site.replace(/^https?:\/\//, "");
    contatos.push(
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#334155;margin-top:6px"><span style="${icone}">🌐</span><a href="${escapar(url)}" style="color:${ACCENT};text-decoration:none;font-weight:500">${escapar(visivel)}</a></div>`,
    );
  }

  if (contatos.length) linhas.push(`<div style="margin-top:14px">${contatos.join("")}</div>`);

  if (extra) {
    linhas.push(
      `<div style="font-family:Arial,Helvetica,sans-serif;color:#64748b;font-size:14px;margin-top:14px;line-height:1.5">${escapar(extra).replace(/\n/g, "<br/>")}</div>`,
    );
  }

  // Com logo: duas colunas, separadas por uma barra da cor de destaque.
  // Sem logo: uma coluna com a barra à esquerda.
  const abertura = logoUrl
    ? `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding-right:22px;vertical-align:top;border-right:4px solid ${ACCENT}"><img src="${escapar(logoUrl)}" alt="" style="max-height:120px;max-width:220px;display:block"/></td><td style="width:22px"></td><td style="vertical-align:top">`
    : `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding-right:0;vertical-align:top;border-left:4px solid ${ACCENT};padding-left:18px">`;

  return `<div style="border-top:1px solid #e2e8f0;padding-top:16px;margin-top:16px">${abertura}${linhas.join("")}</td></tr></table></div>`;
}
