import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2, Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { SeletorDeContato } from "@/components/crm/SeletorDeContato";
import { useToast } from "@/hooks/use-toast";
import { mensagemErro } from "@/lib/erro-supabase";
import { formatarMoeda } from "@/lib/formato";
import { useAllContacts } from "@/hooks/queries/useContacts";
import { useProdutos } from "@/hooks/queries/useProdutos";
import { useCriarOrcamento, useAtualizarOrcamento, useTrocarItens } from "@/hooks/queries/useOrcamentos";
import {
  itemDeProduto, totalDoItem, totaisDoOrcamento,
  type ItemNovo, type OrcamentoComRelacoes,
} from "@/lib/api/orcamentos";

/** O item vazio, para quem quer cobrar algo que não está no catálogo. */
const ITEM_LIVRE: ItemNovo = {
  produto_id: null, nome: "", descricao: null, unidade: "un",
  preco_unit: 0, quantidade: 1, desconto: 0,
};

/**
 * Monta e edita um orçamento.
 *
 * O CATÁLOGO É ATALHO, NÃO AMARRA. Escolher um produto COPIA nome, unidade e
 * preço para o item -- e a partir dali o item é dele. Dar desconto numa linha
 * não mexe no catálogo, e corrigir o catálogo depois não mexe neste orçamento.
 * É a regra que faz um orçamento aprovado continuar valendo o que o cliente
 * aprovou.
 *
 * Por isso também existe o item livre: nem tudo que se cobra está cadastrado, e
 * obrigar a cadastrar para orçar transformaria o catálogo num pedágio.
 */
export function ConstrutorDeOrcamento({
  aberto,
  orcamento,
  dealId,
  contactIdInicial,
  aoFechar,
}: {
  aberto: boolean;
  /** `null` cria; um orçamento edita. */
  orcamento: OrcamentoComRelacoes | null;
  /** Preenchido quando o construtor abre a partir de um negócio. */
  dealId?: string | null;
  contactIdInicial?: string | null;
  aoFechar: () => void;
}) {
  const { toast } = useToast();
  const { data: contatos = [] } = useAllContacts();
  const { data: produtos = [] } = useProdutos(true);
  const criar = useCriarOrcamento();
  const atualizar = useAtualizarOrcamento();
  const trocarItens = useTrocarItens();

  const [titulo, setTitulo] = useState("");
  const [contactId, setContactId] = useState("");
  const [validoAte, setValidoAte] = useState("");
  const [desconto, setDesconto] = useState("0");
  const [observacoes, setObservacoes] = useState("");
  const [itens, setItens] = useState<ItemNovo[]>([]);
  const [catalogoAberto, setCatalogoAberto] = useState(false);

  const editando = !!orcamento;

  useEffect(() => {
    if (!aberto) return;
    if (orcamento) {
      setTitulo(orcamento.titulo ?? "");
      setContactId(orcamento.contact_id);
      setValidoAte(orcamento.valido_ate ?? "");
      setDesconto(String(orcamento.desconto ?? 0));
      setObservacoes(orcamento.observacoes ?? "");
      setItens(
        (orcamento.itens ?? []).map((i) => ({
          produto_id: i.produto_id,
          nome: i.nome,
          descricao: i.descricao,
          unidade: i.unidade,
          preco_unit: Number(i.preco_unit),
          quantidade: Number(i.quantidade),
          desconto: Number(i.desconto),
        })),
      );
    } else {
      setTitulo("");
      setContactId(contactIdInicial ?? "");
      setValidoAte("");
      setDesconto("0");
      setObservacoes("");
      setItens([]);
    }
  }, [aberto, orcamento, contactIdInicial]);

  const totais = useMemo(
    () => totaisDoOrcamento(itens, Number(String(desconto).replace(",", ".")) || 0),
    [itens, desconto],
  );

  const contatoEscolhido = contatos.find((c) => c.id === contactId);

  const mudarItem = (i: number, patch: Partial<ItemNovo>) =>
    setItens((lista) => lista.map((item, j) => (j === i ? { ...item, ...patch } : item)));

  const salvar = async () => {
    if (!contactId) {
      toast({
        title: "Escolha o contato",
        // Não é validação de formulário: a coluna é NOT NULL, e o vínculo é o
        // que faz a decisão do cliente aparecer na ficha dele.
        description: "Todo orçamento pertence a alguém — é assim que ele entra no histórico da pessoa.",
        variant: "destructive",
      });
      return;
    }
    if (itens.length === 0) {
      toast({ title: "Acrescente ao menos um item", variant: "destructive" });
      return;
    }
    const semNome = itens.findIndex((i) => !i.nome.trim());
    if (semNome >= 0) {
      toast({ title: `O item ${semNome + 1} está sem nome`, variant: "destructive" });
      return;
    }

    const dados = {
      titulo: titulo.trim() || null,
      contact_id: contactId,
      company_id: contatoEscolhido?.company_id ?? null,
      deal_id: dealId ?? orcamento?.deal_id ?? null,
      valido_ate: validoAte || null,
      desconto: totais.desconto,
      observacoes: observacoes.trim() || null,
    };

    try {
      if (orcamento) {
        await atualizar.mutateAsync({ id: orcamento.id, patch: dados });
        await trocarItens.mutateAsync({ id: orcamento.id, itens });
        toast({ title: `Orçamento #${orcamento.numero} atualizado` });
      } else {
        const novo = await criar.mutateAsync({ dados, itens });
        toast({ title: `Orçamento #${novo.numero} criado`, description: "Envie o link para o cliente aprovar." });
      }
      aoFechar();
    } catch (e: unknown) {
      toast({ title: "Não foi possível salvar", description: mensagemErro(e), variant: "destructive" });
    }
  };

  const salvando = criar.isPending || atualizar.isPending || trocarItens.isPending;

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {editando ? `Orçamento #${orcamento.numero}` : "Novo orçamento"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            O preço de cada item é copiado do catálogo no momento em que ele entra. Mudar o
            catálogo depois não altera este orçamento.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Contato *</Label>
              <SeletorDeContato
                contatos={contatos}
                valor={contactId}
                aoMudar={setContactId}
                placeholder="Para quem é este orçamento"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Título</Label>
              <Input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Tratamento completo"
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* ── Itens ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Itens</Label>
              <div className="flex gap-2">
                <Popover open={catalogoAberto} onOpenChange={setCatalogoAberto}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-label">
                      <Search className="mr-1 h-3.5 w-3.5" />Do catálogo
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[320px] p-0" align="end">
                    <Command>
                      <CommandInput placeholder="Buscar produto…" className="h-9 text-xs" />
                      <CommandList>
                        <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">
                          {produtos.length === 0
                            ? "Nenhum produto ativo no catálogo."
                            : "Nada encontrado."}
                        </CommandEmpty>
                        <CommandGroup>
                          {produtos.map((p) => (
                            <CommandItem
                              key={p.id}
                              value={`${p.nome} ${p.sku ?? ""} ${p.id}`}
                              onSelect={() => {
                                setItens((l) => [...l, itemDeProduto(p)]);
                                setCatalogoAberto(false);
                              }}
                              className="text-xs"
                            >
                              <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                              <span className="ml-2 shrink-0 tabular-nums text-muted-foreground">
                                {formatarMoeda(Number(p.preco), p.moeda)}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                <Button variant="outline" size="sm" className="h-8 text-label"
                  onClick={() => setItens((l) => [...l, { ...ITEM_LIVRE }])}>
                  <Plus className="mr-1 h-3.5 w-3.5" />Item livre
                </Button>
              </div>
            </div>

            {itens.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
                Nenhum item ainda. Escolha do catálogo ou acrescente um item livre.
              </p>
            ) : (
              <div className="space-y-2">
                {itens.map((item, i) => (
                  <div key={i} className="grid grid-cols-[1fr_72px_96px_96px_32px] items-end gap-2 rounded-lg border border-border p-2">
                    <div className="min-w-0 space-y-1">
                      <Input
                        value={item.nome}
                        onChange={(e) => mudarItem(i, { nome: e.target.value })}
                        placeholder="Nome do item"
                        className="h-8 text-xs"
                      />
                      {item.descricao && (
                        <p className="truncate text-label text-muted-foreground">{item.descricao}</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-label text-muted-foreground">Qtd</Label>
                      <Input
                        value={item.quantidade}
                        onChange={(e) => mudarItem(i, { quantidade: Number(e.target.value.replace(",", ".")) || 0 })}
                        inputMode="decimal"
                        className="h-8 text-xs tabular-nums"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-label text-muted-foreground">Unitário</Label>
                      <Input
                        value={item.preco_unit}
                        onChange={(e) => mudarItem(i, { preco_unit: Number(e.target.value.replace(",", ".")) || 0 })}
                        inputMode="decimal"
                        className="h-8 text-xs tabular-nums"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-label text-muted-foreground">Total</Label>
                      <p className="flex h-8 items-center justify-end text-xs font-semibold tabular-nums">
                        {formatarMoeda(totalDoItem(item))}
                      </p>
                    </div>
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      aria-label={`Remover ${item.nome || `item ${i + 1}`}`}
                      onClick={() => setItens((l) => l.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Fecho ── */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Válido até</Label>
                <Input
                  type="date"
                  value={validoAte}
                  onChange={(e) => setValidoAte(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Observações internas</Label>
                <Textarea
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  placeholder="Só o time vê — não aparece para o cliente"
                  className="min-h-[60px] text-xs"
                />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatarMoeda(totais.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Desconto</span>
                <Input
                  value={desconto}
                  onChange={(e) => setDesconto(e.target.value)}
                  inputMode="decimal"
                  /* `h-8` e não `h-7`: 32px e o piso de alvo de toque do
                     projeto, e um campo de 28px e dificil de acertar no celular. */
                  className="h-8 w-28 text-right text-xs tabular-nums"
                />
              </div>
              {/* O desconto é limitado ao subtotal na função de cálculo: "tiro
                  500" num orçamento de 300 é erro de digitação, e o total
                  negativo iria para a página do cliente. */}
              {Number(String(desconto).replace(",", ".")) > totais.subtotal && (
                <p className="text-label text-warning">
                  Desconto maior que o subtotal — aplicando {formatarMoeda(totais.desconto)}.
                </p>
              )}
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="text-xs font-semibold">Total</span>
                <span className="font-heading text-lg font-bold tabular-nums">
                  {formatarMoeda(totais.total)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8 text-label" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button size="sm" className="h-8 text-label" onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {editando ? "Salvar" : "Criar orçamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
