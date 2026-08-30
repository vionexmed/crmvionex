import { useState, useRef, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import ReactMarkdown from "react-markdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Send, Loader2, Sparkles, User, Briefcase } from "lucide-react";
import { formatarNumero } from "@/lib/formato";

type Msg = { role: "user" | "assistant"; content: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-sales-manager`;

const SUGGESTIONS = [
  "Como está minha operação de prospecção neste período?",
  "Onde estou perdendo lead no funil?",
  "Minha taxa de resposta está boa? Como melhorar?",
  "Tenho lead esperando atendimento? O que priorizar agora?",
  "Meu tempo de resposta está aceitável?",
  "Me dê um plano de ação para esta semana",
];

/**
 * Métricas do painel de SDR. `null` significa que a métrica não é calculável —
 * ou não tem fonte no banco, ou o período não tem dado. O contexto diz isso ao
 * modelo em texto, para ele não tratar ausência como zero.
 */
interface CrmData {
  periodo: string;
  leadsRecebidos: number | null;
  abordagens: number | null;
  taxaEntrega: number | null;
  taxaResposta: number | null;
  conversasIniciadas: number | null;
  reunioes: number | null;
  oportunidades: number | null;
  vendasSdr: number | null;
  tempoRespostaMin: number | null;
  aguardandoHumano: number | null;
  leadsWhatsapp: number | null;
  /** Métricas exibidas na tela como "sem fonte" — o modelo não deve inventá-las. */
  semFonte: string[];
}

interface DashboardAIChatProps {
  crmData: CrmData;
}

function buildCrmContext(data: CrmData): string {
  const num = (v: number | null, sufixo = "") =>
    v === null ? "não disponível" : `${formatarNumero(v)}${sufixo}`;

  const duracao = (v: number | null) => {
    if (v === null) return "não disponível";
    if (v < 60) return `${v} min`;
    const h = Math.floor(v / 60);
    return h < 24 ? `${h}h ${v % 60}min` : `${Math.floor(h / 24)}d ${h % 24}h`;
  };

  const taxa = (v: number | null) => (v === null ? "não disponível" : `${v}%`);

  let ctx = `PAINEL DE SDR — ${data.periodo} (dados em tempo real).
A operação de prospecção hoje é feita por uma pessoa do comercial; a automação por IA ainda não existe.

ENTRADA
- Leads recebidos: ${num(data.leadsRecebidos)}
- Leads que chegaram por WhatsApp: ${num(data.leadsWhatsapp)}

ABORDAGEM
- Abordagens realizadas: ${num(data.abordagens)}
- Taxa de entrega (WhatsApp): ${taxa(data.taxaEntrega)}
- Taxa de resposta (WhatsApp): ${taxa(data.taxaResposta)}
- Conversas iniciadas: ${num(data.conversasIniciadas)}

CONVERSÃO
- Reuniões geradas: ${num(data.reunioes)}
- Oportunidades geradas: ${num(data.oportunidades)}
- Vendas originadas pelo SDR: ${num(data.vendasSdr)}

OPERAÇÃO
- Tempo médio de resposta: ${duracao(data.tempoRespostaMin)}
- Leads aguardando atendimento (fila atual, sem nenhuma abordagem): ${num(data.aguardandoHumano)}`;

  if (data.semFonte.length > 0) {
    ctx += `\n\nMÉTRICAS SEM FONTE DE DADO (não existem no banco — NUNCA estime ou invente valor para elas; se perguntado, diga que falta instrumentar):
${data.semFonte.map((m) => `- ${m}`).join("\n")}`;
  }

  ctx += `\n\nRESSALVAS que você deve considerar ao analisar:
- Taxa de entrega e de resposta cobrem apenas WhatsApp. E-mail não tem captura de entrega.
- Reuniões só existem se alguém registrar a atividade; não há integração de agenda.
- "Vendas originadas pelo SDR" é aproximação: negócio ganho com contato vinculado.
- Onde aparecer "não disponível", trate como ausência de dado, nunca como zero.`;

  return ctx;
}

export function DashboardAIChat({ crmData }: DashboardAIChatProps) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const crmContext = useMemo(() => buildCrmContext(crmData), [crmData]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || isLoading) return;

    const userMsg: Msg = { role: "user", content: msg };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    let assistantSoFar = "";
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: [...messages, userMsg],
          crmContext,
        }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        upsertAssistant(errData.error || "Erro ao processar. Tente novamente.");
        setIsLoading(false);
        return;
      }

      if (!resp.body) {
        upsertAssistant("Erro: resposta vazia");
        setIsLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsertAssistant(content);
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }
    } catch (e) {
      console.error("AI Sales Manager error:", e);
      upsertAssistant("Erro de conexão. Verifique sua internet.");
    }

    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2 border-b">
        <CardTitle className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Briefcase className="h-4 w-4 text-primary" />
          </div>
          <div>
            <span className="font-semibold">Gerente Comercial IA</span>
            <p className="text-label text-muted-foreground font-normal">
              Carlos · Análise em tempo real do seu CRM
            </p>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {/* Messages area */}
        <ScrollArea className="h-[320px] px-4" ref={scrollRef as any}>
          <div className="py-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-6">
                <Sparkles className="h-8 w-8 text-primary/30 mx-auto mb-3" />
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  Olá! Sou o Carlos, seu gerente comercial de IA.
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  Tenho acesso completo aos dados do seu CRM. Como posso ajudar?
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center max-w-md mx-auto">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className="text-label px-2.5 py-1.5 rounded-full border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                    <Bot className="h-3 w-3 text-primary" />
                  </div>
                )}
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}>
                  {msg.role === "assistant" ? (
                    <div className="prose prose-xs prose-neutral dark:prose-invert max-w-none [&_p]:m-0 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_code]:text-label [&_table]:text-label">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground/10 mt-0.5">
                    <User className="h-3 w-3" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                  <Bot className="h-3 w-3 text-primary" />
                </div>
                <div className="bg-muted rounded-lg px-3 py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="border-t px-3 py-2">
          <div className="flex gap-2">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte ao Carlos sobre seu funil, negócios, equipe..."
              className="min-h-[36px] max-h-[80px] resize-none text-xs"
              rows={1}
            />
            <Button
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
