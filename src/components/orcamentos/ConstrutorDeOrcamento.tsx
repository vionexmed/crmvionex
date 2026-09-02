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

/**
 * O item ENQUANTO SE DIGITA — com os números como texto.
 *
 * Guardar `number` e converter a cada tecla quebra a digitação de decimal: com
 * `Number(v.replace(",", ".")) || 0`, escrever "1,5" mostra "1" no momento em
 * que a vírgula é digitada, e apagar o campo trava em "0" (não dá para limpar
 * para começar de novo).
 *
 * É o mesmo cuidado que o formulário de produto já documenta. A conversão
 * acontece UMA vez, ao calcular e ao salvar.
 */
type ItemEmEdicao = {
  produto_id: string | null;
  nome: string;
  descricao: string | null;
  unidade: string;
  preco_unit: string;
  quantidade: string;
  desconto: string;
};

/** Aceita vírgula ou ponto; campo vazio vale zero, sem forçar "0" na tela. */
const num = (v: string) => Number(String(v).replace(",", ".")) || 0;

const paraCalculo = (i: ItemEmEdicao) => ({
  preco_unit: num(i.preco_unit),
  quantidade: num(i.quantidade),
  desconto: num(i.desconto),
});

const paraGravar = (i: ItemEmEdicao): ItemNovo => ({
  produto_id: i.produto_id,
  nome: i.nome.trim(),
  descricao: i.descricao,
  unidade: i.unidade.trim() || "un",
  ...paraCalculo(i),
});

/** O item vazio, para quem quer cobrar algo que não está no catálogo. */
const ITEM_LIVRE: ItemEmEdicao = {
  produto_id: null, nome: "", descricao: null, unidade: "un",
  preco_unit: "", quantidade: "1", desconto: "",
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
  const [itens, setItens] = useState<ItemEmEdicao[]>([]);
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
          preco_unit: String(i.preco_unit),
          quantidade: String(i.quantidade),
          // Zero vira campo VAZIO: "0" no campo de desconto sugere que há um,
          // e obriga a apagar antes de escrever.
          desconto: Number(i.desconto) ? String(i.desconto) : "",
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
    () => totaisDoOrcamento(itens.map(paraCalculo), num(desconto)),
    [itens, desconto],
  );

  const contatoEscolhido = contatos.find((c) => c.id === contactId);

  const mudarItem = (i: number, patch: Partial<ItemEmEdicao>) =>
    setItens((lista) => lista.map((item, j) => (j === i ? { ...item, ...patch } : item)));

  const salvar = async () => {
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
      // O seletor devolve "none" para a opção vazia.
      contact_id: contactId && contactId !== "none" ? contactId : null,
      company_id: contatoEscolhido?.company_id ?? null,
      deal_id: dealId ?? orcamento?.deal_id ?? null,
      valido_ate: validoAte || null,
      desconto: totais.desconto,
      observacoes: observacoes.trim() || null,
    };

    try {
      if (orcamento) {
        await atualizar.mutateAsync({ id: orcamento.id, patch: dados });
        await trocarItens.mutateAsync({ id: orcamento.id, itens: itens.map(paraGravar) });
        toast({ title: `Orçamento #${orcamento.numero} atualizado` });
      } else {
        const novo = await criar.mutateAsync({ dados, itens: itens.map(paraGravar) });
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
              <Label className="text-xs">Contato</Label>
              <SeletorDeContato
                contatos={contatos}
                valor={contactId}
                aoMudar={setContactId}
                permitirNenhum
                rotuloNenhum="Sem contato"
                placeholder="Para quem é este orçamento"
                className="h-8 text-xs"
              />
              {/* DIZ O QUE MUDA, em vez de só permitir.
                  Sem contato o orçamento funciona igual -- gera link, é
                  aprovado, guarda quem respondeu. O que não acontece é o eco na
                  ficha da pessoa, e quem escolhe merece saber disso antes. */}
              <p className="text-label leading-relaxed text-muted-foreground">
                {contactId && contactId !== "none"
                  ? "A resposta do cliente vai aparecer no histórico dele."
                  : "Sem contato o orçamento funciona igual — só não entra no histórico de ninguém."}
              </p>
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
                                const novo = itemDeProduto(p);
                                setItens((l) => [
                                  ...l,
                                  {
                                    ...novo,
                                    preco_unit: String(novo.preco_unit),
                                    quantidade: String(novo.quantidade),
                                    desconto: "",
                                  },
                                ]);
                                /* NAO fecha. Montar orcamento e escolher varios
                                   produtos seguidos, e fechar a cada um obrigava
                                   a reabrir e rebuscar -- quatro cliques por
                                   item em vez de um. */
                              }}
                              className="gap-2 text-xs"
                            >
                              {/* A FOTO, que o catalogo ja tem. Sem ela a busca
                                  vira uma lista de nomes, e produto se
                                  reconhece pela imagem antes do nome. */}
                              {p.foto_url ? (
                                <img
                                  src={p.foto_url}
                                  alt=""
                                  loading="lazy"
                                  className="h-7 w-7 shrink-0 rounded-md object-cover"
                                />
                              ) : (
                                <span className="h-7 w-7 shrink-0 rounded-md bg-muted" />
                              )}
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
                  /*
                    UMA LINHA NO DESKTOP, EMPILHADO NO CELULAR.

                    Era uma grade fixa de cinco colunas, e a de nome ficava com
                    ~90px num telefone -- espremida demais para ler o que se
                    está cobrando. Agora os campos numericos quebram para baixo
                    e o nome fica com a largura inteira.

                    Os rotulos aparecem uma vez, no cabecalho, e nao em cada
                    linha: repetir "Qtd / Unitario / Total" em dez itens e dez
                    vezes o mesmo texto competindo com o que muda.
                  */
                  <div key={i} className="rounded-lg border border-border p-2">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
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
                      <Button
                        variant="ghost" size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Remover ${item.nome || `item ${i + 1}`}`}
                        onClick={() => setItens((l) => l.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Input
                        value={item.quantidade}
                        onChange={(e) => mudarItem(i, { quantidade: e.target.value })}
                        inputMode="decimal"
                        aria-label={`Quantidade do item ${i + 1}`}
                        placeholder="Qtd"
                        className="h-8 text-xs tabular-nums"
                      />
                      <Input
                        value={item.unidade}
                        onChange={(e) => mudarItem(i, { unidade: e.target.value })}
                        aria-label={`Unidade do item ${i + 1}`}
                        placeholder="un"
                        className="h-8 text-xs"
                      />
                      <Input
                        value={item.preco_unit}
                        onChange={(e) => mudarItem(i, { preco_unit: e.target.value })}
                        inputMode="decimal"
                        aria-label={`Preco unitario do item ${i + 1}`}
                        placeholder="Unitario"
                        className="h-8 text-xs tabular-nums"
                      />
                      {/* DESCONTO POR LINHA. O campo existia no banco e em
                          `totalDoItem` desde o inicio, e nao tinha entrada
                          nenhuma na tela -- entao dar desconto num item so era
                          impossivel, e a unica saida era baixar o preco
                          unitario, que apaga qual era o preco cheio. */}
                      <Input
                        value={item.desconto}
                        onChange={(e) => mudarItem(i, { desconto: e.target.value })}
                        inputMode="decimal"
                        aria-label={`Desconto do item ${i + 1}`}
                        placeholder="Desconto"
                        className="h-8 text-xs tabular-nums"
                      />
                    </div>

                    <div className="mt-2 flex items-baseline justify-end gap-2 border-t border-border pt-2">
                      {num(item.desconto) > 0 && (
                        <span className="text-label tabular-nums text-muted-foreground line-through">
                          {formatarMoeda(num(item.preco_unit) * num(item.quantidade))}
                        </span>
                      )}
                      <span className="text-xs font-semibold tabular-nums">
                        {formatarMoeda(totalDoItem(paraCalculo(item)))}
                      </span>
                    </div>
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
