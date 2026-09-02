import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * O lugar de um recurso que ainda não existe.
 *
 * Substitui as telas de IA, que dependiam de uma chave da Lovable que este
 * projeto não usa. Elas não estavam "quebradas" no sentido comum: a interface
 * inteira aparecia, aceitava o texto, e só na hora de enviar respondia
 * "LOVABLE_API_KEY is not configured" -- um erro que não diz nada para quem só
 * escreveu uma pergunta. Interface que promete e não entrega é pior que
 * interface ausente, e é o mesmo critério que tirou o botão de olho do card do
 * kanban e mantém o interruptor fora do cartão de integração sem "desligar".
 *
 * VIDRO, e não um cartão comum. O desfoque diz "há algo atrás disto" -- que é
 * exatamente o estado: o espaço está reservado, o conteúdo não chegou. Um
 * cartão sólido com um texto no meio leria como conteúdo final.
 *
 * `backdrop-blur` precisa de algo atrás para desfocar, então o gradiente tênue
 * vem no próprio componente: sobre fundo chapado o vidro fica invisível.
 */
export function EmBreve({
  titulo,
  descricao,
  className,
}: {
  titulo: string;
  descricao?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-[220px] flex-col items-center justify-center overflow-hidden rounded-lg border border-border/60 p-8 text-center",
        // O gradiente é o que o vidro desfoca. Em `--primary`, então acompanha
        // a cor de destaque escolhida em Configurações e funciona nos dois temas.
        "bg-gradient-to-br from-primary/[0.07] via-transparent to-primary/[0.04]",
        className,
      )}
    >
      <div className="absolute inset-0 backdrop-blur-[2px]" aria-hidden />

      <div className="relative flex flex-col items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-card/60 shadow-[var(--shadow-xs)]">
          <Sparkles className="h-[18px] w-[18px] text-primary" />
        </span>

        <p className="mt-1 text-sm font-semibold tracking-tight">{titulo}</p>
        {descricao && (
          <p className="max-w-[46ch] text-xs leading-relaxed text-muted-foreground">
            {descricao}
          </p>
        )}

        <span className="mt-1 rounded-full border border-border/60 bg-card/60 px-2.5 py-0.5 text-label font-semibold uppercase tracking-wide text-muted-foreground">
          Em breve
        </span>
      </div>
    </div>
  );
}
