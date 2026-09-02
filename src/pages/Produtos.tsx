import { useMemo, useState } from "react";
import { Plus, Search, Package } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { BarraDeFiltros } from "@/components/layout/BarraDeAcoes";
import { SegmentedControl } from "@/components/layout/SegmentedControl";
import { LoadingState, ErrorState, EmptyState } from "@/components/layout/EstadoDaLista";
import { SemOrganizacao } from "@/components/layout/SemOrganizacao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOrg } from "@/hooks/useOrg";
import { useProdutos } from "@/hooks/queries/useProdutos";
import { CartaoDeProduto } from "@/components/produtos/CartaoDeProduto";
import { FormularioDeProduto } from "@/components/produtos/FormularioDeProduto";
import type { Produto } from "@/lib/api/produtos";
import { pluralizar } from "@/lib/formato";

type Filtro = "todos" | "ativos" | "inativos";

export default function Produtos() {
  const { orgId } = useOrg();
  const { data: produtos = [], isLoading, isError, refetch } = useProdutos();

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  /** `null` = fechado. Um produto = editando aquele. `"novo"` = criando. */
  const [emEdicao, setEmEdicao] = useState<Produto | "novo" | null>(null);

  const termo = busca.trim().toLowerCase();

  const visiveis = useMemo(
    () =>
      produtos.filter((p) => {
        if (filtro === "ativos" && !p.ativo) return false;
        if (filtro === "inativos" && p.ativo) return false;
        if (!termo) return true;
        // Nome, descrição e SKU: quem procura um produto lembra de um dos três,
        // e num catálogo o código costuma ser o mais rápido de digitar.
        return `${p.nome} ${p.descricao ?? ""} ${p.sku ?? ""}`.toLowerCase().includes(termo);
      }),
    [produtos, filtro, termo],
  );

  if (!orgId) return <SemOrganizacao />;

  return (
    <PageShell
      title="Produtos"
      contagem={{ valor: visiveis.length, unidade: "produto" }}
      actions={
        <Button size="sm" onClick={() => setEmEdicao("novo")}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />Produto
        </Button>
      }
    >
      <BarraDeFiltros className="mt-1">
        <SegmentedControl<Filtro>
          rotuloGrupo="Situação do produto"
          valor={filtro}
          onChange={setFiltro}
          opcoes={[
            { valor: "todos", rotulo: "Todos" },
            { valor: "ativos", rotulo: "Ativos" },
            { valor: "inativos", rotulo: "Inativos" },
          ]}
        />
        <div className="relative ml-auto sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou código"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </BarraDeFiltros>

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState descricao="" onTentarNovamente={() => refetch()} />
      ) : visiveis.length === 0 ? (
        /*
          Três situações, três respostas — o mesmo erro que a tela de Atividades
          tinha, onde "nada encontrado" aparecia com dez atividades no banco.
        */
        <EmptyState
          icone={Package}
          titulo={
            produtos.length === 0
              ? "Nenhum produto cadastrado"
              : termo
                ? `Nada encontrado para “${busca.trim()}”`
                : `Nenhum produto ${filtro === "ativos" ? "ativo" : "inativo"}`
          }
          descricao={
            produtos.length === 0
              ? "Cadastre o que você vende para montar orçamento a partir do catálogo."
              : `Há ${produtos.length} ${pluralizar(produtos.length, "produto")} no total.`
          }
          acao={
            produtos.length === 0 ? (
              <Button variant="outline" size="sm" onClick={() => setEmEdicao("novo")}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />Cadastrar produto
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => { setBusca(""); setFiltro("todos"); }}>
                Ver todos ({produtos.length})
              </Button>
            )
          }
        />
      ) : (
        /* Quatro colunas em tela larga: com a foto em 4/3, colunas mais largas
           dariam foto grande e catálogo curto na tela. */
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visiveis.map((p) => (
            <CartaoDeProduto key={p.id} produto={p} aoClicar={setEmEdicao} />
          ))}
        </div>
      )}

      <FormularioDeProduto
        aberto={emEdicao !== null}
        produto={emEdicao === "novo" ? null : emEdicao}
        aoFechar={() => setEmEdicao(null)}
      />
    </PageShell>
  );
}
