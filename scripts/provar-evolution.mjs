/**
 * Exercita o provedor de WhatsApp da Evolution contra um servidor DE VERDADE.
 *
 * POR QUE ISTO EXISTE
 *
 * `evolution.ts` foi escrito contra a documentação da API, não contra uma
 * instância. Teste de unidade aqui não ajuda: o que pode estar errado é
 * justamente o contrato com o servidor -- nome de rota, forma do corpo, onde o
 * QR vem embrulhado. Um mock só confirmaria as minhas próprias suposições.
 *
 * Este script troca "deve funcionar" por "funciona", e quando falha aponta a
 * linha exata. Rodar exige um servidor Evolution de pé:
 *
 *     cd infra/evolution && docker compose up -d
 *     node scripts/provar-evolution.mjs
 *
 * Fora da suíte de testes de propósito: `npm test` não pode depender de Docker.
 *
 * Carrega o .ts pelo esbuild que o Vite já traz -- o Node não lê TypeScript, e
 * instalar tsx só para isto seria peso a mais.
 */
import { build } from "esbuild";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CRED = {
  provider: "evolution",
  // Sobrescrevíveis para apontar o script a um servidor já hospedado.
  token: process.env.EVO_KEY ?? "teste-local-nao-usar-em-producao-0001",
  wabaId: null,
  serverUrl: process.env.EVO_URL ?? "http://localhost:8080",
};
const INSTANCIA = "prova-vionex-01";

const dir = mkdtempSync(join(tmpdir(), "evo-"));
const saida = join(dir, "provedor.mjs");
await build({
  entryPoints: ["supabase/functions/_shared/whatsapp/evolution.ts"],
  bundle: true, format: "esm", platform: "node", outfile: saida, logLevel: "error",
});
const { provedorEvolution: p } = await import(saida);

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const rui = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1; };

console.log("\n── verificarCredencial ──");
const v = await p.verificarCredencial(CRED);
v.ok ? ok("chave aceita pelo servidor") : rui(`recusou: ${v.erro}`);

const ruim = await p.verificarCredencial({ ...CRED, token: "chave-errada" });
!ruim.ok ? ok(`chave errada recusada: "${ruim.erro}"`) : rui("aceitou chave errada");

const semUrl = await p.verificarCredencial({ ...CRED, serverUrl: null });
!semUrl.ok && /URL do servidor/.test(semUrl.erro) ? ok("sem URL, erro claro") : rui(`sem URL: ${semUrl.erro}`);

const offline = await p.verificarCredencial({ ...CRED, serverUrl: "http://localhost:59999" });
!offline.ok && /localhost:59999/.test(offline.erro)
  ? ok("servidor fora do ar: erro nomeia o endereço")
  : rui(`offline: ${offline.erro}`);

console.log("\n── listarNumeros (instâncias) ──");
const antes = await p.listarNumeros(CRED);
Array.isArray(antes) ? ok(`devolveu array (${antes.length} instâncias)`) : rui("não é array");

console.log("\n── iniciarPareamento ──");
const par = await p.iniciarPareamento(CRED, INSTANCIA);
console.log("     estado:", par.estado, "| qr:", par.qr ? `${par.qr.slice(0, 30)}… (${par.qr.length} chars)` : null,
            "| codigo:", par.codigo);
par.estado === "aguardando" ? ok("estado aguardando") : rui(`estado inesperado: ${par.estado}`);
par.qr?.startsWith("data:image/") ? ok("QR veio como data URI pronto para <img>") : rui("QR ausente ou sem data URI");

console.log("\n── iniciarPareamento de novo (instância já existe) ──");
const par2 = await p.iniciarPareamento(CRED, INSTANCIA);
par2.estado === "aguardando" && par2.qr
  ? ok("retomou em vez de falhar -- é o caso de fechar a tela e voltar")
  : rui(`não retomou: ${par2.estado} / qr=${!!par2.qr}`);

console.log("\n── consultarPareamento ──");
const c = await p.consultarPareamento(CRED, INSTANCIA);
["aguardando", "conectado", "desconectado"].includes(c.estado)
  ? ok(`estado válido: ${c.estado}`) : rui(`estado inválido: ${c.estado}`);

console.log("\n── a instância aparece na listagem? ──");
const depois = await p.listarNumeros(CRED);
const achou = depois.find((n) => n.id === INSTANCIA);
achou ? ok(`achou: id=${achou.id} telefone=${achou.telefone} qualidade=${achou.qualidade}`)
      : rui(`não achou ${INSTANCIA} em [${depois.map((n) => n.id).join(", ")}]`);

console.log("\n── apontarWebhook ──");
try {
  await p.apontarWebhook(CRED, INSTANCIA, "https://exemplo.invalid/functions/v1/whatsapp-webhook?token=abc");
  ok("webhook configurado");
} catch (e) { rui(`webhook: ${e.message}`); }

console.log("\n── consultarPareamento de instância inexistente ──");
const nada = await p.consultarPareamento(CRED, "nao-existe-mesmo-xyz");
nada.estado === "desconectado"
  ? ok("devolve desconectado, não lança -- o fluxo é criar de novo")
  : rui(`estado: ${nada.estado}`);

console.log("\n── enviarTexto sem sessão pareada (tem de falhar LIMPO) ──");
const env = await p.enviarTexto(CRED, { origem: INSTANCIA, para: "5511999998888" }, "oi");
!env.ok && env.erro && env.erro !== "[object Object]"
  ? ok(`falhou com motivo legível: "${String(env.erro).slice(0, 90)}"`)
  : rui(`erro ilegível: ${JSON.stringify(env).slice(0, 200)}`);

console.log("\n── encerrarInstancia ──");
try { await p.encerrarInstancia(CRED, INSTANCIA); ok("instância removida"); }
catch (e) { rui(`remover: ${e.message}`); }

// A exclusão na Evolution é ASSÍNCRONA: a chamada retorna antes de a instância
// sair da listagem. A primeira versão deste script conferia na hora e reprovava
// -- suposição do teste, não defeito do provedor. Para o produto não importa:
// quem manda na tela é `whatsapp_connections`, não a listagem do servidor.
let final = [];
for (let i = 0; i < 20; i++) {
  final = await p.listarNumeros(CRED);
  if (!final.find((n) => n.id === INSTANCIA)) break;
  await new Promise((r) => setTimeout(r, 250));
}
!final.find((n) => n.id === INSTANCIA)
  ? ok("sumiu da listagem (a exclusão é assíncrona)")
  : rui("continua listada depois de 5s");

console.log("\n── encerrar de novo (404 é sucesso) ──");
try { await p.encerrarInstancia(CRED, INSTANCIA); ok("idempotente"); }
catch (e) { rui(`não é idempotente: ${e.message}`); }
