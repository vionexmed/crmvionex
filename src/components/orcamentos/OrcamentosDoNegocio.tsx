import { useState } from "react";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrcamentosDoNegocio } from "@/hooks/queries/useOrcamentos";
import { ConstrutorDeOrcamento } from "@/components/orcamentos/ConstrutorDeOrcamento";
import { PainelDeOrcamento } from "@/components/orcamentos/PainelDeOrcamento";
import { LinhaDeOrcamento } from "@/components/orcamentos/LinhaDeOrcamento";
import type { OrcamentoComRelacoes } from "@/lib/api/orcamentos";

/**
 * Os orçamentos de um negócio, dentro do negócio.
 *
 * Existe pelo mesmo motivo que a página própria existe: um orçamento pode nascer
 * sem negócio, mas quando tem um, quem abre o negócio precisa ver — senão a
 * pessoa fecha a venda sem saber que já mandou proposta, ou manda a segunda.
 *
 * Reusa a MESMA linha e o MESMO painel da página de Orçamentos. Uma segunda
 * versão da linha divergiria no primeiro ajuste, e aí o mesmo orçamento
 * apareceria diferente conforme o caminho por onde se chega nele.
 */
export function OrcamentosDoNegocio({
  dealId,
  contactId,
}: {
  dealId: string;
  contactId: string | null;
}) {
  const { data: orcamentos = [], isLoading } = useOrcamentosDoNegocio(dealId);
  const [construindo, setConstruindo] = useState<OrcamentoComRelacoes | "novo" | null>(null);
  const [noPainel, setNoPainel] = useState<OrcamentoComRelacoes | null>(null);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="vx-titulo-secao">
          Orçamentos
          {orcamentos.length > 0 && (
            <span className="ml-1.5 text-label font-normal tabular-nums text-muted-foreground">
              {orcamentos.length}
            </span>
          )}
        </h3>
        <Button
          variant="outline" size="sm" className="h-8 text-label"
          // Sem contato não há orçamento: a coluna é NOT NULL, e o vínculo é o
          // que faz a decisão do cliente entrar no histórico de alguém.
          disabled={!contactId}
          title={contactId ? undefined : "Vincule um contato ao negócio primeiro"}
          onClick={() => setConstruindo("novo")}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />Novo
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-16 rounded-lg" />
      ) : orcamentos.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
          <Receipt className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          Nenhum orçamento para este negócio.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {orcamentos.map((o) => (
              <LinhaDeOrcamento key={o.id} orcamento={o} aoAbrir={setNoPainel} />
            ))}
          </ul>
        </div>
      )}

      <ConstrutorDeOrcamento
        aberto={construindo !== null}
        orcamento={construindo === "novo" ? null : construindo}
        dealId={dealId}
        contactIdInicial={contactId}
        aoFechar={() => setConstruindo(null)}
      />

      <PainelDeOrcamento
        orcamento={noPainel}
        aoFechar={() => setNoPainel(null)}
        aoEditar={(o) => { setNoPainel(null); setConstruindo(o); }}
      />
    </section>
  );
}
