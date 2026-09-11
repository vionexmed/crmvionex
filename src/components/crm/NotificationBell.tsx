import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Bell, Clock, Check, UserPlus } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { formatarDataHoraCurta, formatarTempoRelativo } from "@/lib/formato";
import { ATIVIDADE_ICONE } from "@/lib/atividade-tipos";
import { nomeDoContato } from "@/lib/contato-formato";

type Activity = Database["public"]["Tables"]["activities"]["Row"];

type LeadNovo = {
  id: string;
  nome: string;
  created_at: string;
};

/**
 * Até quando os leads já foram vistos, por organização.
 *
 * Em localStorage e não em tabela: é preferência de UMA aba de UMA pessoa, do
 * mesmo tipo que a coluna colapsada da lateral. Uma tabela nova exigiria RLS,
 * migração e limpeza, para guardar um instante que ninguém audita.
 */
const chaveVistos = (orgId: string) => `vionex:leads-vistos:${orgId}`;

function lerVistos(orgId: string): string {
  try {
    const salvo = localStorage.getItem(chaveVistos(orgId));
    if (salvo) return salvo;
  } catch {
    // Janela privada, site data bloqueado. Sem memória, o padrão é "agora": o
    // sininho começa limpo em vez de anunciar a base inteira.
  }
  const agora = new Date().toISOString();
  try { localStorage.setItem(chaveVistos(orgId), agora); } catch { /* idem */ }
  return agora;
}

export function NotificationBell() {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState<Activity[]>([]);
  const [leads, setLeads] = useState<LeadNovo[]>([]);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const buscar = useCallback(async () => {
    if (!orgId || !user) return;

    const hoje = new Date();
    hoje.setHours(23, 59, 59, 999);

    const desde = lerVistos(orgId);

    const [{ data: atividades }, { data: novos }] = await Promise.all([
      supabase
        .from("activities")
        .select("*")
        .eq("org_id", orgId)
        .eq("user_id", user.id)
        .is("completed_at", null)
        .lte("due_date", hoje.toISOString())
        .order("due_date", { ascending: true })
        .limit(20),

      // Lead que chegou desde a última olhada.
      //
      // `importado_em IS NULL` é o filtro que importa: planilha importada não é
      // notícia. Quem cola 500 linhas sabe que colou -- anunciá-las faria o
      // sininho gritar por um trabalho que a própria pessoa acabou de fazer, e
      // enterraria o lead que chegou de verdade.
      //
      // A base de contatos é da organização inteira (20260909120000), então o
      // sininho anuncia lead novo para todo mundo -- inclusive o que caiu na
      // mão de outra pessoa. É o ponto: a equipe fica sabendo que entrou.
      supabase
        .from("contacts")
        .select("id, first_name, last_name, created_at")
        .eq("org_id", orgId)
        .eq("lifecycle_stage", "lead")
        .gt("created_at", desde)
        .is("metadata->>importado_em", null)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    setPending(atividades || []);
    setLeads(
      (novos || []).map((c) => ({
        id: c.id as string,
        nome: nomeDoContato(c.first_name as string, c.last_name as string | null),
        created_at: c.created_at as string,
      })),
    );
  }, [orgId, user]);

  useEffect(() => { void buscar(); }, [buscar]);

  // A cada 60s. Não abro assinatura de realtime: uma para `contacts` da
  // organização inteira custa uma conexão aberta por aba, e sessenta segundos é
  // resposta de sobra para um sininho.
  useEffect(() => {
    const t = setInterval(() => { void buscar(); }, 60_000);
    return () => clearInterval(t);
  }, [buscar]);

  const concluir = async (id: string) => {
    await supabase.from("activities").update({ completed_at: new Date().toISOString() }).eq("id", id);
    void buscar();
  };

  const marcarTudoLido = () => {
    setDismissed(new Set(pending.map((p) => p.id)));
    // Os leads saem de vez: a marca de "visto" avança, então eles não voltam no
    // próximo ciclo. Atividade pendente continua pendente -- ela some quando é
    // concluída, não quando é lida.
    if (orgId) {
      try { localStorage.setItem(chaveVistos(orgId), new Date().toISOString()); } catch { /* ignorado */ }
    }
    setLeads([]);
  };

  const naoLidas = pending.filter((p) => !dismissed.has(p.id)).length + leads.length;
  const vazio = pending.length === 0 && leads.length === 0;

  const atrasada = (a: Activity) => a.due_date && new Date(a.due_date) < new Date();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
          <Bell className="h-4 w-4" />
          {naoLidas > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-label font-bold text-destructive-foreground">
              {naoLidas > 99 ? "99+" : naoLidas}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-sm font-semibold">Notificações</span>
          {!vazio && (
            <button onClick={marcarTudoLido} className="text-xs text-primary hover:underline">
              Marcar tudo como lido
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {vazio && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nada novo por aqui
            </div>
          )}

          {/* Leads primeiro: é o que acabou de chegar e ninguém viu ainda. */}
          {leads.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                setOpen(false);
                navigate("/contacts?estagio=lead");
              }}
              className="flex w-full items-start gap-3 border-b border-border bg-primary/[0.04] px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <UserPlus className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{l.nome}</p>
                <p className="text-label text-muted-foreground">
                  Novo lead · {formatarTempoRelativo(l.created_at)}
                </p>
              </div>
            </button>
          ))}

          {pending.map((a) => {
            const Icone = ATIVIDADE_ICONE[a.type];
            const venceu = atrasada(a);
            const lida = dismissed.has(a.id);
            return (
              <div
                key={a.id}
                className={`flex items-start gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 ${
                  lida ? "opacity-50" : "bg-muted/30"
                }`}
              >
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${venceu ? "bg-destructive/10" : "bg-primary/10"}`}>
                  <Icone className={`h-3.5 w-3.5 ${venceu ? "text-destructive" : "text-primary"}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{a.title}</p>
                  <p className={`text-label ${venceu ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                    <Clock className="mr-0.5 inline h-2.5 w-2.5" />
                    {a.due_date ? formatarDataHoraCurta(a.due_date) : "Sem data"}
                    {venceu && " · Atrasada"}
                  </p>
                </div>
                <button
                  onClick={() => concluir(a.id)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-success/10 hover:text-success"
                  title="Marcar como concluído"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
