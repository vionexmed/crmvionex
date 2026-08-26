/**
 * Rótulo e cor por canal de abordagem.
 *
 * Mora fora do componente porque o teste compara este mapa com os literais que a
 * migração emite: banco e tela escolhem a mesma string em dois arquivos, e quando
 * divergem o selo desaparece sem erro nenhum — a linha volta a não dizer de onde
 * veio a abordagem.
 *
 * Escrito por extenso. A primeira versão abreviava ("ativ", "whats"), o que
 * economiza três letras num selo de 9px ao custo de o leitor não saber o que lê.
 *
 * "E-mail" aparece duas vezes de propósito: o registrado à mão e o que o CRM
 * enviou são abordagens diferentes. Só o segundo tem conteúdo que o sistema
 * conhece, e tratá-los igual faria alguém procurar no Gmail uma mensagem que
 * nunca saiu de lá.
 */
export const CANAL: Record<string, { rotulo: string; classe: string }> = {
  ligacao: { rotulo: "Ligação", classe: "bg-primary/10 text-primary" },
  reuniao: { rotulo: "Reunião", classe: "bg-primary/10 text-primary" },
  email_manual: { rotulo: "E-mail registrado", classe: "bg-muted text-muted-foreground" },
  "e-mail": { rotulo: "E-mail", classe: "bg-warning/10 text-warning" },
  whatsapp: { rotulo: "WhatsApp", classe: "bg-success/10 text-success" },
};
