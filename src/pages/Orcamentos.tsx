import { useMemo, useState } from "react";
import { Plus, Search, Receipt } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { BarraDeFiltros } from "@/components/layout/BarraDeAcoes";
import { SegmentedControl } from "@/components/layout/SegmentedControl";
import { LoadingState, ErrorState, EmptyState } from "@/components/layout/EstadoDaLista";
import { SemOrganizacao } from "@/components/layout/SemOrganizacao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOrg } from "@/hooks/useOrg";
import { useOrcamentos } from "@/hooks/queries/useOrcamentos";
import { ConstrutorDeOrcamento } from "@/components/orcamentos/ConstrutorDeOrcamento";
import { LinhaDeOrcamento } from "@/components/orcamentos/LinhaDeOrcamento";
import { PainelDeOrcamento } from "@/components/orcamentos/PainelDeOrcamento";
import type { OrcamentoComRelacoes } from "@/lib/api/orcamentos";
import { nomeDoContato } from "@/lib/contato-formato";
import { pluralizar } from "@/lib/formato";

/** Os cinco estados, em ordem de ciclo. `expirado` é derivado, não digitado. */
type Filtro = "todos" | "rascunho" | "enviado" | "aprovado" | "recusado";

export default function Orcamentos() {
  const { orgId } = useOrg();
  const { data: orcamentos = [], isLoading, isError, refetch } = useOrcamentos();

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [construindo, setConstruindo] = useState<OrcamentoComRelacoes | "novo" | null>(null);
  const [noPainel, setNoPainel] = useState<OrcamentoComRelacoes | null>(null);

  const termo = busca.trim().toLowerCase();

  const visiveis = useMemo(
    () =>
      orcamentos.filter((o) => {
        if (filtro !== "todos" && o.status !== filtro) return false;
        if (!termo) return true;
        const pessoa = o.contact
          ? nomeDoContato(o.contact.first_name, o.contact.last_name)
          : "";
        // Número, pessoa, empresa e título: são as quatro formas de alguém se
        // referir a um orçamento ao telefone.
        return `${o.numero} ${pessoa} ${o.company?.name ?? ""} ${o.titulo ?? ""}`
          .toLowerCase().includes(termo);
      }),
    [orcamentos, filtro, termo],
  );

  if (!orgId) return <SemOrganizacao />;

  return (
    <PageShell
      title="Orçamentos"
      contagem={{ valor: visiveis.length, unidade: "orçamento" }}
      actions={
        <Button size="sm" onClick={() => setConstruindo("novo")}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />Orçamento
        </Button>
      }
    >
      <BarraDeFiltros className="mt-1">
        <SegmentedControl<Filtro>
          rotuloGrupo="Situação do orçamento"
          valor={filtro}
          onChange={setFiltro}
          opcoes={[
            { valor: "todos", rotulo: "Todos" },
            { valor: "rascunho", rotulo: "Rascunho" },
            { valor: "enviado", rotulo: "Enviados" },
            { valor: "aprovado", rotulo: "Aprovados" },
            { valor: "recusado", rotulo: "Recusados" },
          ]}
        />
        <div className="relative ml-auto sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Número, pessoa ou empresa"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </BarraDeFiltros>

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState descricao="" onTentarNovamente={() => refetch()} />
      ) : visiveis.length === 0 ? (
        <EmptyState
          icone={Receipt}
          titulo={
            orcamentos.length === 0
              ? "Nenhum orçamento ainda"
              : termo
                ? `Nada encontrado para “${busca.trim()}”`
                : "Nenhum orçamento neste estado"
          }
          descricao={
            orcamentos.length === 0
              ? "Monte um a partir do catálogo e envie o link para o cliente aprovar."
              : `Há ${orcamentos.length} ${pluralizar(orcamentos.length, "orçamento")} no total.`
          }
          acao={
            orcamentos.length === 0 ? (
              <Button variant="outline" size="sm" onClick={() => setConstruindo("novo")}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />Criar orçamento
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => { setBusca(""); setFiltro("todos"); }}>
                Ver todos ({orcamentos.length})
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <ul className="divide-y divide-border">
            {visiveis.map((o) => (
              <LinhaDeOrcamento key={o.id} orcamento={o} aoAbrir={setNoPainel} />
            ))}
          </ul>
        </div>
      )}

      <ConstrutorDeOrcamento
        aberto={construindo !== null}
        orcamento={construindo === "novo" ? null : construindo}
        aoFechar={() => setConstruindo(null)}
      />

      <PainelDeOrcamento
        orcamento={noPainel}
        aoFechar={() => setNoPainel(null)}
        aoEditar={(o) => { setNoPainel(null); setConstruindo(o); }}
      />
    </PageShell>
  );
}
