/**
 * Sessões ativas — quem está usando, de qual máquina, com qual conta.
 *
 * Vem de `auth.sessions` via `list_org_sessions()`: o Supabase já registrava
 * user agent, IP e última atividade, mas o schema `auth` não é exposto pela API.
 * A aba anterior mostrava um cartão fixo escrito "Este dispositivo", sem
 * consultar nada.
 *
 * Cada pessoa vê as próprias sessões; administrador vê as da organização.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Monitor, Smartphone, Tablet, HelpCircle, LogOut, RefreshCw, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { lerUserAgent, tempoRelativo } from "@/lib/user-agent";
import { mensagemErro } from "@/lib/erro-supabase";

type Sessao = {
  session_id: string;
  user_id: string;
  pessoa: string;
  email: string;
  papel: string;
  user_agent: string | null;
  ip: string | null;
  criada_em: string;
  ultima_atividade: string;
  expira_em: string | null;
  atual: boolean;
};

const PAPEL: Record<string, string> = {
  owner: "Proprietário", admin: "Administrador", member: "Comercial", "sem papel": "Sem papel",
};

const ICONE = { computador: Monitor, celular: Smartphone, tablet: Tablet, desconhecido: HelpCircle };

export default function SessionsPanel({ isAdmin }: { isAdmin: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sessoes, setSessoes] = useState<Sessao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [encerrando, setEncerrando] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    // `.call(supabase, ...)` de propósito: destacar `supabase.rpc` numa
    // variável perde o `this` e estoura antes do await.
    let data: Sessao[] | null = null;
    let error: { message: string } | null = null;
    try {
      const r = await (supabase.rpc as unknown as (
        fn: string,
      ) => Promise<{ data: Sessao[] | null; error: { message: string } | null }>
      ).call(supabase, "list_org_sessions");
      data = r.data;
      error = r.error;
    } catch (e) {
      error = { message: mensagemErro(e) };
    }

    setCarregando(false);
    if (error) {
      setErro(error.message);
      return;
    }
    setErro(null);
    setSessoes(data ?? []);
  }, []);

  useEffect(() => { buscar(); }, [buscar]);

  const encerrar = async (s: Sessao) => {
    setEncerrando(s.session_id);
    let error: { message: string } | null = null;
    try {
      const r = await (supabase.rpc as unknown as (
        fn: string, args: Record<string, string>,
      ) => Promise<{ error: { message: string } | null }>
      ).call(supabase, "revoke_session", { _session_id: s.session_id });
      error = r.error;
    } catch (e) {
      error = { message: mensagemErro(e) };
    } finally {
      setEncerrando(null);
    }

    if (error) {
      toast({ title: "Não foi possível encerrar", description: error.message, variant: "destructive" });
      return;
    }

    // Encerrar a própria sessão atual significa sair agora.
    if (s.atual) {
      await supabase.auth.signOut();
      window.location.href = "/";
      return;
    }

    toast({
      title: "Sessão encerrada",
      description: "O acesso pelo token atual dela expira em até 1 hora — é o tempo de vida do token.",
    });
    buscar();
  };

  const encerrarTodasMinhas = async () => {
    await supabase.auth.signOut({ scope: "global" });
    window.location.href = "/";
  };

  if (carregando) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Carregando sessões…</p>;
  }

  if (erro) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Sessões indisponíveis</CardTitle>
          <CardDescription>
            {erro.includes("does not exist") || erro.includes("Could not find")
              ? "A função list_org_sessions ainda não existe no banco. Aplique a migração 20260818150000_sessoes.sql."
              : erro}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Agrupa por pessoa quando é admin — a leitura que importa é "quem está
  // dentro", não uma lista plana de dispositivos.
  const porPessoa = new Map<string, Sessao[]>();
  for (const s of sessoes) {
    const lista = porPessoa.get(s.user_id) ?? [];
    lista.push(s);
    porPessoa.set(s.user_id, lista);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {sessoes.length} {sessoes.length === 1 ? "sessão ativa" : "sessões ativas"}
            {isAdmin && porPessoa.size > 1 && ` · ${porPessoa.size} pessoas`}
          </p>
          <p className="text-xs text-muted-foreground">
            {isAdmin ? "Todas as sessões da empresa." : "Somente as suas sessões."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setCarregando(true); buscar(); }}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Atualizar
        </Button>
      </div>

      {sessoes.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma sessão registrada.
        </p>
      )}

      {[...porPessoa.entries()].map(([userId, lista]) => {
        const p = lista[0];
        const euMesmo = userId === user?.id;

        return (
          <Card key={userId}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-xs text-primary">
                      {p.pessoa.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2">
                      <span className="truncate">{p.pessoa}</span>
                      {euMesmo && <Badge variant="secondary" className="text-micro">você</Badge>}
                    </CardTitle>
                    <CardDescription className="truncate">
                      {p.email} · {PAPEL[p.papel] ?? p.papel}
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0 text-label">
                  {lista.length} {lista.length === 1 ? "dispositivo" : "dispositivos"}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-2">
              {lista.map((s) => {
                const d = lerUserAgent(s.user_agent);
                const Icone = ICONE[d.tipo];

                return (
                  <div
                    key={s.session_id}
                    className={`flex items-center gap-3 rounded-lg border p-2.5 ${
                      s.atual ? "border-primary/40 bg-primary/5" : "border-border"
                    }`}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Icone className="h-4 w-4 text-muted-foreground" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{d.rotulo}</p>
                        {s.atual && (
                          <Badge className="bg-emerald-500/10 text-micro text-emerald-500 hover:bg-emerald-500/10">
                            este dispositivo
                          </Badge>
                        )}
                      </div>
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-muted-foreground">
                        <span className="tabular-nums">Ativa {tempoRelativo(s.ultima_atividade)}</span>
                        {s.ip && (
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            <span className="tabular-nums">{s.ip}</span>
                          </span>
                        )}
                        <span className="tabular-nums">
                          entrou {tempoRelativo(s.criada_em)}
                        </span>
                      </p>
                    </div>

                    {(euMesmo || isAdmin) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={encerrando === s.session_id}
                        onClick={() => encerrar(s)}
                      >
                        <LogOut className="mr-1 h-3.5 w-3.5" />
                        {s.atual ? "Sair" : "Encerrar"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      <Card className="border-border/60">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="min-w-0">
            <p className="text-sm font-medium">Sair de todos os meus dispositivos</p>
            <p className="text-meta text-muted-foreground">
              Encerra as suas sessões em todo lugar, inclusive esta.
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={encerrarTodasMinhas}>
            <LogOut className="mr-1.5 h-3.5 w-3.5" />Sair de tudo
          </Button>
        </CardContent>
      </Card>

      <p className="text-meta leading-relaxed text-muted-foreground">
        Encerrar uma sessão invalida a renovação do acesso. O token que já está
        na mão daquele dispositivo continua valendo até expirar — no máximo uma
        hora. É como JWT funciona: token emitido não se revoga.
      </p>
    </div>
  );
}
