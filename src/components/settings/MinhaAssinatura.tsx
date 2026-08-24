/**
 * Assinatura de e-mail da própria pessoa.
 *
 * Fica aqui, e não em Integrações, porque assinatura é dado pessoal: nome,
 * cargo e telefone de quem assina. A aba de Integrações é só para admin, e a
 * assinatura que ela edita vale para a empresa inteira — o e-mail da Ana saía
 * assinado com os dados de quem o admin cadastrou.
 *
 * Grava em email_connections.signature_html, camada que o gmail-send já
 * privilegia sobre a da organização. Quem não preencher continua herdando a da
 * empresa; esta tela só sobrepõe.
 *
 * A PRÉVIA não é aproximação: montarAssinaturaHtml produz exatamente a string
 * que é guardada e enviada.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Save, Eraser } from "lucide-react";
import { LogoUploadField } from "@/components/crm/LogoUploadField";
import {
  montarAssinaturaHtml,
  temAssinatura,
  type DadosAssinatura,
} from "@/lib/email-signature";

const CAMPOS: { chave: keyof DadosAssinatura; rotulo: string; exemplo: string }[] = [
  { chave: "nome", rotulo: "Nome", exemplo: "Ana Prado" },
  { chave: "cargo", rotulo: "Cargo", exemplo: "Consultora comercial" },
  { chave: "empresa", rotulo: "Empresa", exemplo: "Vionex" },
  { chave: "telefone", rotulo: "Telefone", exemplo: "+55 11 99999-9999" },
  { chave: "email", rotulo: "E-mail", exemplo: "ana@vionex.med.br" },
  { chave: "site", rotulo: "Site", exemplo: "vionex.med.br" },
];

export function MinhaAssinatura({
  connectionId,
  emailDaConta,
}: {
  connectionId: string;
  /** Sugestão inicial para o campo de e-mail: a conta que a pessoa conectou. */
  emailDaConta: string;
}) {
  const { toast } = useToast();
  const [dados, setDados] = useState<DadosAssinatura>({});
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data } = await supabase
      .from("email_connections")
      .select("signature_fields")
      .eq("id", connectionId)
      .maybeSingle();

    const salvos = (data?.signature_fields ?? {}) as DadosAssinatura;
    // Só sugere o e-mail quando ainda não há assinatura nenhuma. Depois disso,
    // sobrescrever o que a pessoa escolheu seria intrometido.
    setDados(temAssinatura(salvos) ? salvos : { email: emailDaConta });
    setCarregando(false);
  }, [connectionId, emailDaConta]);

  useEffect(() => { carregar(); }, [carregar]);

  const html = montarAssinaturaHtml(dados);

  async function salvar() {
    setSalvando(true);
    try {
      const { error } = await supabase
        .from("email_connections")
        .update({
          signature_fields: dados as never,
          // Vazio vira null para o gmail-send cair na assinatura da empresa em
          // vez de anexar um bloco em branco.
          signature_html: html || null,
        })
        .eq("id", connectionId);
      if (error) throw error;
      toast({
        title: html ? "Assinatura salva" : "Assinatura removida",
        description: html
          ? "Ela aparece nos próximos e-mails que você enviar pelo CRM."
          : "Seus e-mails voltam a usar a assinatura padrão da empresa.",
      });
    } catch (e) {
      toast({
        title: "Não foi possível salvar",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Minha assinatura</CardTitle>
        <CardDescription className="text-[11px]">
          Vai no rodapé dos e-mails que você enviar pelo CRM. Deixe em branco para usar a
          assinatura padrão da empresa.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {carregando ? (
          <div className="h-40 animate-pulse rounded-md bg-muted" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2.5">
              {CAMPOS.map((campo) => (
                <div key={campo.chave} className="space-y-1">
                  <label className="text-[10px] font-medium" htmlFor={`sig-${campo.chave}`}>
                    {campo.rotulo}
                  </label>
                  <Input
                    id={`sig-${campo.chave}`}
                    className="h-8 text-xs"
                    placeholder={campo.exemplo}
                    value={dados[campo.chave] ?? ""}
                    onChange={(e) => setDados({ ...dados, [campo.chave]: e.target.value })}
                  />
                </div>
              ))}
              <div className="space-y-1">
                <label className="text-[10px] font-medium">Foto</label>
                <LogoUploadField
                  value={dados.fotoUrl ?? ""}
                  onChange={(url) => setDados({ ...dados, fotoUrl: url })}
                  rotulo="foto"
                  redondo
                />
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  Um retrato quadrado fica melhor — a foto é recortada em círculo. Muitos
                  clientes de e-mail só carregam imagens depois que a pessoa autoriza, então
                  a assinatura precisa continuar legível sem ela.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-medium" htmlFor="sig-extra">
                  Texto adicional
                </label>
                <Textarea
                  id="sig-extra"
                  className="min-h-[60px] text-xs"
                  placeholder="Endereço, aviso de confidencialidade…"
                  value={dados.extra ?? ""}
                  onChange={(e) => setDados({ ...dados, extra: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-medium text-muted-foreground">
                Prévia — é exatamente o que vai no e-mail
              </p>
              <div className="min-h-[160px] rounded-md border border-border bg-white p-4">
                {html ? (
                  // O HTML vem de montarAssinaturaHtml, que escapa toda entrada
                  // do usuário. Nada aqui é texto cru vindo do banco.
                  <div dangerouslySetInnerHTML={{ __html: html }} />
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Preencha ao menos um campo para ver a prévia. Sem assinatura própria, seus
                    e-mails usam a da empresa.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px]"
            onClick={() => setDados({})}
            disabled={salvando || carregando || !temAssinatura(dados)}
          >
            <Eraser className="mr-1 h-3 w-3" />
            Limpar
          </Button>
          <Button size="sm" className="h-7 text-[10px]" onClick={salvar} disabled={salvando || carregando}>
            {salvando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
            Salvar assinatura
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
