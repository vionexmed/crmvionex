/**
 * CÓPIA de src/lib/email-signature.ts. Mantida idêntica por teste.
 *
 * Por que copiar em vez de importar: a tela é empacotada pelo Vite e esta
 * função roda em Deno. Um arquivo fora de supabase/functions/ não entra no
 * bundle da edge function de forma confiável.
 *
 * A alternativa era deixar cada lado com o próprio template — foi o que existia,
 * e o resultado apareceu num e-mail real: a tela mostrava uma assinatura e o
 * enviado saía com ícones que não renderizam e um azul que não é da marca.
 * Duplicar com teste de igualdade é pior que importar e melhor que divergir.
 *
 * NÃO EDITE AQUI. Edite src/lib/email-signature.ts e copie.
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

  const linhas: string[] = [];

  if (nome) {
    linhas.push(
      `<div style="font-family:Arial,Helvetica,sans-serif;font-weight:700;color:${TEXTO_FORTE};font-size:20px;line-height:1.25;letter-spacing:-0.01em">${escapar(nome)}</div>`,
    );
  }

  if (cargo || empresa) {
    // Cargo e empresa numa linha só, com a empresa destacada: é a informação
    // que identifica de onde a pessoa fala.
    const c = cargo ? `<span style="color:${TEXTO_MEDIO}">${escapar(cargo)}</span>` : "";
    const sep = cargo && empresa
      ? `<span style="color:${TEXTO_FRACO};padding:0 7px">|</span>`
      : "";
    const e = empresa
      ? `<span style="color:${ACCENT};font-weight:700">${escapar(empresa)}</span>`
      : "";
    linhas.push(
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;margin-top:5px">${c}${sep}${e}</div>`,
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
  //
  // Cada contato é uma LINHA DE TABELA, não uma div com span de largura fixa.
  // `display:inline-block` com width é ignorado pelo Outlook, que renderiza com
  // motor do Word: os rótulos saíam desalinhados e o valor colado neles. Célula
  // de tabela com width funciona em todos.
  const contatos: string[] = [];
  const rotulo = `font-family:Arial,Helvetica,sans-serif;color:${TEXTO_FRACO};font-size:10px;font-weight:700;letter-spacing:0.1em;padding:3px 12px 3px 0;white-space:nowrap;vertical-align:middle`;
  const valor = `font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXTO_MEDIO};padding:3px 0;vertical-align:middle`;
  const linha = (r: string, v: string) =>
    `<tr><td style="${rotulo}">${r}</td><td style="${valor}">${v}</td></tr>`;

  if (telefone) {
    // O href só aceita dígitos e o "+" do código do país; o texto visível
    // mantém a formatação que a pessoa digitou.
    const discar = telefone.replace(/[^+\d]/g, "");
    contatos.push(
      linha("TEL", `<a href="tel:${escapar(discar)}" style="color:${TEXTO_MEDIO};text-decoration:none">${escapar(telefone)}</a>`),
    );
  }

  if (email) {
    contatos.push(
      linha("E-MAIL", `<a href="mailto:${escapar(email)}" style="color:${TEXTO_MEDIO};text-decoration:none">${escapar(email)}</a>`),
    );
  }

  if (site) {
    // Sem protocolo o link vira relativo e quebra dentro do cliente de e-mail.
    const url = site.startsWith("http") ? site : `https://${site}`;
    const visivel = site.replace(/^https?:\/\//, "");
    contatos.push(
      linha("SITE", `<a href="${escapar(url)}" style="color:${ACCENT};text-decoration:none;font-weight:600">${escapar(visivel)}</a>`),
    );
  }

  if (contatos.length) {
    linhas.push(
      `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:14px">${contatos.join("")}</table>`,
    );
  }

  if (extra) {
    linhas.push(
      `<div style="font-family:Arial,Helvetica,sans-serif;color:${TEXTO_FRACO};font-size:12px;margin-top:14px;line-height:1.55">${escapar(extra).replace(/\n/g, "<br/>")}</div>`,
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

  return `<div style="border-top:1px solid #E4E7EC;padding-top:18px;margin-top:18px">${abertura}${linhas.join("")}</td></tr></table></div>`;
}
