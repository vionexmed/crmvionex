import { useState } from "react";
import { Copy, Check, Mail, Pencil, ExternalLink, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { mensagemErro } from "@/lib/erro-supabase";
import { formatarMoeda, formatarData, formatarDataHora } from "@/lib/formato";
import { nomeDoContato } from "@/lib/contato-formato";
import { totaisDoOrcamento, type OrcamentoComRelacoes } from "@/lib/api/orcamentos";
import { SeloDeOrcamento } from "@/components/orcamentos/SeloDeOrcamento";
import { estadoDoOrcamento } from "@/lib/orcamento-calculo";
import { useAtualizarOrcamento } from "@/hooks/queries/useOrcamentos";
import { useUpdateDeal } from "@/hooks/queries/useDeals";
import { EmailComposeModal } from "@/components/crm/EmailComposeModal";
import { useDeals } from "@/hooks/queries/useDeals";

/** O link que o cliente abre. Montado do `window.location`, para funcionar em
 *  produção, em prévia da Vercel e em desenvolvimento sem configuração. */
const linkPublico = (token: string) => `${window.location.origin}/o/${token}`;

/**
 * O orçamento por dentro, na gaveta de 520px do perfil de contato.
 *
 * Mesma gaveta e mesma largura do `ContactDrawer` e do painel de integração:
 * "detalhe de uma coisa" já tem um gesto neste CRM, e um terceiro desenho para
 * o mesmo movimento obrigaria a aprender de novo.
 */
export function PainelDeOrcamento({
  orcamento,
  aoFechar,
  aoEditar,
}: {
  orcamento: OrcamentoComRelacoes | null;
  aoFechar: () => void;
  aoEditar: (o: OrcamentoComRelacoes) => void;
}) {
  const { toast } = useToast();
  const atualizar = useAtualizarOrcamento();
  const atualizarNegocio = useUpdateDeal();
  const { data: negocios } = useDeals();

  const [copiado, setCopiado] = useState(false);
  const [compondo, setCompondo] = useState(false);

  if (!orcamento) return null;

  const itens = (orcamento.itens ?? []).map((i) => ({
    preco_unit: Number(i.preco_unit),
    quantidade: Number(i.quantidade),
    desconto: Number(i.desconto),
  }));
  const totais = totaisDoOrcamento(itens, Number(orcamento.desconto) || 0);

  const pessoa = orcamento.contact
    ? nomeDoContato(orcamento.contact.first_name, orcamento.contact.last_name)
    : "Sem contato";
  const link = linkPublico(orcamento.token);
  const estado = estadoDoOrcamento(orcamento);
  const aprovado = orcamento.status === "aprovado";

  /*
    O negócio vinculado e o quanto ele diverge.

    `deals` vem do cache que a tela de Negócios já carrega -- não é consulta
    nova. Se o orçamento não tem negócio, não há o que sugerir.
  */
  const negocio = orcamento.deal_id
    ? (negocios?.data ?? []).find((d) => d.id === orcamento.deal_id)
    : null;
  const valorDoNegocio = negocio ? Number(negocio.value) || 0 : null;
  const divergeDoNegocio =
    aprovado && valorDoNegocio !== null && Math.abs(valorDoNegocio - totais.total) > 0.01;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast({ title: "Não consegui copiar", description: link, variant: "destructive" });
    }
  };

  /**
   * Marca como enviado.
   *
   * NÃO grava atividade própria: quem envia usa o compositor, e ele já registra
   * o e-mail. Uma segunda linha contaria o mesmo ato duas vezes -- e e-mail
   * conta como abordagem no painel, o que dobraria a métrica.
   */
  const marcarEnviado = async () => {
    try {
      await atualizar.mutateAsync({
        id: orcamento.id,
        patch: { status: "enviado", enviado_em: new Date().toISOString() },
      });
    } catch (e: unknown) {
      toast({ title: "Não foi possível marcar como enviado", description: mensagemErro(e), variant: "destructive" });
    }
  };

  const sincronizarValor = async () => {
    if (!negocio) return;
    try {
      await atualizarNegocio.mutateAsync({ id: negocio.id, deal: { value: totais.total } });
      toast({ title: "Valor do negócio atualizado", description: formatarMoeda(totais.total, orcamento.moeda) });
    } catch (e: unknown) {
      toast({ title: "Não foi possível atualizar o negócio", description: mensagemErro(e), variant: "destructive" });
    }
  };

  return (
    <>
      <Sheet open={!!orcamento} onOpenChange={(o) => !o && aoFechar()}>
        <SheetContent className="flex w-[520px] flex-col gap-0 p-0 sm:max-w-[520px]">
          <div className="shrink-0 border-b border-border p-5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-label font-semibold uppercase tracking-wide text-muted-foreground tabular-nums">
                  Orçamento #{orcamento.numero}
                </p>
                <SheetTitle className="mt-1 truncate text-sm font-semibold tracking-tight">
                  {orcamento.titulo || pessoa}
                </SheetTitle>
                <p className="vx-subtitulo mt-0.5">
                  {pessoa}
                  {orcamento.company?.name && ` · ${orcamento.company.name}`}
                </p>
              </div>
              <span className="mr-8 shrink-0">
                <SeloDeOrcamento orcamento={orcamento} />
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            {/* ── O link do cliente ── */}
            <section className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                Link para o cliente
              </p>
              <p className="break-all rounded-md bg-muted/50 p-2 text-label tabular-nums">{link}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="h-8 text-label" onClick={copiar}>
                  {copiado ? <Check className="mr-1 h-3.5 w-3.5 text-success" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
                  {copiado ? "Copiado" : "Copiar"}
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-label"
                  disabled={!orcamento.contact?.email}
                  title={orcamento.contact?.email ? undefined : "O contato não tem e-mail"}
                  onClick={() => setCompondo(true)}>
                  <Mail className="mr-1 h-3.5 w-3.5" />Enviar por e-mail
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-label" asChild>
                  <a href={link} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1 h-3.5 w-3.5" />Ver como cliente
                  </a>
                </Button>
              </div>
              {orcamento.status === "rascunho" && (
                <Button size="sm" className="h-8 w-full text-label" onClick={marcarEnviado}
                  disabled={atualizar.isPending}>
                  {atualizar.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Marcar como enviado
                </Button>
              )}
            </section>

            {/* ── O ciclo ── */}
            <section className="space-y-1.5 text-xs">
              {[
                ["Criado", orcamento.created_at],
                ["Enviado", orcamento.enviado_em],
                ["Visto pelo cliente", orcamento.visto_em],
                [
                  orcamento.status === "recusado" ? "Recusado" : "Aprovado",
                  orcamento.decidido_em,
                ],
              ].map(([rotulo, quando]) =>
                quando ? (
                  <div key={rotulo as string} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{rotulo}</span>
                    <span className="tabular-nums">{formatarDataHora(quando as string)}</span>
                  </div>
                ) : null,
              )}
              {orcamento.decidido_por && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Por</span>
                  <span className="truncate font-medium">{orcamento.decidido_por}</span>
                </div>
              )}
              {orcamento.motivo_recusa && (
                <p className="mt-1 rounded-md bg-destructive/5 p-2 leading-relaxed text-destructive">
                  “{orcamento.motivo_recusa}”
                </p>
              )}
              {orcamento.valido_ate && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Válido até</span>
                  <span className={estado === "expirado" ? "font-semibold text-warning" : "tabular-nums"}>
                    {formatarData(orcamento.valido_ate)}
                  </span>
                </div>
              )}
            </section>

            {/* ── Sugerir atualizar o negócio ── */}
            {divergeDoNegocio && (
              /* SUGERE, não sobrescreve. `deals.value` pode ter sido ajustado à
                 mão, e gravar sozinho apagaria a decisão de alguém sem avisar. */
              <section className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="text-xs leading-relaxed">
                  O negócio está em <strong>{formatarMoeda(valorDoNegocio!, orcamento.moeda)}</strong> e
                  este orçamento aprovado soma <strong>{formatarMoeda(totais.total, orcamento.moeda)}</strong>.
                </p>
                <Button size="sm" className="h-8 w-full text-label" onClick={sincronizarValor}
                  disabled={atualizarNegocio.isPending}>
                  {atualizarNegocio.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Atualizar o negócio para {formatarMoeda(totais.total, orcamento.moeda)}
                </Button>
              </section>
            )}

            {/* ── Itens ── */}
            <section className="overflow-hidden rounded-lg border border-border">
              <ul className="divide-y divide-border">
                {(orcamento.itens ?? []).map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{i.nome}</p>
                      <p className="text-label tabular-nums text-muted-foreground">
                        {Number(i.quantidade)} {i.unidade} × {formatarMoeda(Number(i.preco_unit), orcamento.moeda)}
                      </p>
                    </div>
                    <p className="shrink-0 text-xs font-semibold tabular-nums">
                      {formatarMoeda(
                        Math.max(0, Number(i.preco_unit) * Number(i.quantidade) - Number(i.desconto)),
                        orcamento.moeda,
                      )}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="space-y-1 border-t border-border bg-muted/30 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums">{formatarMoeda(totais.subtotal, orcamento.moeda)}</span>
                </div>
                {totais.desconto > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Desconto</span>
                    <span className="tabular-nums text-success">
                      − {formatarMoeda(totais.desconto, orcamento.moeda)}
                    </span>
                  </div>
                )}
                <div className="flex items-baseline justify-between border-t border-border pt-1.5">
                  <span className="font-semibold">Total</span>
                  <span className="font-heading text-base font-bold tabular-nums">
                    {formatarMoeda(totais.total, orcamento.moeda)}
                  </span>
                </div>
              </div>
            </section>

            {orcamento.observacoes && (
              <section className="rounded-lg border border-border p-3">
                <p className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                  Observação interna
                </p>
                <p className="mt-1 text-xs leading-relaxed">{orcamento.observacoes}</p>
                <p className="mt-1.5 text-label text-muted-foreground/70">
                  Não aparece na página do cliente.
                </p>
              </section>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border p-4">
            {/* Editar só antes da decisão: mudar item de orçamento já aprovado
                faria o CRM discordar do que o cliente aprovou por escrito. */}
            <Button
              variant="outline" size="sm" className="h-8 text-label"
              disabled={!!orcamento.decidido_em}
              title={orcamento.decidido_em ? "O cliente já respondeu — não dá para alterar" : undefined}
              onClick={() => aoEditar(orcamento)}
            >
              <Pencil className="mr-1 h-3.5 w-3.5" />Editar
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* O compositor já vincula ao contato e ao negócio, então o envio entra no
          histórico. O link vai no corpo. */}
      <EmailComposeModal
        open={compondo}
        onOpenChange={setCompondo}
        defaultTo={orcamento.contact?.email || ""}
        defaultContactId={orcamento.contact_id}
        defaultDealId={orcamento.deal_id ?? undefined}
        onSent={() => {
          setCompondo(false);
          if (orcamento.status === "rascunho") void marcarEnviado();
        }}
      />
    </>
  );
}
