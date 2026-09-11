/**
 * Todo bucket que a tela usa precisa existir no banco.
 *
 * O defeito era invisível fora do navegador: o catálogo de produtos nasceu com
 * `foto_url`, com campo de envio no formulário e com o cartão desenhado para ter
 * foto em cima -- e o bucket `produtos` nunca foi criado. Typecheck, teste e
 * build passavam; quem tentava cadastrar produto com foto recebia
 * "Bucket not found" e não tinha como seguir.
 *
 * O nome do bucket é uma STRING que atravessa a fronteira entre o app e o
 * Storage. Como toda string dessas neste projeto, ninguém a confere: renomear de
 * um lado não dá erro de tipo do outro.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function arquivos(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivos(p, out);
    else if (/\.tsx?$/.test(nome)) out.push(p);
  }
  return out;
}

/** `bucket="produtos"` na tela e `bucket = "email-logos"` no valor padrão. */
const USADOS = new Map<string, string>();
for (const f of arquivos("src")) {
  if (f.includes("/test/")) continue;
  for (const m of semComentarios(readFileSync(f, "utf8")).matchAll(/bucket\s*[:=]\s*"([a-z0-9-]+)"/g)) {
    USADOS.set(m[1], f);
  }
}

const MIG = "supabase/migrations";
const SQL = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIG, f), "utf8"))
  .join("\n");

describe("bucket usado é bucket criado", () => {
  it("a varredura encontrou os buckets da aplicação", () => {
    // Guarda contra o regex parar de casar e o teste virar verde por vazio.
    expect(USADOS.size).toBeGreaterThan(0);
    expect([...USADOS.keys()]).toContain("produtos");
  });

  for (const [nome, arquivo] of USADOS) {
    it(`'${nome}' é criado por alguma migração`, () => {
      const criado = new RegExp(
        `INSERT INTO storage\\.buckets[\\s\\S]{0,200}'${nome}'`,
      ).test(SQL);
      expect(criado, `${arquivo} envia para '${nome}', que nenhuma migração cria`).toBe(true);
    });

    /**
     * `LogoUploadField` mostra a imagem por `getPublicUrl`, sem assinar URL.
     * Bucket privado devolveria uma URL que responde 400 -- a foto sobe, o
     * cadastro salva, e o cartão fica com a imagem quebrada.
     */
    it(`'${nome}' é público, porque a tela usa getPublicUrl`, () => {
      const m = SQL.match(
        new RegExp(`VALUES \\('${nome}', '${nome}', (true|false)\\)`),
      );
      expect(m?.[1], `'${nome}' precisa nascer público`).toBe("true");
    });
  }
});

describe("o envio da foto de produto fica na pasta de quem enviou", () => {
  const BUCKET = readFileSync("supabase/migrations/20260909160000_bucket_de_produtos.sql", "utf8");

  /** `LogoUploadField` grava em `<user_id>/<uuid>.<ext>`; a política confere o
   *  primeiro segmento. Se o caminho mudar, o envio passa a ser recusado. */
  it("a política casa com o caminho que o componente grava", () => {
    expect(BUCKET).toMatch(/\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
    const campo = semComentarios(readFileSync("src/components/crm/LogoUploadField.tsx", "utf8"));
    expect(campo).toContain("const path = `${uid}/${crypto.randomUUID()}.${ext}`");
  });

  /**
   * Ler é de todo mundo porque a URL que `getPublicUrl` devolve NÃO leva
   * autenticação: ela é usada num `<img src>`, e o navegador busca a imagem sem
   * a sessão do Supabase. Com leitura restrita, a foto subiria, o produto
   * salvaria, e o cartão ficaria com a imagem quebrada.
   */
  it("ler é de todo mundo, porque a URL da imagem não leva sessão", () => {
    expect(BUCKET).toMatch(/FOR SELECT USING \(bucket_id = 'produtos'\)/);
  });
});
