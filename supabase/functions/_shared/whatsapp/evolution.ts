/**
 * Provedor Evolution API — DESENHADO, NÃO IMPLEMENTADO.
 *
 * A Evolution é auto-hospedada (Docker + Redis + Postgres próprios) e não há
 * servidor ainda, então nada aqui foi escrito contra uma instância real.
 * Implementar às cegas produziria código que parece pronto e falha no primeiro
 * uso — pior que este stub, que falha dizendo o motivo.
 *
 * Quando a instância existir, o que muda é só este arquivo:
 *  - `enviarTexto`  → POST {serverUrl}/message/sendText/{instancia}, header `apikey`
 *  - `listarNumeros` → GET {serverUrl}/instance/fetchInstances
 *  - `lerWebhook`   → traduzir os eventos do Baileys para EventoWebhook. É aqui
 *    que a diferença é maior: a Evolution manda `messages.upsert` com JID
 *    (`5511...@s.whatsapp.net`), não o formato da Meta. Ainda existem contatos em
 *    produção com esse sufixo no telefone, resíduo da fase anterior — ver a
 *    limpeza em src/components/crm/ContactDrawer.tsx.
 *  - o pareamento não é escolha de número, e sim leitura de QR code, então a
 *    tela precisa de um estado a mais.
 *
 * Também vale notar: a Evolution roda por cima do WhatsApp Web, o que viola os
 * termos da Meta e pode derrubar o número. É uma escolha de produto, não de
 * engenharia — está registrada aqui para não se perder.
 */
import type { ProvedorWhatsApp } from "./types.ts";

const INDISPONIVEL =
  "A Evolution API ainda não está disponível. Use o WhatsApp oficial da Meta.";

/**
 * Promessa rejeitada, não `throw` síncrono.
 *
 * A interface declara Promise, e quem chama escreve `.catch()` ou `await` dentro
 * de try. Um throw síncrono numa função tipada como assíncrona escapa desses
 * dois — vira exceção não capturada em vez de erro tratado.
 */
function recusar<T>(): Promise<T> {
  return Promise.reject(new Error(INDISPONIVEL));
}

export const provedorEvolution: ProvedorWhatsApp = {
  nome: "evolution",
  enviarTexto: recusar,
  enviarTemplate: recusar,
  // Este NÃO recusa com erro: o cadastro precisa poder exibir o motivo na tela,
  // e para isso o retorno tem de ser um resultado, não uma exceção.
  verificarCredencial: () => Promise.resolve({ ok: false, erro: INDISPONIVEL }),
  listarNumeros: recusar,
  // Síncrono na interface, então aqui o throw é o comportamento certo.
  lerWebhook: () => {
    throw new Error(INDISPONIVEL);
  },
};
