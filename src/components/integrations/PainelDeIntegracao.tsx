import { ReactNode, useCallback, useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LogoUploadField } from "@/components/crm/LogoUploadField";
import { SeloDeIntegracao, type EstadoIntegracao } from "@/components/integrations/CartaoDeIntegracao";
import { Contexto, useContextoDoPainel } from "@/components/integrations/contexto-do-painel";

export type CampoIntegracao = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "secret" | "switch" | "section" | "logo" | "textarea";
  helpText?: string;
  helpUrl?: string;
  helpLabel?: string;
};

/**
 * A configuração da integração, NUMA GAVETA que entra pela direita.
 *
 * É o mesmo `Sheet` do perfil de contato (`ContactDrawer`), com a mesma largura
 * de 520px -- e isso é o ponto, não coincidência: o CRM já ensinou que "detalhe
 * de uma coisa" entra por ali. Uma segunda convenção para o mesmo gesto
 * obrigaria a aprender duas.
 *
 * Antes disto foram tentadas duas outras formas. Um `<Dialog>` centralizado,
 * que cobria a lista inteira -- conferir se você abriu a integração certa
 * exigia fechar. E uma coluna fixa no fluxo, ao lado da grade, que espremia os
 * cartões e obrigava o painel a nascer por portal para não ficar dentro da
 * célula do cartão que o abriu. A gaveta não tem nenhum dos dois problemas: sai
 * da grade sozinha e não come largura de ninguém.
 *
 * O componente é só a MOLDURA: cabeçalho, o resumo de quem está sendo
 * configurado, o corpo (`children`) e o rodapé. O corpo é de quem chama, porque
 * os seis formulários não se parecem -- três são uma lista de campos declarada,
 * e os outros três têm fluxo próprio.
 */
export function PainelDeIntegracao({
  chave,
  nome,
  icone: Icone,
  descricao,
  estado,
  aoAlternarAtivo,
  children,
  rodape,
}: {
  /** A mesma chave que `abrir()` recebe. O painel só aparece quando é a dele. */
  chave: string;
  nome: string;
  icone: React.ComponentType<{ className?: string }>;
  descricao: ReactNode;
  estado: EstadoIntegracao;
  /** Ausente: o topo mostra o selo em vez do interruptor. */
  aoAlternarAtivo?: (ligado: boolean) => void;
  children: ReactNode;
  /** Botões do rodapé. Ausente: o painel não tem rodapé — é o caso de quem
      salva por conta própria, como o Instagram e o Google. */
  rodape?: ReactNode;
}) {
  const { aberto, fechar } = useContextoDoPainel();

  return (
    <Sheet open={aberto === chave} onOpenChange={(o) => !o && fechar()}>
      <SheetContent className="flex w-[520px] flex-col gap-0 p-0 sm:max-w-[520px]">
        {/* CABEÇALHO. Mesmo desenho do topo do perfil de contato: a coisa
            grande à esquerda, o controle à direita.

            `mr-8` no interruptor pelo mesmo motivo que o ContactDrawer usa: o
            `SheetContent` desenha o próprio X em `right-4 top-4`, e sem o
            afastamento os dois se sobrepõem. */}
        <div className="shrink-0 border-b border-border p-5">
          <div className="flex items-start gap-3">
            <Icone className="h-11 w-11 shrink-0" />
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-sm font-semibold tracking-tight">
                {nome}
              </SheetTitle>
              <p className="vx-subtitulo mt-0.5 leading-relaxed">{descricao}</p>
            </div>
            {aoAlternarAtivo ? (
              <Switch
                checked={estado === "ativo"}
                onCheckedChange={aoAlternarAtivo}
                aria-label={estado === "ativo" ? `Desativar ${nome}` : `Ativar ${nome}`}
                className="mr-8 mt-0.5 shrink-0"
              />
            ) : (
              <span className="mr-8 shrink-0">
                <SeloDeIntegracao estado={estado} />
              </span>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-5">
          <p className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
            Detalhes da integração
          </p>
          {children}
        </div>

        {/* RODAPÉ GRUDADO EMBAIXO. O corpo rola, e um Salvar que rola junto some
            no provedor de sete campos -- que é justamente onde salvar importa
            mais. */}
        {rodape && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border p-4">
            {rodape}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Os campos declarados em `fields`, para os provedores que são só uma lista
 * deles (Meta Ads, Slack, Zapier).
 *
 * Fora da moldura porque os outros três não têm lista nenhuma -- passá-los por
 * aqui exigiria um `fields` falso descrevendo um formulário que não é feito de
 * campos.
 */
export function CamposDeIntegracao({
  campos,
  valores,
  aoMudarValor,
  revelados,
  aoAlternarRevelado,
}: {
  campos: CampoIntegracao[];
  valores: Record<string, unknown>;
  aoMudarValor: (chave: string, valor: unknown) => void;
  /** Quais segredos estão à mostra. O olho é por campo, não global. */
  revelados: Record<string, boolean>;
  aoAlternarRevelado: (chave: string) => void;
}) {
  return (
    <>
      {campos.map((campo) => {
        if (campo.type === "section") {
          return (
            <div key={campo.key} className="border-t border-border pt-3">
              <p className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                {campo.label}
              </p>
            </div>
          );
        }

        const valor = valores[campo.key];
        // `client_secret` e afins entram na lista de segredos mesmo sem
        // `type: "secret"` -- são chaves antigas, e esquecer uma delas mostraria
        // a credencial em texto puro na tela.
        const eSegredo =
          campo.type === "secret" ||
          ["client_secret", "refresh_token", "client_id"].includes(campo.key);

        return (
          <div key={campo.key} className="space-y-1.5">
            <Label className="text-xs">{campo.label}</Label>

            {campo.type === "switch" ? (
              <div className="flex items-center gap-2">
                <Switch checked={!!valor} onCheckedChange={(v) => aoMudarValor(campo.key, v)} />
                <span className="text-xs text-muted-foreground">{valor ? "Sim" : "Não"}</span>
              </div>
            ) : campo.type === "textarea" ? (
              <Textarea
                value={String(valor ?? "")}
                onChange={(e) => aoMudarValor(campo.key, e.target.value)}
                placeholder={campo.placeholder}
                className="min-h-[80px] text-xs"
              />
            ) : campo.type === "logo" ? (
              <LogoUploadField
                value={String(valor ?? "")}
                onChange={(url) => aoMudarValor(campo.key, url)}
              />
            ) : eSegredo ? (
              <div className="relative">
                <Input
                  type={revelados[campo.key] ? "text" : "password"}
                  value={String(valor ?? "")}
                  onChange={(e) => aoMudarValor(campo.key, e.target.value)}
                  placeholder={campo.placeholder}
                  className="h-8 pr-8 font-mono text-xs"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => aoAlternarRevelado(campo.key)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={revelados[campo.key] ? "Ocultar" : "Mostrar"}
                >
                  {revelados[campo.key]
                    ? <EyeOff className="h-3.5 w-3.5" />
                    : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            ) : (
              <Input
                type="text"
                value={String(valor ?? "")}
                onChange={(e) => aoMudarValor(campo.key, e.target.value)}
                placeholder={campo.placeholder}
                className="h-8 text-xs"
              />
            )}

            {campo.helpUrl ? (
              <p className="text-label leading-relaxed text-muted-foreground">
                {campo.helpText}{" "}
                <a
                  href={campo.helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  {campo.helpLabel}
                </a>
              </p>
            ) : campo.helpText ? (
              <p className="text-label leading-relaxed text-muted-foreground">{campo.helpText}</p>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/**
 * Abre o contexto que diz qual integração está sendo configurada.
 *
 * Mora AQUI e não no arquivo do contexto porque aquele é `.ts` puro: separar o
 * hook do componente é o que impede o `react-refresh` de reclamar de um arquivo
 * que exporta as duas coisas.
 */
export function ProvedorDoPainel({
  children,
  /** Avisa quem precisa reagir à troca. */
  aoAbrir,
}: {
  children: ReactNode;
  aoAbrir?: (chave: string | null) => void;
}) {
  const [aberto, setAberto] = useState<string | null>(null);

  const abrir = useCallback((chave: string) => {
    setAberto(chave);
    aoAbrir?.(chave);
  }, [aoAbrir]);

  const fechar = useCallback(() => {
    setAberto(null);
    aoAbrir?.(null);
  }, [aoAbrir]);

  const valor = useMemo(() => ({ aberto, abrir, fechar }), [aberto, abrir, fechar]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
