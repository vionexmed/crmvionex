import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { MessageCircle, QrCode, ShieldCheck } from "lucide-react";
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

export function WhatsAppCard() {
  const { orgId } = useOrg();
  const [aberto, setAberto] = useState(false);
  const [provedor, setProvedor] = useState<Provedor>("meta");
  const [estado, setEstado] = useState<EstadoIntegracao>("disponivel");
  const [resumo, setResumo] = useState("Nenhum número conectado");

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
  // Ao fechar o diálogo, o estado pode ter mudado lá dentro.
  useEffect(() => { if (!aberto) void carregar(); }, [aberto, carregar]);

  return (
    <>
      <CartaoDeIntegracao
        icone={MessageCircle}
        nome="WhatsApp"
        descricao={resumo}
        estado={estado}
        acoes={
          <Button variant="outline" size="sm" className="h-8 text-label" onClick={() => setAberto(true)}>
            {estado === "ativo" ? "Gerenciar" : "Conectar"}
          </Button>
        }
      />

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">WhatsApp</DialogTitle>
            <DialogDescription className="text-xs">
              Dois caminhos, e eles não convivem: a empresa usa um.
            </DialogDescription>
          </DialogHeader>

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
        </DialogContent>
      </Dialog>
    </>
  );
}
