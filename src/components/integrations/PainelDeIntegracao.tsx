import { ReactNode, useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Eye, EyeOff } from "lucide-react";
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
 * A configuração da integração, NUMA COLUNA À DIREITA -- e não num diálogo.
 *
 * O diálogo cobria a tela inteira com uma sobreposição escura, então durante a
 * configuração a lista sumia. Isso custa em duas horas concretas: conferir se
 * você abriu a integração certa exigia fechar, e comparar dois provedores
 * exigia abrir e fechar dois diálogos.
 *
 * O componente é só a MOLDURA: cabeçalho, o resumo de quem está sendo
 * configurado, o corpo (`children`) e o rodapé. O corpo é de quem chama, porque
 * os seis formulários não se parecem -- três são uma lista de campos declarada,
 * o do WhatsApp escolhe entre dois provedores incompatíveis, o do Instagram tem
 * OAuth e webhook, e o do Google grava por edge function.
 *
 * ELE SE DESENHA POR PORTAL, no alvo que a aba publica na coluna da direita.
 * Sem isso o painel nasceria dentro da célula da grade do cartão que o abriu,
 * com a largura de um cartão. Ver `contexto-do-painel.ts`.
 *
 * ACIMA DE `lg` a coluna fica no fluxo, ao lado da lista. Abaixo não cabe -- a
 * lista teria uns 200px --, então vira sobreposição pela direita. Não é um
 * segundo desenho: é o mesmo painel, no único lugar onde ele cabe.
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
  /** Botões do rodapé. Ausente: o painel fecha sem rodapé — é o caso de quem
      salva por conta própria, como o Instagram. */
  rodape?: ReactNode;
}) {
  const { alvo, aberto, fechar } = useContextoDoPainel();

  if (aberto !== chave || !alvo) return null;

  return createPortal(
    <>
      {/* A cortina só existe onde o painel é sobreposição. Em `lg` ele está no
          fluxo, e escurecer a lista seria escurecer o que se quer olhar. */}
      <div
        className="fixed inset-0 z-40 bg-foreground/20 lg:hidden"
        onClick={fechar}
        aria-hidden
      />

      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col overflow-y-auto border-l border-border bg-card
                   lg:sticky lg:top-0 lg:z-auto lg:max-h-[calc(100vh-6rem)] lg:w-[340px] lg:max-w-none lg:shrink-0
                   lg:rounded-xl lg:border lg:shadow-[var(--shadow-xs)]"
        role="dialog"
        aria-label={`Configurar ${nome}`}
      >
        {/* CABEÇALHO. `sticky` porque a lista de campos rola: sem ele o botão de
            fechar sai da tela no provedor de sete campos, e a única saída vira
            rolar de volta até em cima. */}
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-3.5 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border">
            <Icone className="h-4 w-4 text-foreground" />
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
            Configurar integração
          </p>
          <button
            type="button"
            onClick={fechar}
            aria-label="Fechar"
            className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3.5 p-3.5">
          {/* A INTEGRAÇÃO EM QUESTÃO, repetida no topo do painel.
              Parece redundante com o cartão da lista, e não é: acima de `lg` o
              cartão pode estar fora da vista depois de rolar, e abaixo de `lg` a
              lista está coberta. É o que responde "estou mexendo em qual?". */}
          <div className="flex items-start justify-between gap-2 rounded-lg border border-border p-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border">
                <Icone className="h-[18px] w-[18px] text-foreground" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-corpo font-semibold leading-snug">{nome}</p>
                <p className="vx-subtitulo mt-0.5 leading-relaxed">{descricao}</p>
              </div>
            </div>
            {aoAlternarAtivo ? (
              <Switch
                checked={estado === "ativo"}
                onCheckedChange={aoAlternarAtivo}
                aria-label={estado === "ativo" ? `Desconectar ${nome}` : `Conectar ${nome}`}
                className="mt-0.5 shrink-0"
              />
            ) : (
              <SeloDeIntegracao estado={estado} />
            )}
          </div>

          <p className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
            Detalhes da integração
          </p>

          {children}
        </div>

        {/* RODAPÉ GRUDADO EMBAIXO. O painel rola, e um Salvar que rola junto
            some no provedor de sete campos -- que é justamente onde salvar
            importa mais. */}
        {rodape && (
          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-card px-3.5 py-3">
            {rodape}
          </div>
        )}
      </aside>
    </>,
    alvo,
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
 * Abre o contexto e publica o alvo dos painéis.
 *
 * Mora AQUI e não no arquivo do contexto porque aquele é `.ts` puro: separar o
 * hook do componente é o que impede o `react-refresh` de reclamar de um arquivo
 * que exporta as duas coisas.
 */
export function ProvedorDoPainel({
  children,
  /** Avisa quem precisa reagir à troca — a aba usa para carregar a config. */
  aoAbrir,
}: {
  children: (alvoRef: (n: HTMLDivElement | null) => void) => ReactNode;
  aoAbrir?: (chave: string | null) => void;
}) {
  const [alvo, setAlvo] = useState<HTMLElement | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  // Callback ref e não `useRef`: `useRef` não dispara render quando o nó
  // aparece, então o primeiro `createPortal` receberia `null` e o painel só
  // apareceria no render seguinte -- que pode não vir.
  const alvoRef = useCallback((n: HTMLDivElement | null) => setAlvo(n), []);

  const abrir = useCallback((chave: string) => {
    setAberto(chave);
    aoAbrir?.(chave);
  }, [aoAbrir]);

  const fechar = useCallback(() => {
    setAberto(null);
    aoAbrir?.(null);
  }, [aoAbrir]);

  const valor = useMemo(
    () => ({ alvo, aberto, abrir, fechar }),
    [alvo, aberto, abrir, fechar],
  );

  return <Contexto.Provider value={valor}>{children(alvoRef)}</Contexto.Provider>;
}
