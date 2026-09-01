/**
 * Todo link interno aponta para uma rota que existe.
 *
 * Existe porque eu cravei `/integrations` em dois lugares quando a rota é
 * `/settings/integrations`. Um deles era o retorno do OAuth do Instagram -- o
 * pior lugar possível: a pessoa autoriza na Meta, o CRM guarda a conexão e o
 * token com sucesso, e o redirecionamento a joga num 404. Parece que nada
 * funcionou, quando tudo funcionou.
 *
 * Nada no sistema de tipos pega isso: `<Link to="/qualquer-coisa">` é uma string
 * válida, e o React Router só descobre no clique. É a mesma família do
 * `[object Object]` e do espalhamento de filtros que o CLAUDE.md registra --
 * erro que compila, passa no lint, e falha em produção.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync("src/App.tsx", "utf8");

/**
 * As rotas declaradas, absolutas e relativas.
 *
 * Rota FILHA é declarada relativa (`path="visao-geral"` dentro de
 * `path="/marketing"`), então o conjunto final combina cada relativa com cada
 * absoluta como possível pai. É aproximado -- não reconstrói a árvore de
 * verdade -- e é suficiente para o que este teste persegue: caminho
 * completamente errado, como `/integrations` onde só existe
 * `/settings/integrations`. Reconstruir a árvore exigiria um parser de JSX, e o
 * CLAUDE.md registra por que varredura de JSX por regex não funciona aqui.
 */
const rotas = (() => {
  const todos = Array.from(APP.matchAll(/<Route\s+path="([^"]+)"/g), (m) => m[1]);
  const absolutas = todos.filter((p) => p.startsWith("/"));
  const relativas = todos.filter((p) => !p.startsWith("/") && p !== "*");

  const conjunto = new Set(absolutas);
  for (const pai of absolutas) {
    for (const filha of relativas) {
      conjunto.add(`${pai.replace(/\/$/, "")}/${filha}`);
    }
  }
  return [...conjunto];
})();

/** `/deals/:id` casa com `/deals/qualquer-coisa`. */
function casa(caminho: string): boolean {
  return rotas.some((rota) => {
    const partes = rota.split("/");
    const alvo = caminho.split("/");
    if (partes.length !== alvo.length) return false;
    return partes.every((p, i) => p.startsWith(":") || p === alvo[i]);
  });
}

const arquivos = (function varrer(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      if (!caminho.includes("/test")) varrer(caminho, saida);
    } else if (/\.tsx?$/.test(nome)) saida.push(caminho);
  }
  return saida;
})("src");

/** COMENTÁRIO NÃO É CÓDIGO — sem isto, explicar uma rota antiga reprova. */
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("todo link interno aponta para rota existente", () => {
  it("achou as rotas", () => {
    // Se isto esvaziar, a regex quebrou e o teste abaixo passaria vazio — o
    // pior modo de um teste falhar.
    expect(rotas.length).toBeGreaterThanOrEqual(25);
    expect(casa("/settings/integrations")).toBe(true);
    expect(casa("/marketing/visao-geral"), "rota filha não foi resolvida").toBe(true);
    // E o caminho que causou o 404 continua NÃO existindo.
    expect(casa("/integrations")).toBe(false);
  });

  it("nenhum destino aponta para o vazio", () => {
    const quebrados: string[] = [];

    for (const f of arquivos) {
      const codigo = semComentarios(readFileSync(f, "utf8"));
      /*
       * `to="..."` e `navigate("...")`, só com caminho LITERAL começando em `/`.
       * Template string (`` navigate(`/deals/${id}`) ``) fica de fora de
       * propósito: o prefixo é o que importa e ele já aparece em algum literal,
       * e tentar interpolar aqui geraria falso positivo a cada id.
       */
      for (const m of codigo.matchAll(/(?:to=|navigate\()"(\/[^"?#]*)/g)) {
        const caminho = m[1].replace(/\/+$/, "") || "/";
        if (!casa(caminho)) quebrados.push(`${caminho}  ←  ${f}`);
      }
    }

    expect(
      quebrados,
      `Link interno para rota que não existe:\n${quebrados.join("\n")}\n\n` +
        "Confira o caminho em src/App.tsx. Se a rota mudou de lugar, ou corrija " +
        "o link, ou declare um redirecionamento — como /tasks e /leads já fazem.",
    ).toEqual([]);
  });
});

/**
 * O mesmo para as edge functions que REDIRECIONAM o navegador.
 *
 * É onde o erro dói mais: o callback do OAuth roda depois de a pessoa já ter
 * autorizado, então um caminho errado transforma sucesso em 404. Aconteceu com o
 * Instagram, e o do Gmail tem a mesma forma.
 */
describe("os retornos de OAuth apontam para rota existente", () => {
  const callbacks = [
    "supabase/functions/instagram-oauth-callback/index.ts",
    "supabase/functions/gmail-oauth-callback/index.ts",
  ];

  it.each(callbacks)("%s manda para uma rota que existe", (arquivo) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    // Os caminhos que a função usa como destino, em constante ou literal.
    const destinos = Array.from(
      src.matchAll(/(?:DESTINO\s*=\s*|destino\s*=\s*|fallback\s*=\s*)"(\/[^"]*)"/g),
      (m) => m[1],
    );
    expect(destinos.length, `${arquivo}: nenhum destino encontrado`).toBeGreaterThan(0);
    for (const d of destinos) {
      expect(casa(d), `${arquivo} redireciona para "${d}", que não é rota`).toBe(true);
    }
  });
});
