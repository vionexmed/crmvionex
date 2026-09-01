import { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
  /** Documentação do provedor. Vira a seta no canto; ausente, nada aparece. */
  linkExterno,
  /**
   * Liga e desliga.
   *
   * OPCIONAL, e é o ponto. A referência põe um interruptor em todo cartão, mas
   * aqui a maioria não tem "desligar" implementado -- e interruptor que não
   * desliga é controle morto, pior que controle ausente. Sem esta prop o rodapé
   * mostra só a ação.
   */
  aoAlternar,
  className,
}: {
  icone: React.ComponentType<{ className?: string }>;
  nome: string;
  descricao: string;
  estado: EstadoIntegracao;
  acoes?: ReactNode;
  nota?: ReactNode;
  linkExterno?: string;
  aoAlternar?: (ligado: boolean) => void;
  className?: string;
}) {
  const inativo = estado === "nao-integrado";
  const ativo = estado === "ativo";

  return (
    <Card className={cn("flex flex-col", inativo && "bg-muted/20", className)}>
      <CardContent className="flex flex-1 flex-col p-0">
        <div className="flex flex-1 flex-col gap-2.5 p-3.5">
          <div className="flex items-start justify-between gap-2">
            {/*
              O ÍCONE EM QUADRADO COM BORDA, no topo -- e não ao lado do nome.
              É o que a referência faz, e o ganho é real: a marca fica no mesmo
              lugar em todos os cartões, então o olho varre a coluna de ícones
              sem ler nome nenhum.
            */}
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card",
                inativo && "opacity-50",
              )}
            >
              <Icone className={cn("h-[18px] w-[18px]", inativo ? "text-muted-foreground" : "text-foreground")} />
            </div>

            {linkExterno && (
              <a
                href={linkExterno}
                target="_blank"
                rel="noreferrer"
                title={`Documentação de ${nome}`}
                className="-mr-1 -mt-1 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>

          <div className="min-w-0">
            <p className={cn("vx-titulo-secao", inativo && "text-muted-foreground")}>{nome}</p>
            <p className="vx-subtitulo mt-1 leading-relaxed">{descricao}</p>
          </div>

          {nota && <div className="text-label leading-relaxed text-muted-foreground">{nota}</div>}
        </div>

        {/*
          O RODAPÉ, separado por linha: ação à esquerda, estado à direita.
          `mt-auto` para ficar colado embaixo mesmo quando o cartão vizinho é
          mais alto -- numa grade, rodapés desalinhados leem como cartões de
          tamanhos diferentes.
        */}
        {(acoes || aoAlternar || !inativo) && (
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-border px-3.5 py-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">{acoes}</div>
            {aoAlternar ? (
              <Switch
                checked={ativo}
                onCheckedChange={aoAlternar}
                aria-label={ativo ? `Desconectar ${nome}` : `Conectar ${nome}`}
                className="shrink-0"
              />
            ) : (
              <SeloDeIntegracao estado={estado} />
            )}
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
      {/* Três colunas como a referência. Em `md` ficam duas: a 288px por
          cartão, três já espremeriam a descrição em quatro linhas. */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}
