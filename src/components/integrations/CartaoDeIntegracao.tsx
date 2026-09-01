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
  /**
   * Liga e desliga o que JÁ está configurado.
   *
   * Ausente significa "não há o que desligar ainda" -- e aí o interruptor
   * continua aparecendo, porque a referência põe um em todo cartão e um cartão
   * sem ele lê como categoria diferente. Ele fica desligado, e ligar abre a
   * configuração: é a única coisa honesta a fazer, porque não dá para ativar o
   * que ninguém preencheu.
   */
  aoAlternar,
  /** Abre a configuração. É para onde o interruptor manda quando não há config. */
  aoConfigurar,
  /** O painel está aberto NESTE cartão. Ganha o anel de destaque. */
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
  aoConfigurar?: () => void;
  selecionado?: boolean;
  className?: string;
}) {
  const inativo = estado === "nao-integrado";
  const ativo = estado === "ativo";

  return (
    <Card
      className={cn(
        // `min-h` é o que deixa o cartão QUADRADO.
        //
        // Sem ele a altura era a do conteúdo, e o conteúdo é curto: logo, nome,
        // uma linha de descrição e um botão. Numa coluna de 380px dava uma faixa
        // deitada de 3:1, que não se parece com a referência nem de longe. Com
        // 190px de piso e o rodapé empurrado para baixo, a proporção fica perto
        // de 2:1 -- e, o que importa mais numa grade, TODOS ficam iguais mesmo
        // com descrições de uma a três linhas.
        "flex min-h-[190px] flex-col transition-colors",
        inativo && "bg-muted/20",
        // Anel e não sombra: numa grade de seis cartões a sombra some contra o
        // cinza da página, e a borda de destaque é o que a referência usa para
        // dizer "é este que o painel está mostrando".
        selecionado && "border-primary ring-1 ring-primary",
        className,
      )}
    >
      <CardContent className="flex flex-1 flex-col gap-3 p-3">
        {/*
          LINHA DE CIMA: a marca à esquerda, o interruptor à direita.

          O logo é um ladrilho FECHADO -- fundo, cantos e glifo vêm do próprio
          SVG (ver `logos-de-integracao.tsx`). Por isso não há mais moldura em
          volta: quem tem fundo branco (Gmail, Slack) desenha a própria borda, e
          quem tem fundo colorido (WhatsApp, Meta) não precisa de nenhuma.
        */}
        <div className="flex items-start justify-between gap-2">
          <Icone className={cn("h-10 w-10 shrink-0", inativo && "opacity-50 saturate-0")} />

          {/*
            O INTERRUPTOR, em TODO cartão -- é o que a referência faz.
            Ele aparecia só onde havia `aoAlternar`, então metade da grade tinha
            um controle no canto e a outra metade um selo, e as duas metades
            liam como dois tipos de coisa.

            Os três casos:
              ativo          desliga de verdade
              disponível     ligar ABRE a configuração (não dá para ativar o que
                             ninguém preencheu)
              não integrado  desabilitado, porque não existe código para ligar
          */}
          <Switch
            checked={ativo}
            disabled={inativo}
            onCheckedChange={(ligado) => {
              if (aoAlternar) return aoAlternar(ligado);
              if (ligado) aoConfigurar?.();
            }}
            aria-label={
              inativo
                ? `${nome} ainda não existe no CRM`
                : ativo
                  ? `Desativar ${nome}`
                  : `Ativar ${nome}`
            }
            title={inativo ? "Ainda não construído no CRM" : undefined}
            className="mt-0.5 shrink-0"
          />
        </div>

        <div className="min-w-0">
          <p className={cn("vx-titulo-secao", inativo && "text-muted-foreground")}>{nome}</p>
          <p className="vx-subtitulo mt-1 leading-relaxed">{descricao}</p>
        </div>

        {nota && <div className="text-label leading-relaxed text-muted-foreground">{nota}</div>}

        {/*
          O RODAPÉ: ação à esquerda, documentação no canto direito.

          SEM linha divisória -- a referência não tem: lá o botão simplesmente
          termina o cartão. Com a linha, cada cartão da grade lia como dois
          blocos empilhados, e a grade inteira ganhava um pautado horizontal que
          não corresponde a nenhuma divisão real.

          `mt-auto` é o que joga esta faixa para o fim do `min-h`, e por isso os
          botões de todos os cartões ficam na MESMA altura. Rodapés desalinhados
          numa grade leem como cartões de tamanhos diferentes.
        */}
        {/* `min-h-8` é o que ALINHA a fileira.

            O rodapé tinha a altura do filho mais alto, e os filhos variam: um
            botão tem 32px e o selo "NÃO INTEGRADO" tem 20px. Numa fileira com
            um cartão de botão e outro só de selo, o selo assentava ~6px abaixo
            da linha do botão vizinho -- pouco para nomear, o bastante para a
            grade parecer torta.

            Com piso igual à altura do botão, todo rodapé ocupa a mesma faixa e
            o conteúdo centraliza nela. */}
        <div className="mt-auto flex min-h-8 items-center justify-between gap-2 pt-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {acoes}
            {/* O selo sobra só para o terceiro estado: o interruptor tem dois, e
                "não integrado" não é nenhum dos dois -- é ausência de código. */}
            {inativo && <SeloDeIntegracao estado={estado} />}
          </div>

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
