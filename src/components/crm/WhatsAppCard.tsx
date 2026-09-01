import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ui/button";
import { PainelDeIntegracao } from "@/components/integrations/PainelDeIntegracao";
import { useContextoDoPainel } from "@/components/integrations/contexto-do-painel";
import { MessageCircle, QrCode, ShieldCheck, Settings2 } from "lucide-react";
import { CartaoDeIntegracao, type EstadoIntegracao } from "@/components/integrations/CartaoDeIntegracao";
import { SegmentedControl } from "@/components/layout/SegmentedControl";
import { WhatsAppOfficialCard } from "@/components/crm/WhatsAppOfficialCard";
import { WhatsAppEvolutionCard } from "@/components/crm/WhatsAppEvolutionCard";

/**
 * O ÚNICO cartão de WhatsApp.
 *
 * Havia três, e o usuário disse que a tela estava confusa — com razão: a seção
 * "WhatsApp Business" dentro do cartão do Meta, o cartão "WhatsApp oficial" e o
 * "WhatsApp por QR code". Três lugares para configurar a mesma coisa, gravando
 * em três destinos diferentes, sem nada na tela dizendo qual valia.
 *
 * Agora é um cartão e uma pergunta: por qual caminho. A escolha vive DENTRO,
 * porque é consequência de configurar um dos dois — não uma decisão separada
 * que se toma antes.
 */

type Provedor = "meta" | "evolution";

/**
 * `aoMudarEstado` existe por causa do filtro por estado da lista de
 * integrações: este cartão descobre sozinho se há número conectado (são três
 * tabelas), e sem reportar para cima a aba filtraria "Ativos" escondendo um
 * WhatsApp ativo. Opcional -- fora daquela lista ninguém precisa saber.
 */
export function WhatsAppCard({ aoMudarEstado }: { aoMudarEstado?: (e: EstadoIntegracao) => void } = {}) {
  const { orgId } = useOrg();
  // O `aberto` local saiu: quem está aberto é decidido pelo contexto, e é isso
  // que faz abrir o segundo painel fechar o primeiro.
  const { abrir, aberto: painelAberto } = useContextoDoPainel();
  const [provedor, setProvedor] = useState<Provedor>("meta");
  const [estado, setEstado] = useState<EstadoIntegracao>("disponivel");
  const [resumo, setResumo] = useState("Nenhum número conectado");

  useEffect(() => { aoMudarEstado?.(estado); }, [estado, aoMudarEstado]);

  /**
   * Lê as TRÊS fontes, porque as três existem em produção:
   *
   *   whatsapp_business_accounts  a conta da empresa e o provedor escolhido
   *   whatsapp_connections        os números que as pessoas reivindicaram
   *   whatsapp_config             o caminho LEGADO, de quem ainda não migrou
   *
   * Ignorar a terceira faria o cartão dizer "não conectado" para empresa que
   * está enviando mensagem agora.
   */
  const carregar = useCallback(async () => {
    if (!orgId) return;
    const [{ data: conta }, { count }, { data: legado }] = await Promise.all([
      supabase.from("whatsapp_business_accounts")
        .select("provider, is_active").eq("org_id", orgId).maybeSingle(),
      supabase.from("whatsapp_connections")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId).eq("is_active", true),
      supabase.from("whatsapp_config")
        .select("is_active, display_phone_number").eq("org_id", orgId).maybeSingle(),
    ]);

    const ativa = !!conta?.is_active;
    const prov = (conta?.provider as Provedor) ?? "meta";
    if (ativa) setProvedor(prov);

    const numeros = count ?? 0;
    const viaLegado = !ativa && !!legado?.is_active;

    if (ativa || viaLegado) {
      setEstado("ativo");
      const via = viaLegado ? "Oficial da Meta" : prov === "evolution" ? "QR code (Evolution)" : "Oficial da Meta";
      setResumo(
        numeros > 0
          ? `${via} · ${numeros} ${numeros === 1 ? "número conectado" : "números conectados"}`
          : viaLegado
            ? `${via} · ${legado?.display_phone_number ?? "número da empresa"}`
            : `${via} · nenhum número reivindicado ainda`,
      );
    } else {
      setEstado("disponivel");
      setResumo("Escolha entre a API oficial da Meta ou QR code");
    }
  }, [orgId]);

  useEffect(() => { void carregar(); }, [carregar]);
  // Ao fechar o painel, o estado pode ter mudado lá dentro -- conectar um
  // número acontece DENTRO dele, e o resumo do cartão precisa acompanhar.
  useEffect(() => {
    if (painelAberto !== "whatsapp") void carregar();
  }, [painelAberto, carregar]);

  return (
    <>
      <CartaoDeIntegracao
        icone={MessageCircle}
        nome="WhatsApp"
        descricao={resumo}
        estado={estado}
        acoes={
          <Button variant="outline" size="sm" className="h-8 text-label" onClick={() => abrir("whatsapp")}>
            <Settings2 className="mr-1 h-3.5 w-3.5" />
            {estado === "ativo" ? "Gerenciar" : "Conectar"}
          </Button>
        }
      />

      {/* Sem rodapé: cada provedor tem o próprio botão de salvar, dentro do
          cartão embutido. Um "Salvar" na moldura seria um segundo botão que não
          salva o que o de dentro salva. */}
      <PainelDeIntegracao
        chave="whatsapp"
        nome="WhatsApp"
        icone={MessageCircle}
        descricao={resumo}
        estado={estado}
      >
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Dois caminhos, e eles não convivem: a empresa usa um.
          </p>

          <SegmentedControl<Provedor>
            rotuloGrupo="Como conectar"
            valor={provedor}
            onChange={setProvedor}
            opcoes={[
              { valor: "meta", rotulo: "Oficial da Meta", icone: ShieldCheck },
              { valor: "evolution", rotulo: "QR code", icone: QrCode },
            ]}
          />

          {/* A comparação que decide, na frente da pessoa em vez de num
              documento. Ela existe porque as duas parecem equivalentes na tela
              e não são: uma exige template aprovado, a outra viola os termos. */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-label leading-relaxed text-muted-foreground">
            {provedor === "meta" ? (
              <>
                Oficial, sem servidor para hospedar e sem risco de derrubar o número.
                Em troca: o número precisa entrar num WABA e{" "}
                <strong className="text-foreground">
                  a primeira mensagem a quem não te escreveu nas últimas 24 h exige
                  template aprovado
                </strong>{" "}
                pela Meta, que cobra por conversa.
              </>
            ) : (
              <>
                Texto livre em qualquer abordagem, com qualquer celular, sem
                aprovação. Em troca:{" "}
                <strong className="text-foreground">
                  exige um servidor hospedado e roda por cima do WhatsApp Web, o que
                  viola os termos da Meta e pode derrubar o número
                </strong>.
              </>
            )}
          </div>

          <div className="mt-1">
            {provedor === "meta"
              ? <WhatsAppOfficialCard embutido />
              : <WhatsAppEvolutionCard embutido />}
          </div>
        </div>
      </PainelDeIntegracao>
    </>
  );
}
