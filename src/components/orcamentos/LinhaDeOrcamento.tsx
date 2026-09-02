import { ChevronRight } from "lucide-react";
import { formatarMoeda, formatarDataCurta } from "@/lib/formato";
import { nomeDoContato } from "@/lib/contato-formato";
import { totaisDoOrcamento, type OrcamentoComRelacoes } from "@/lib/api/orcamentos";
import { SeloDeOrcamento } from "@/components/orcamentos/SeloDeOrcamento";

/**
 * Uma linha da lista de orçamentos.
 *
 * O TOTAL É RECALCULADO dos itens, e não lido de uma coluna. Não existe coluna
 * de total na tabela de propósito: um número gravado e um número somado
 * divergem no dia em que alguém edita um item e a gravação do total falha --
 * e aí a lista mostra um valor e o orçamento aberto mostra outro. A soma sai de
 * `totaisDoOrcamento`, a mesma que o construtor e a página do cliente usam.
 */
export function LinhaDeOrcamento({
  orcamento,
  aoAbrir,
}: {
  orcamento: OrcamentoComRelacoes;
  aoAbrir: (o: OrcamentoComRelacoes) => void;
}) {
  const itens = (orcamento.itens ?? []).map((i) => ({
    preco_unit: Number(i.preco_unit),
    quantidade: Number(i.quantidade),
    desconto: Number(i.desconto),
  }));
  const { total } = totaisDoOrcamento(itens, Number(orcamento.desconto) || 0);

  const pessoa = orcamento.contact
    ? nomeDoContato(orcamento.contact.first_name, orcamento.contact.last_name)
    : "Sem contato";

  return (
    <li>
      <button
        type="button"
        onClick={() => aoAbrir(orcamento)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
      >
        <span className="w-12 shrink-0 text-label font-semibold tabular-nums text-muted-foreground">
          #{orcamento.numero}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {orcamento.titulo || pessoa}
          </span>
          <span className="block truncate text-label text-muted-foreground">
            {orcamento.titulo ? pessoa : orcamento.company?.name || "—"}
            {orcamento.company?.name && orcamento.titulo && ` · ${orcamento.company.name}`}
          </span>
        </span>

        <SeloDeOrcamento orcamento={orcamento} />

        <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums">
          {formatarMoeda(total, orcamento.moeda)}
        </span>

        <span className="hidden w-20 shrink-0 text-right text-label tabular-nums text-muted-foreground sm:block">
          {orcamento.valido_ate ? formatarDataCurta(orcamento.valido_ate) : "—"}
        </span>

        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
      </button>
    </li>
  );
}
