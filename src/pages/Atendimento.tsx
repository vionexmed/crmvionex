import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import DOMPurify from "dompurify";
import {
  AlertCircle, AtSign, CheckCheck, Inbox, Instagram, Loader2, Mail,
  MessageSquare, Phone, Search, Send,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { SegmentedControl } from "@/components/layout/SegmentedControl";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/EstadoDaLista";
import { SemOrganizacao } from "@/components/layout/SemOrganizacao";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/hooks/useOrg";
import { useToast } from "@/hooks/use-toast";
import {
  useAtendimento, useAtendimentoAoVivo, useCanaisConectados, useMarcarEmailLido,
} from "@/hooks/queries/useAtendimento";
import {
  enviarPeloCanal, ROTULO_CANAL,
  type CanalAtendimento, type ContatoDoAtendimento, type MensagemUnificada,
} from "@/lib/api/atendimento";
import { formatarDataCurta, formatarHora } from "@/lib/formato";
import { formatarTelefone } from "@/lib/contato-formato";
import { mensagemErro } from "@/lib/erro-supabase";
import { cn } from "@/lib/utils";

/**
 * ATENDIMENTO: e-mail, WhatsApp e Instagram numa tela só.
 *
 * Eram TRÊS destinos -- `/conversations`, `/instagram` e `/inbox` -- e quem
 * atende tinha de adivinhar em qual deles a conversa estava. A mesma pessoa
 * escrevendo por dois canais aparecia em dois lugares, sem nada ligando um ao
 * outro, e nenhuma das telas dizia que a outra existia.
 *
 * O ARGUMENTO ANTIGO, que ficava no topo de `Conversations.tsx`, era que a
 * barra lateral é que devia trocar de canal, "porque é assim que a pessoa
 * pensa". Não se sustentou no uso: a pessoa pensa em QUEM está esperando
 * resposta, não no aplicativo por onde a pergunta chegou. A troca de canal virou
 * um FILTRO desta tela, e a rota antiga de cada canal continua atendendo --
 * redirecionada para cá com o filtro já aplicado.
 *
 * O QUE CONTINUA SEPARADO, e segue sendo de propósito:
 *
 * - a CONVERSA. Mesma pessoa no WhatsApp e no Instagram são duas conversas, e a
 *   chave da thread inclui o canal. Juntar seria bonito e errado: cada canal tem
 *   janela própria e rota de envio própria, e uma pode estar aberta enquanto a
 *   outra fechou -- uma thread misturada teria um campo de texto que às vezes
 *   envia e às vezes não, sem nada na tela explicando por quê. O que a tela faz
 *   é mostrar, no cabeçalho da conversa, em que outros canais aquele MESMO
 *   contato também falou, com um clique para ir até lá;
 * - a JANELA. No WhatsApp, fora das 24h só com template aprovado. No Instagram,
 *   24h livres e até 7 dias com atendimento humano. No e-mail não há janela.
 *   São regras diferentes da Meta, não uma regra com exceções;
 * - a CAIXA DE E-MAIL COMPLETA, em `/inbox`: pastas, rótulos do Gmail, spam,
 *   lixeira, adiar e anexos. Isso é gestão de caixa, não atendimento, e não cabe
 *   numa lista de conversas -- a rota continua de pé e o cabeçalho leva até lá.
 *
 * O canal de cada linha aparece como ÍCONE MAIS TEXTO. Só a cor não serve: quem
 * não distingue as cores fica sem a informação, e ela é a que mais importa na
 * lista -- é ela que diz por onde a resposta vai sair.
 */

type Filtro = CanalAtendimento | "todos";

const CANAIS: CanalAtendimento[] = ["email", "whatsapp", "instagram"];

const ICONE_CANAL: Record<CanalAtendimento, LucideIcon> = {
  email: Mail,
  whatsapp: MessageSquare,
  instagram: Instagram,
};

type Conversa = {
  /** `canal:contact_id` ou `canal:identidade`. O canal faz parte da chave. */
  key: string;
  canal: CanalAtendimento;
  contact_id: string | null;
  /** Telefone, IGSID ou endereço de quem está do outro lado. */
  identidade: string;
  contato: ContatoDoAtendimento | null;
  ultimo_texto: string | null;
  ultimo_assunto: string | null;
  ultimo_em: string;
  ultima_entrada_em: string | null;
  nao_lidas: number;
};

function formatarQuando(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return formatarHora(d);
  return formatarDataCurta(d);
}

/**
 * Como chamar quem está do outro lado.
 *
 * Sem o nome do contato o rótulo depende do canal: telefone formatado no
 * WhatsApp, `@` no Instagram, endereço no e-mail. Mostrar o IGSID cru seria pôr
 * "17841400000000000" na lista -- um número que não identifica ninguém e que
 * parece defeito da tela.
 */
function rotuloDaConversa(c: Conversa): string {
  if (c.contato?.nome) return c.contato.nome;
  if (c.canal === "instagram") {
    return c.contato?.instagram_username ? `@${c.contato.instagram_username}` : "Instagram (sem nome)";
  }
  if (c.canal === "whatsapp") return formatarTelefone(c.identidade);
  return c.identidade || "Sem remetente";
}

function iniciais(nome: string): string {
  const termos = nome.replace(/^@/, "").trim().split(/\s+/).filter(Boolean);
  if (termos.length === 0) return "?";
  if (termos.length === 1) return termos[0].slice(0, 2).toUpperCase();
  return (termos[0][0] + termos[termos.length - 1][0]).toUpperCase();
}

/**
 * Estado da janela de resposta, por canal.
 *
 * `podeEnviar` é o que libera o campo, e `aviso` é o que explica quando ele está
 * bloqueado -- ou quando vai sair caro. Campo desabilitado sem explicação é o
 * que faz a pessoa achar que a tela quebrou.
 */
function janelaDaConversa(c: Conversa | null): { podeEnviar: boolean; aviso: string | null } {
  if (!c) return { podeEnviar: false, aviso: null };

  if (c.canal === "email") {
    if (!c.identidade) {
      return { podeEnviar: false, aviso: "Esta conversa não tem endereço de resposta." };
    }
    // E-mail não tem janela: é o único dos três que aceita iniciar conversa.
    return { podeEnviar: true, aviso: null };
  }

  if (c.canal === "instagram" && !c.contact_id) {
    return {
      podeEnviar: false,
      aviso: "O envio do Instagram vai para o IGSID, que mora no contato — " +
        "e esta conversa ainda não está ligada a nenhum.",
    };
  }

  if (!c.ultima_entrada_em) {
    return {
      podeEnviar: false,
      aviso: "Esta pessoa nunca escreveu por aqui, e nenhum dos dois canais da Meta " +
        "permite iniciar conversa sem isso.",
    };
  }

  const horas = (Date.now() - new Date(c.ultima_entrada_em).getTime()) / 3_600_000;

  if (c.canal === "whatsapp") {
    return horas < 24
      ? { podeEnviar: true, aviso: null }
      : {
        podeEnviar: false,
        aviso: "Passaram-se mais de 24h desde a última mensagem dela. " +
          "No WhatsApp, reabrir a conversa exige um template aprovado.",
      };
  }

  if (horas < 24) return { podeEnviar: true, aviso: null };
  if (horas < 24 * 7) {
    return {
      podeEnviar: true,
      aviso: "Fora das 24h. A resposta vai marcada como atendimento humano, " +
        "que é o que o Instagram permite até 7 dias.",
    };
  }
  return {
    podeEnviar: false,
    aviso: "Passaram-se mais de 7 dias. O Instagram não permite responder depois disso — " +
      "use WhatsApp ou e-mail para retomar.",
  };
}

/**
 * Rótulo para mensagem sem texto.
 *
 * Repetido do `descricaoDeConteudo` da edge function de propósito: aquele roda
 * no Deno e este no navegador, e importar de `supabase/functions` para dentro do
 * `src` puxaria o mundo do Deno para o build do Vite.
 */
function descricaoDeAnexo(tipo: string): string {
  const mapa: Record<string, string> = {
    image: "Imagem",
    video: "Vídeo",
    audio: "Áudio",
    file: "Arquivo",
    document: "Documento",
    share: "Publicação compartilhada",
    ig_reel: "Reel",
    story_mention: "Mencionou você num story",
    story_reply: "Respondeu ao seu story",
    unsupported: "Conteúdo não suportado",
  };
  return mapa[tipo] ?? "Mensagem sem texto";
}

/** O selo de canal: ícone E texto. Ver o cabeçalho do arquivo. */
function SeloDeCanal({ canal, className }: { canal: CanalAtendimento; className?: string }) {
  const Icone = ICONE_CANAL[canal];
  return (
    <span className={cn("flex items-center gap-1 text-label text-muted-foreground", className)}>
      <Icone className="h-3 w-3 shrink-0" aria-hidden="true" />
      {ROTULO_CANAL[canal]}
    </span>
  );
}

export default function Atendimento() {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { toast } = useToast();
  const [parametros, setParametros] = useSearchParams();

  const { data, isLoading, isError, refetch } = useAtendimento();
  const { data: conectados } = useCanaisConectados();
  const marcarLido = useMarcarEmailLido();
  useAtendimentoAoVivo();

  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [rascunho, setRascunho] = useState("");
  const [enviando, setEnviando] = useState(false);
  const rolagem = useRef<HTMLDivElement>(null);

  /**
   * O filtro vem da URL, e é o que faz `/conversations` e `/instagram`
   * continuarem levando ao canal certo depois de redirecionados para cá.
   */
  const filtroBruto = parametros.get("canal");
  const filtro: Filtro = CANAIS.includes(filtroBruto as CanalAtendimento)
    ? (filtroBruto as CanalAtendimento)
    : "todos";

  const trocarFiltro = (f: Filtro) => {
    const novos = new URLSearchParams(parametros);
    if (f === "todos") novos.delete("canal");
    else novos.set("canal", f);
    setParametros(novos, { replace: true });
  };

  const mensagens = useMemo(() => data?.mensagens ?? [], [data]);
  const contatos = useMemo(() => data?.contatos ?? {}, [data]);

  // ---------- as conversas ----------
  const conversas = useMemo<Conversa[]>(() => {
    const mapa = new Map<string, Conversa>();

    for (const m of mensagens) {
      const contato = m.contact_id ? contatos[m.contact_id] ?? null : null;
      const key = `${m.canal}:${m.contact_id || m.identidade}`;
      const existente = mapa.get(key);

      if (!existente) {
        mapa.set(key, {
          key,
          canal: m.canal,
          contact_id: m.contact_id,
          identidade: m.identidade,
          contato,
          ultimo_texto: m.texto,
          ultimo_assunto: m.assunto,
          ultimo_em: m.created_at,
          ultima_entrada_em: m.direction === "inbound" ? m.created_at : null,
          nao_lidas: m.direction === "inbound" && !m.lido ? 1 : 0,
        });
        continue;
      }

      if (m.created_at > existente.ultimo_em) {
        existente.ultimo_texto = m.texto;
        existente.ultimo_assunto = m.assunto;
        existente.ultimo_em = m.created_at;
      }
      if (m.direction === "inbound") {
        if (!existente.ultima_entrada_em || m.created_at > existente.ultima_entrada_em) {
          existente.ultima_entrada_em = m.created_at;
        }
        if (!m.lido) existente.nao_lidas += 1;
      }
      if (!existente.contato && contato) existente.contato = contato;
    }

    // Mais recente primeiro, e a ordenação é sobre a lista MISTURADA: é o que
    // faz "quem está esperando há mais tempo" valer entre canais, e não dentro
    // de cada um.
    return Array.from(mapa.values()).sort((a, b) => b.ultimo_em.localeCompare(a.ultimo_em));
  }, [mensagens, contatos]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return conversas
      .filter((c) => filtro === "todos" || c.canal === filtro)
      .filter((c) => {
        if (!q) return true;
        return (
          rotuloDaConversa(c).toLowerCase().includes(q) ||
          c.identidade.toLowerCase().includes(q) ||
          (c.ultimo_assunto ?? "").toLowerCase().includes(q) ||
          (c.ultimo_texto ?? "").toLowerCase().includes(q)
        );
      });
  }, [conversas, filtro, busca]);

  const aberta = conversas.find((c) => c.key === selecionada) ?? null;

  const daConversa = useMemo<MensagemUnificada[]>(() => {
    if (!aberta) return [];
    return mensagens.filter((m) => {
      if (m.canal !== aberta.canal) return false;
      if (aberta.contact_id) return m.contact_id === aberta.contact_id;
      return m.identidade === aberta.identidade && !m.contact_id;
    });
  }, [mensagens, aberta]);

  /** Os outros canais em que o MESMO contato falou. */
  const tambemEm = useMemo(() => {
    if (!aberta?.contact_id) return [] as Conversa[];
    return conversas.filter((c) => c.contact_id === aberta.contact_id && c.key !== aberta.key);
  }, [conversas, aberta]);

  // Abrir a conversa é ler: o e-mail deixa de contar como não lido, aqui e na
  // caixa completa — as duas leem a mesma tabela.
  useEffect(() => {
    if (!aberta || aberta.canal !== "email") return;
    for (const m of daConversa) {
      if (m.direction === "inbound" && !m.lido) marcarLido.mutate(m.id);
    }
    // `marcarLido` muda de identidade a cada render do hook de mutação; incluí-lo
    // faria o efeito rodar em laço.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta?.key, daConversa]);

  useEffect(() => {
    const t = setTimeout(() => rolagem.current?.scrollTo({ top: 1e9, behavior: "smooth" }), 50);
    return () => clearTimeout(t);
  }, [selecionada, daConversa.length]);

  const janela = janelaDaConversa(aberta);

  async function enviar() {
    if (!aberta || !orgId || !rascunho.trim() || !janela.podeEnviar) return;

    setEnviando(true);
    const texto = rascunho.trim();
    setRascunho("");
    try {
      await enviarPeloCanal({
        canal: aberta.canal,
        texto,
        contactId: aberta.contact_id,
        dealId: daConversa[daConversa.length - 1]?.deal_id ?? null,
        identidade: aberta.identidade,
        assunto: aberta.ultimo_assunto,
        orgId,
        userId: user?.id ?? null,
      });
      // O e-mail não chega por tempo real: a linha só existe depois que a função
      // grava. Reler é o que faz a mensagem enviada aparecer na thread.
      if (aberta.canal === "email") void refetch();
      toast({ title: "Enviado" });
    } catch (e) {
      toast({ title: "Erro ao enviar", description: mensagemErro(e), variant: "destructive" });
      // Devolve o texto: perder o que se digitou por causa de uma falha de rede
      // é o pior desfecho possível numa caixa de mensagem.
      setRascunho(texto);
    } finally {
      setEnviando(false);
    }
  }

  if (!orgId) return <SemOrganizacao />;

  /**
   * Só avisa sobre o canal que o filtro está mostrando. Um aviso por canal
   * desconectado, todos de uma vez, cobriria a lista de tarja para quem usa só
   * e-mail -- que é a maioria no começo.
   */
  const desconectados = CANAIS.filter((c) => {
    if (filtro !== "todos" && filtro !== c) return false;
    if (c === "whatsapp") return conectados?.whatsapp === false;
    if (c === "instagram") return conectados?.instagram === false;
    return false;
  });

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <PageHeader
        title="Atendimento"
        description="E-mail, WhatsApp e Instagram na mesma fila, do mais recente para o mais antigo"
        contagem={{ valor: visiveis.length, unidade: "conversa" }}
        actions={
          <Button variant="outline" size="sm" className="h-8 text-label" asChild>
            <Link to="/inbox">
              <Inbox className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Caixa de e-mail completa
            </Link>
          </Button>
        }
      />

      {desconectados.map((c) => (
        <div
          key={c}
          className="mx-4 mt-3 flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="flex-1">
            {ROTULO_CANAL[c]} ainda não está conectado.{" "}
            <Link to="/settings/integrations" className="font-medium underline">Conectar agora</Link>
          </div>
        </div>
      ))}

      <div className="mt-3 grid flex-1 grid-cols-1 overflow-hidden border-t md:grid-cols-[340px_1fr]">
        {/* `bg-card/50` e não `bg-muted`: `--muted` tem o MESMO valor de
            `--background`, então a coluna cinza seria invisível no tema claro. */}
        <aside className="flex min-h-0 flex-col border-r bg-card/50">
          <div className="space-y-2 border-b p-3">
            {/* Sem ícone de propósito. Quatro canais dividem uma coluna de
                330px, e ícone + rótulo não cabem: os ícones custam ~56px mais
                os vãos, e o grupo ou vazava ou truncava para "Whats…".
                Aqui o ícone não carrega informação -- é um filtro, o rótulo
                já diz tudo. Quem PRECISA do ícone é a linha da conversa, onde
                o canal é dado e não controle, e lá ele continua ao lado do
                rótulo (nunca cor sozinha). */}
            <SegmentedControl<Filtro>
              rotuloGrupo="Canal"
              valor={filtro}
              onChange={trocarFiltro}
              compactoNoCelular={false}
              className="w-full"
              opcoes={[
                { valor: "todos", rotulo: "Todos" },
                { valor: "email", rotulo: "E-mail" },
                { valor: "whatsapp", rotulo: "WhatsApp" },
                { valor: "instagram", rotulo: "Instagram" },
              ]}
            />
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar pessoa, assunto ou mensagem"
                aria-label="Buscar conversa"
                className="pl-8"
              />
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {/* Ordem obrigatória: erro ANTES de vazio. Consulta que falhou volta
                vazia, e dizer "nenhuma conversa" aí é afirmar um fato que a tela
                não conhece. */}
            {isLoading ? (
              <LoadingState linhas={6} className="p-3" />
            ) : isError ? (
              <ErrorState className="m-3" onTentarNovamente={() => void refetch()} />
            ) : visiveis.length === 0 ? (
              <EmptyState
                icone={Inbox}
                titulo={busca.trim() ? "Nada encontrado" : "Nenhuma conversa ainda"}
                descricao={
                  busca.trim()
                    ? "Nenhuma conversa casa com o que você digitou."
                    : "Quando alguém escrever por e-mail, WhatsApp ou Instagram, a conversa aparece aqui."
                }
              />
            ) : (
              <ul className="divide-y">
                {visiveis.map((c) => {
                  const nome = rotuloDaConversa(c);
                  const ativa = c.key === selecionada;
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        onClick={() => setSelecionada(c.key)}
                        aria-current={ativa ? "true" : undefined}
                        className={cn(
                          "flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-accent/50",
                          ativa && "bg-accent",
                        )}
                      >
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {iniciais(nome)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="flex items-center justify-between gap-2">
                            <span className={cn("truncate text-sm", c.nao_lidas > 0 ? "font-bold" : "font-medium")}>
                              {nome}
                            </span>
                            <span className="shrink-0 text-label tabular-nums text-muted-foreground">
                              {formatarQuando(c.ultimo_em)}
                            </span>
                          </div>
                          {/* O canal em ÍCONE E TEXTO: só a cor deixaria sem a
                              informação quem não a distingue. */}
                          <div className="mt-0.5 flex items-center gap-2">
                            <SeloDeCanal canal={c.canal} />
                            {c.nao_lidas > 0 && (
                              <Badge variant="secondary" className="h-4 tabular-nums">
                                {c.nao_lidas} {c.nao_lidas === 1 ? "nova" : "novas"}
                              </Badge>
                            )}
                          </div>
                          <span className="mt-0.5 truncate text-xs text-muted-foreground">
                            {c.ultimo_assunto ? `${c.ultimo_assunto} — ` : ""}
                            {c.ultimo_texto || "Sem mensagens"}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden bg-background">
          {!aberta ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
              Selecione uma conversa
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {iniciais(rotuloDaConversa(aberta))}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{rotuloDaConversa(aberta)}</div>
                    <div className="flex flex-wrap items-center gap-1 text-label text-muted-foreground">
                      {aberta.canal === "instagram" && (
                        <>
                          <AtSign className="h-3 w-3" aria-hidden="true" />
                          {aberta.contato?.instagram_username ?? "Instagram Direct"}
                        </>
                      )}
                      {aberta.canal === "whatsapp" && (
                        <>
                          <Phone className="h-3 w-3" aria-hidden="true" />
                          {formatarTelefone(aberta.identidade)}
                        </>
                      )}
                      {aberta.canal === "email" && (
                        <>
                          <Mail className="h-3 w-3" aria-hidden="true" />
                          {aberta.identidade}
                        </>
                      )}
                      <span className="mx-1 text-muted-foreground/50">·</span>
                      {ROTULO_CANAL[aberta.canal]}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* A MESMA PESSOA NOS OUTROS CANAIS.
                      Era o pior sintoma das três telas: quem escrevia por dois
                      canais virava dois atendimentos, e um não sabia do outro. */}
                  {tambemEm.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-label text-muted-foreground">Também em:</span>
                      {tambemEm.map((c) => {
                        const Icone = ICONE_CANAL[c.canal];
                        return (
                          <Button
                            key={c.key}
                            variant="outline"
                            size="sm"
                            className="h-8 text-label"
                            onClick={() => { setSelecionada(c.key); trocarFiltro("todos"); }}
                          >
                            <Icone className="mr-1 h-3 w-3" aria-hidden="true" />
                            {ROTULO_CANAL[c.canal]}
                          </Button>
                        );
                      })}
                    </div>
                  )}
                  {aberta.contact_id ? (
                    <Button variant="outline" size="sm" className="h-8 text-label" asChild>
                      <Link to={`/contacts?id=${aberta.contact_id}`}>Ver contato</Link>
                    </Button>
                  ) : (
                    <span className="text-label text-muted-foreground">Sem contato vinculado</span>
                  )}
                </div>
              </header>

              <div ref={rolagem} className="min-h-0 flex-1 overflow-y-auto p-4">
                <ul className="space-y-2">
                  {daConversa.map((m) => {
                    const saiu = m.direction === "outbound";
                    return (
                      <li key={m.id} className={cn("flex", saiu ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[75%] rounded-lg px-3 py-2 text-xs shadow-sm",
                            saiu ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                          )}
                        >
                          {m.assunto && (
                            <div className="mb-1 text-xs font-semibold">{m.assunto}</div>
                          )}
                          {m.html ? (
                            <div
                              className="prose prose-sm max-w-none text-xs dark:prose-invert [&_*]:!text-inherit"
                              dangerouslySetInnerHTML={{
                                __html: DOMPurify.sanitize(m.html, {
                                  FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
                                  FORBID_ATTR: ["onerror", "onload", "onclick"],
                                }),
                              }}
                            />
                          ) : (
                            <div className="whitespace-pre-wrap break-words">
                              {/* Mensagem sem texto é anexo. Sem esta linha a bolha
                                  aparece VAZIA, e bolha vazia parece defeito da
                                  tela -- não "ela mandou uma foto". */}
                              {m.texto || (
                                <span className="italic opacity-80">{descricaoDeAnexo(m.message_type)}</span>
                              )}
                            </div>
                          )}
                          <div
                            className={cn(
                              "mt-1 flex items-center justify-end gap-1 text-label",
                              saiu ? "text-primary-foreground/70" : "text-muted-foreground",
                            )}
                          >
                            {formatarQuando(m.created_at)}
                            {saiu && (m.status === "delivered" || m.status === "read") && (
                              <CheckCheck className="h-3 w-3" aria-hidden="true" />
                            )}
                            {saiu && m.status === "failed" && (
                              <AlertCircle className="h-3 w-3 text-destructive" aria-hidden="true" />
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <footer className="border-t bg-card p-3">
                {janela.aviso && (
                  <div
                    className={cn(
                      "mb-2 rounded-md border px-2 py-1.5 text-label",
                      janela.podeEnviar
                        // Aviso que não bloqueia é informação, não alarme.
                        ? "border-border bg-muted text-muted-foreground"
                        : "border-warning/30 bg-warning/10 text-warning",
                    )}
                  >
                    {janela.aviso}
                  </div>
                )}
                {aberta.canal === "email" && janela.podeEnviar && (
                  <p className="mb-2 text-label text-muted-foreground">
                    A resposta sai pela sua conta conectada, com o assunto{" "}
                    <span className="font-medium">
                      {aberta.ultimo_assunto?.toLowerCase().startsWith("re:")
                        ? aberta.ultimo_assunto
                        : `Re: ${aberta.ultimo_assunto ?? ""}`}
                    </span>
                  </p>
                )}
                <div className="flex gap-2">
                  <Textarea
                    value={rascunho}
                    onChange={(e) => setRascunho(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); }
                    }}
                    placeholder={janela.podeEnviar ? "Digite uma mensagem..." : "Resposta indisponível neste canal"}
                    aria-label={`Responder por ${ROTULO_CANAL[aberta.canal]}`}
                    disabled={!janela.podeEnviar || enviando}
                    rows={2}
                    className="resize-none"
                  />
                  <Button
                    onClick={() => void enviar()}
                    disabled={!rascunho.trim() || enviando || !janela.podeEnviar}
                    aria-label={`Enviar por ${ROTULO_CANAL[aberta.canal]}`}
                  >
                    {enviando
                      ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      : <Send className="h-4 w-4" aria-hidden="true" />}
                  </Button>
                </div>
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
