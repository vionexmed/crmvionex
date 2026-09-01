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
  /** Botões. Ficam no rodapé do cartão, à esquerda. */
  acoes,
  /** Aviso ou detalhe abaixo das ações. */
  nota,
  /** Documentação do provedor. Vira a seta no canto inferior direito. */
  linkExterno,
  /** Liga e desliga. Opcional: sem ela o canto superior mostra o selo. */
  aoAlternar,
  /** O painel da direita está aberto NESTE cartão. Ganha o anel de destaque. */
  selecionado,
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
  selecionado?: boolean;
  className?: string;
}) {
  const inativo = estado === "nao-integrado";
  const ativo = estado === "ativo";

  return (
    <Card
      className={cn(
        "flex flex-col transition-colors",
        inativo && "bg-muted/20",
        // Anel e não sombra: numa grade de seis cartões, a sombra some contra o
        // cinza da página, e a borda de destaque é o que a referência usa para
        // dizer "é este que o painel está mostrando".
        selecionado && "border-primary ring-1 ring-primary",
        className,
      )}
    >
      {/* `p-3` e não `p-4`: repetir o padding do default do Card é proibido, e o
          terceiro valor de respiro também -- são as duas regras de
          `css-padronizado.test.ts`. `p-3` é o valor dos contêineres apertados, e
          uma grade de três colunas a 288px é exatamente isso. */}
      <CardContent className="flex flex-1 flex-col gap-3 p-3">
        {/*
          LINHA DE CIMA: a marca à esquerda, o ESTADO à direita.

          O ícone em quadrado com borda, no topo -- e não ao lado do nome. É o
          que a referência faz, e o ganho é real: a marca fica no mesmo lugar em
          todos os cartões, então o olho varre a coluna de ícones sem ler nome
          nenhum.

          O estado subiu para cá, de onde a referência o coloca. Ele morava no
          rodapé, dividindo a linha com os botões -- e ali competia com a ação,
          que é o que a pessoa foi fazer no cartão. No topo ele responde "isto
          está ligado?" antes de o olho chegar ao botão.
        */}
        <div className="flex items-start justify-between gap-2">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card",
              inativo && "opacity-50",
            )}
          >
            <Icone className={cn("h-[18px] w-[18px]", inativo ? "text-muted-foreground" : "text-foreground")} />
          </div>

          {/*
            O INTERRUPTOR, quando existe; senão o selo.

            `aoAlternar` é opcional, e é o ponto. A referência põe um interruptor
            em todo cartão, mas aqui a maioria não tem "desligar" implementado --
            e interruptor que não desliga é controle morto, pior que controle
            ausente. O selo ocupa o mesmo canto e diz a mesma coisa sem prometer
            um clique que não existe; é também o único jeito de `nao-integrado`
            aparecer, porque um interruptor tem dois estados e este é o terceiro.
          */}
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

        <div className="min-w-0">
          <p className={cn("vx-titulo-secao", inativo && "text-muted-foreground")}>{nome}</p>
          <p className="vx-subtitulo mt-1 leading-relaxed">{descricao}</p>
        </div>

        {nota && <div className="text-label leading-relaxed text-muted-foreground">{nota}</div>}

        {/*
          O RODAPÉ: ação à esquerda, documentação no canto direito.

          SEM a linha divisória que havia aqui. Ela separava o rodapé do corpo
          num cartão de quatro linhas -- e a referência não tem: lá o botão
          simplesmente termina o cartão. Com a linha, cada cartão da grade lia
          como dois blocos empilhados, e a grade inteira ganhava um pautado
          horizontal que não corresponde a nenhuma divisão real.

          `mt-auto` fica: numa grade, rodapés desalinhados leem como cartões de
          tamanhos diferentes, e as descrições têm de uma a três linhas.
        */}
        {(acoes || linkExterno) && (
          <div className="mt-auto flex items-center justify-between gap-2 pt-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">{acoes}</div>

            {/* A seta desceu do topo para cá, onde a referência a põe. No canto
                de cima ela disputava com o interruptor -- dois alvos pequenos
                lado a lado, um que muda o estado da integração e outro que abre
                outra aba. Errar o clique custava caro num deles. */}
            {linkExterno && (
              <a
                href={linkExterno}
                target="_blank"
                rel="noreferrer"
                title={`Documentação de ${nome}`}
                className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
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
