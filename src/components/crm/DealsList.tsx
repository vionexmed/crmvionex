import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Trophy, XCircle, Trash2, AlertTriangle } from "lucide-react";
import type { DealWithRelations } from "@/lib/api/deals";
import type { Database } from "@/integrations/supabase/types";
import { SortHeader, useOrdenacao } from "@/components/layout/SortHeader";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { SeloDeNegocio } from "@/components/crm/SeloDeNegocio";
import { BarraDeSelecao } from "@/components/layout/BarraDeAcoes";

type Stage = Database["public"]["Tables"]["pipeline_stages"]["Row"];


type SortKey = "title" | "value" | "close_date" | "probability" | "status" | "created_at";

interface DealsListProps {
  deals: DealWithRelations[];
  stages: Stage[];
  selectedDeals: Set<string>;
  onSelectionChange: (s: Set<string>) => void;
  onDealClick: (d: DealWithRelations) => void;
  onBatchAction: (action: "won" | "lost" | "delete") => void;
  /** Exclusão em lote é restrita a admin/owner */
  canDelete?: boolean;
}

export function DealsList({
  deals, stages, selectedDeals, onSelectionChange, onDealClick, onBatchAction,
  canDelete = true,
}: DealsListProps) {
  const { sortKey, sortDir, toggleSort } = useOrdenacao<SortKey>("created_at");


  const sorted = [...deals].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "title": cmp = (a.title || "").localeCompare(b.title || ""); break;
      case "value": cmp = (Number(a.value) || 0) - (Number(b.value) || 0); break;
      case "probability": cmp = (Number(a.probability) || 0) - (Number(b.probability) || 0); break;
      case "close_date": cmp = (a.close_date || "").localeCompare(b.close_date || ""); break;
      case "status": cmp = (a.status || "").localeCompare(b.status || ""); break;
      case "created_at": cmp = (a.created_at || "").localeCompare(b.created_at || ""); break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const allSelected = sorted.length > 0 && sorted.every((d) => selectedDeals.has(d.id));
  const toggleAll = () => {
    if (allSelected) onSelectionChange(new Set());
    else onSelectionChange(new Set(sorted.map((d) => d.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedDeals);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const getStageName = (stageId: string | null) => {
    if (!stageId) return "—";
    return stages.find((s) => s.id === stageId)?.name || "—";
  };

  return (
    <div className="space-y-3">
      {selectedDeals.size > 0 && (
        <BarraDeSelecao
          quantidade={selectedDeals.size}
          substantivo="negócio"
          substantivoPlural="negócios"
          onLimpar={() => onSelectionChange(new Set())}
        >
          <Button size="sm" variant="outline" onClick={() => onBatchAction("won")}>
            <Trophy className="mr-1 h-3.5 w-3.5 text-success" />Ganhos
          </Button>
          <Button size="sm" variant="outline" onClick={() => onBatchAction("lost")}>
            <XCircle className="mr-1 h-3.5 w-3.5 text-destructive" />Perdidos
          </Button>
          {canDelete && (
            <Button size="sm" variant="destructive" onClick={() => onBatchAction("delete")}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />Excluir
            </Button>
          )}
        </BarraDeSelecao>
      )}

      <div className="vx-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar todos" />
              </TableHead>
              <TableHead><SortHeader rotulo="Título" campo="title" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
              <TableHead><SortHeader rotulo="Valor" campo="value" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
              <TableHead className="hidden md:table-cell">Etapa</TableHead>
              <TableHead className="hidden lg:table-cell"><SortHeader rotulo="Probabilidade" campo="probability" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
              <TableHead className="hidden sm:table-cell"><SortHeader rotulo="Fechamento" campo="close_date" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
              <TableHead><SortHeader rotulo="Status" campo="status" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
              <TableHead className="hidden lg:table-cell">Responsável</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((deal) => {
              const daysUntilClose = deal.close_date
                ? Math.ceil((new Date(deal.close_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : null;
              const isUrgent = daysUntilClose !== null && daysUntilClose < 7 && daysUntilClose >= 0;

              return (
                <TableRow key={deal.id} className="cursor-pointer" onClick={() => onDealClick(deal)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selectedDeals.has(deal.id)} onCheckedChange={() => toggleOne(deal.id)} />
                  </TableCell>
                  <TableCell>
                    <div>
                      <span className="font-medium">{deal.title}</span>
                      {deal.company && <p className="text-xs text-muted-foreground">{deal.company.name}</p>}
                    </div>
                  </TableCell>
                  <TableCell className="font-semibold text-primary">
                    {formatarMoeda(Number(deal.value) || 0, deal.currency || "BRL")}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell">{getStageName(deal.stage_id)}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {(deal.probability ?? 0) > 0 && (
                      <Badge variant="secondary" className="text-xs">{deal.probability}%</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {deal.close_date ? (
                      <div className={`flex items-center gap-1 text-sm ${isUrgent ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {isUrgent && <AlertTriangle className="h-3 w-3" />}
                        {formatarData(deal.close_date)}
                      </div>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    {/* Esta lista pintava "Aberto" de teal; as outras três
                        telas deixavam neutro. Aberto é o estado PADRÃO --
                        destacá-lo compete com "Ganho" e "Perdido", que são os
                        que merecem cor. */}
                    <SeloDeNegocio status={deal.status} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {deal.owner ? (
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={deal.owner.avatar_url || ""} />
                          <AvatarFallback className="bg-primary/10 text-primary text-label">
                            {deal.owner.name?.charAt(0)?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-muted-foreground">{deal.owner.name}</span>
                      </div>
                    ) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Nenhum negócio encontrado
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
