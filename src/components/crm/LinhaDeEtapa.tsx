import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Uma etapa de funil, editável.
 *
 * Havia dois editores de etapa e nenhum era completo. O de Negócios (diálogo
 * "Personalizar funil") permitia renomear, recolorir e mudar a probabilidade,
 * mas **não reordenar**. O de Configurações reordenava com ▲▼ mas **não deixava
 * renomear nem recolorir** -- só mostrava o valor e um botão de apagar.
 *
 * Pior: a descrição em Configurações dizia "Arraste para reordenar" e não havia
 * arraste nenhum. Um rótulo que promete o que a tela não faz.
 *
 * Esta linha faz as quatro coisas. Cada tela liga o que faz sentido: quem edita
 * rascunho em lote não precisa de ▲▼ se já reordena por posição no array; quem
 * grava a cada clique precisa.
 */

export type EtapaEditavel = {
  id?: string;
  name: string;
  color: string;
  win_probability: number;
  order?: number;
};

export function LinhaDeEtapa({
  etapa,
  indice,
  total,
  onChange,
  onSalvar,
  onRemover,
  onMover,
  className,
}: {
  etapa: EtapaEditavel;
  indice: number;
  total: number;
  onChange: (mudanca: Partial<EtapaEditavel>) => void;
  /**
   * Chamado ao sair do campo. Existe para a tela de Configurações, que grava
   * cada etapa direto no banco -- sem isto seria um `update` por caractere
   * digitado. Quem edita rascunho em lote não passa nada e salva no fim.
   */
  onSalvar?: () => void;
  /** Ausente quando remover não faz sentido (última etapa, por exemplo). */
  onRemover?: () => void;
  /** Ausente quando a ordem vem da posição no array. */
  onMover?: (direcao: "cima" | "baixo") => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 rounded-md border border-border p-2", className)}>
      {onMover && (
        <div className="flex shrink-0 flex-col">
          {/* Eram os caracteres ▲▼ como texto: não tinham nome acessível, e o
              alvo de clique era do tamanho da letra. */}
          <button
            type="button"
            onClick={() => onMover("cima")}
            disabled={indice === 0}
            aria-label={`Mover ${etapa.name || `etapa ${indice + 1}`} para cima`}
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMover("baixo")}
            disabled={indice === total - 1}
            aria-label={`Mover ${etapa.name || `etapa ${indice + 1}`} para baixo`}
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <input
        type="color"
        value={etapa.color}
        onChange={(e) => onChange({ color: e.target.value })}
        onBlur={onSalvar}
        className="h-8 w-8 shrink-0 cursor-pointer rounded border-0"
        aria-label={`Cor da etapa ${etapa.name || indice + 1}`}
      />

      <Input
        value={etapa.name}
        onChange={(e) => onChange({ name: e.target.value })}
        onBlur={onSalvar}
        placeholder={`Etapa ${indice + 1}`}
        aria-label={`Nome da etapa ${indice + 1}`}
        className="h-8 flex-1 text-xs"
      />

      <div className="flex shrink-0 items-center gap-1">
        <Input
          type="number"
          min={0}
          max={100}
          value={etapa.win_probability}
          onChange={(e) => {
            // Limitado na entrada, não só no atributo: `min`/`max` do HTML não
            // impedem digitar 500, só marcam o campo como inválido.
            const n = Number(e.target.value);
            onChange({ win_probability: Math.max(0, Math.min(100, isNaN(n) ? 0 : n)) });
          }}
          onBlur={onSalvar}
          aria-label={`Probabilidade de ganho da etapa ${etapa.name || indice + 1}, em porcento`}
          className="h-8 w-16 text-center text-xs"
        />
        <span className="text-xs text-muted-foreground">%</span>
      </div>

      {onRemover && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onRemover}
          aria-label={`Remover etapa ${etapa.name || indice + 1}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
