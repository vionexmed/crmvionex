import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/layout/SectionLabel";

/**
 * Um cartão de integração, com o estado visível ANTES do clique.
 *
 * Os cartões diziam "Conectado" ou nada, e para saber o resto era preciso abrir.
 * Pior: Google Ads oferecia um botão "Conectar" para uma integração que não
 * existe no CRM — quem clicasse iria procurar credencial para nada.
 *
 * São TRÊS estados, e o terceiro é o que resolve isso:
 *
 *   ativo          está ligado e funcionando
 *   disponivel     existe, é só configurar
 *   nao-integrado  o CRM não fala com isso ainda; não há o que configurar
 *
 * `nao-integrado` não é "sem dados no período" nem "desligado". É ausência de
 * código, e dizer isso na cara evita a busca inútil.
 */
export type EstadoIntegracao = "ativo" | "disponivel" | "nao-integrado";

const SELO: Record<EstadoIntegracao, { texto: string; classe: string }> = {
  ativo: { texto: "Ativo", classe: "bg-success/10 text-success" },
  disponivel: { texto: "Disponível", classe: "bg-muted text-muted-foreground" },
  // Âmbar e não vermelho: não é erro, é uma etapa que não existe ainda.
  "nao-integrado": { texto: "Não integrado", classe: "bg-warning/10 text-warning" },
};

export function SeloDeIntegracao({ estado }: { estado: EstadoIntegracao }) {
  const s = SELO[estado];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-label font-semibold uppercase tracking-wide",
        s.classe,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {s.texto}
    </span>
  );
}

export function CartaoDeIntegracao({
  icone: Icone,
  nome,
  descricao,
  estado,
  /** Botões. Ficam numa faixa própria, separada por linha. */
  acoes,
  /** Aviso ou detalhe abaixo das ações. */
  nota,
  className,
}: {
  icone: React.ComponentType<{ className?: string }>;
  nome: string;
  descricao: string;
  estado: EstadoIntegracao;
  acoes?: ReactNode;
  nota?: ReactNode;
  className?: string;
}) {
  const inativo = estado === "nao-integrado";

  return (
    <Card className={cn(inativo && "bg-muted/20", className)}>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              estado === "ativo" ? "bg-success/10" : inativo ? "bg-muted" : "bg-primary/10",
            )}
          >
            <Icone
              className={cn(
                "h-4 w-4",
                estado === "ativo" ? "text-success" : inativo ? "text-muted-foreground" : "text-primary",
              )}
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className={cn("vx-titulo-secao truncate", inativo && "text-muted-foreground")}>
              {nome}
            </p>
            <p className="vx-subtitulo mt-0.5">{descricao}</p>
          </div>

          <SeloDeIntegracao estado={estado} />
        </div>

        {(acoes || nota) && (
          <div className="mt-3 border-t border-border pt-3">
            {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
            {nota && <div className={cn("text-label text-muted-foreground", acoes && "mt-2")}>{nota}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Um grupo de integrações, por FINALIDADE.
 *
 * Antes era pilha plana: plataforma de anúncio, canal de atendimento e
 * ferramenta de automação lado a lado, sem hierarquia. Achar uma exigia ler
 * todas.
 */
export function GrupoDeIntegracoes({
  titulo,
  children,
}: {
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      {/* `SectionLabel`, não classes à mão. Eu havia escrito
          `tracking-[0.11em]` -- um SÉTIMO valor de tracking, no arquivo que
          existe justamente porque havia seis. O teste pegou. */}
      <SectionLabel as="h3">{titulo}</SectionLabel>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}
