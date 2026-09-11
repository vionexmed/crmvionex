import { useState } from "react";
import { Pencil, Trash2, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { mensagemErro } from "@/lib/erro-supabase";
import { formatarDataHoraCurta } from "@/lib/formato";
import { ATIVIDADE_ICONE, ATIVIDADE_ROTULO, type ActivityType } from "@/lib/atividade-tipos";

/**
 * Uma linha do histórico, com o que faltava: corrigir e apagar.
 *
 * A ficha do contato mostrava atividade e nota em modo leitura. Teste de
 * alinhamento e erro de digitação entravam no histórico do lead e não saíam
 * mais -- e, pior, ENTRAVAM NA MÉTRICA: atividade concluída conta em
 * "Abordagens realizadas". Para limpar era preciso sair da ficha, achar a linha
 * na tela de Atividades e apagar de lá.
 *
 * Mora em arquivo próprio porque serve DUAS abas da mesma gaveta (Atividades e
 * Notas) e porque o ContactDrawer já passa de 600 linhas.
 */
export function LinhaDeAtividade({
  atividade,
  aoSalvar,
  aoExcluir,
  mostrarTipo = true,
}: {
  atividade: { id: string; type: ActivityType; title: string | null; body: string | null; created_at: string | null };
  aoSalvar: (patch: { title: string; body: string | null }) => Promise<void>;
  aoExcluir: () => Promise<void>;
  /** A aba Notas já sabe que tudo ali é nota; repetir o rótulo só ocupa linha. */
  mostrarTipo?: boolean;
}) {
  const { toast } = useToast();
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [titulo, setTitulo] = useState(atividade.title ?? "");
  const [corpo, setCorpo] = useState(atividade.body ?? "");

  const Icone = ATIVIDADE_ICONE[atividade.type];

  const salvar = async () => {
    const limpo = titulo.trim();
    if (!limpo) {
      toast({ title: "O título não pode ficar vazio", variant: "destructive" });
      return;
    }
    setOcupado(true);
    try {
      await aoSalvar({ title: limpo, body: corpo.trim() || null });
      setEditando(false);
      toast({ title: "Atividade atualizada" });
    } catch (e: unknown) {
      toast({ title: "Não foi possível salvar", description: mensagemErro(e), variant: "destructive" });
    } finally {
      setOcupado(false);
    }
  };

  const excluir = async () => {
    setOcupado(true);
    try {
      await aoExcluir();
      toast({ title: "Atividade excluída" });
    } catch (e: unknown) {
      // A mensagem importa: apagar linha recusada pela RLS devolvia sucesso e a
      // nota reaparecia sozinha. Ver `activitiesApi.deleteMany`.
      toast({ title: "Não foi possível excluir", description: mensagemErro(e), variant: "destructive" });
      setOcupado(false);
    }
  };

  const cancelar = () => {
    setTitulo(atividade.title ?? "");
    setCorpo(atividade.body ?? "");
    setEditando(false);
  };

  return (
    <div className="flex gap-3 rounded-lg border border-border p-3">
      {mostrarTipo && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <Icone className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2">
          {mostrarTipo && (
            <span className="text-label font-medium uppercase text-muted-foreground">
              {ATIVIDADE_ROTULO[atividade.type]}
            </span>
          )}
          <span className="text-label text-muted-foreground">
            {atividade.created_at ? formatarDataHoraCurta(atividade.created_at) : ""}
          </span>
        </div>

        {editando ? (
          <div className="space-y-2">
            <Input
              className="h-8 text-sm"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              aria-label="Título da atividade"
            />
            <Textarea
              rows={2}
              className="text-xs"
              value={corpo}
              onChange={(e) => setCorpo(e.target.value)}
              placeholder="Descrição…"
              aria-label="Descrição da atividade"
            />
            <div className="flex gap-2">
              <Button size="sm" className="h-8 text-label" onClick={salvar} disabled={ocupado}>
                {ocupado ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                Salvar
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-label" onClick={cancelar} disabled={ocupado}>
                <X className="mr-1 h-3 w-3" />Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium">{atividade.title}</p>
            {atividade.body && <p className="mt-0.5 text-xs text-muted-foreground">{atividade.body}</p>}
          </>
        )}
      </div>

      {!editando && (
        <div className="flex shrink-0 gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => setEditando(true)}
            aria-label={`Editar ${ATIVIDADE_ROTULO[atividade.type].toLowerCase()}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={excluir}
            disabled={ocupado}
            aria-label={`Excluir ${ATIVIDADE_ROTULO[atividade.type].toLowerCase()}`}
          >
            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      )}
    </div>
  );
}
