import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  UserPlus, Shield, Trash2, Plus, Users, Crown, Mail,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";
import { mensagemErro } from "@/lib/erro-supabase";
import { PageTabs } from "@/components/layout/PageTabs";
import { KeyRound, UserRound, UsersRound } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const ROLES: Array<{ value: string; label: string }> = [
  { value: "owner", label: "Proprietário" },
  { value: "admin", label: "Administrador" },
  { value: "member", label: "Comercial" },
];

// O que cada papel PODE fazer — reflete as políticas RLS reais do banco
// (migration 20260702110000_rbac_comercial). Não é configurável na UI:
// alterar exige mudança de política no banco.
const ROLE_CAPABILITIES: Array<{ label: string; owner: string; admin: string; member: string }> = [
  { label: "Contatos, leads e negócios", owner: "Todos", admin: "Todos", member: "Só os próprios" },
  { label: "Distribuir leads (mudar responsável)", owner: "Sim", admin: "Sim", member: "Não" },
  { label: "Excluir contatos/negócios", owner: "Sim", admin: "Sim", member: "Não" },
  { label: "Exportar dados", owner: "Sim", admin: "Sim", member: "Não" },
  { label: "Metas e Relatórios", owner: "Sim", admin: "Sim", member: "Dos próprios dados" },
  { label: "Caixa de e-mail, Conversas e Marketing", owner: "Sim", admin: "Sim", member: "Não" },
  { label: "Automações, Templates e Sequências", owner: "Sim", admin: "Sim", member: "Não" },
  { label: "Configurações, Integrações e Equipe", owner: "Sim", admin: "Sim", member: "Não" },
  { label: "Alterar papéis de membros", owner: "Sim", admin: "Não", member: "Não" },
];

export default function Team() {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const { toast } = useToast();

  const [members, setMembers] = useState<(Profile & { role?: string; receives_leads?: boolean })[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);

  // Remoção de membro: quem sai e para quem vai o trabalho dele
  const [removendo, setRemovendo] = useState<(Profile & { role?: string }) | null>(null);
  const [herdeiro, setHerdeiro] = useState<string>("");
  const [removendoAgora, setRemovendoAgora] = useState(false);
  // Apagar a conta é irreversível e não deve ser efeito colateral de remover:
  // é escolha marcada de propósito. Ligado por padrão porque, sem isso,
  // convidar o mesmo e-mail de novo falha com "already been registered".
  const [apagarConta, setApagarConta] = useState(true);

  // Teams
  const [teams, setTeams] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [newTeamName, setNewTeamName] = useState("");

  const currentUserRole = useMemo(() => {
    const m = members.find((m) => m.id === user?.id);
    return m?.role || "member";
  }, [members, user]);

  const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";
  // Só proprietário mexe em papel e em rodízio de lead. Não é escolha de tela:
  // as policies "Owners can update/delete roles" são owner-only desde março, e
  // a aba Permissões já documentava a regra. Antes o seletor aparecia para
  // admin também, e ele tomava erro do banco ao tentar usar.
  const isOwner = currentUserRole === "owner";

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    const [{ data: profs }, { data: rl }, { data: inv }, { data: tms }, { data: tmem }] = await Promise.all([
      supabase.from("profiles").select("*").eq("org_id", orgId),
      supabase.from("user_roles").select("*").eq("org_id", orgId),
      supabase.from("invitations").select("*").eq("org_id", orgId).is("accepted_at", null),
      supabase.from("teams").select("*").eq("org_id", orgId),
      supabase.from("team_members").select("*"),
    ]);
    setInvitations(inv || []);
    setTeams(tms || []);
    setTeamMembers(tmem || []);
    const merged = (profs || []).map((p) => {
      const r = (rl || []).find((r: any) => r.user_id === p.id);
      return {
        ...p,
        role: r?.role || "member",
        // Quem não tem linha em user_roles não está no rodízio de jeito nenhum.
        receives_leads: r ? r.receives_leads !== false : false,
      };
    });
    setMembers(merged);
  }, [orgId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /** Liga/desliga o membro do rodízio de distribuição de lead. */
  const toggleReceivesLeads = async (uid: string, valor: boolean) => {
    if (!orgId) return;
    const { error } = await supabase
      .from("user_roles")
      .update({ receives_leads: valor })
      .eq("user_id", uid)
      .eq("org_id", orgId);
    if (error) {
      toast({ title: "Erro ao alterar", description: error.message, variant: "destructive" });
      return;
    }
    fetchAll();
  };

  const sendInvite = async () => {
    if (!orgId || !inviteEmail) return;
    setInviting(true);
    try {
      const res = await supabase.functions.invoke("invite-member", {
        body: { email: inviteEmail, role: inviteRole, org_id: orgId },
      });
      // Em erros não-2xx o corpo real fica em error.context — extrai a mensagem
      let errMsg = (res.data as { error?: string } | null)?.error;
      if (!errMsg && res.error) {
        errMsg = res.error.message;
        try {
          const body = await (res.error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
          if (body?.error) errMsg = body.error;
        } catch { /* mantém a mensagem genérica */ }
      }
      if (errMsg) {
        toast({ title: "Erro ao convidar", description: errMsg, variant: "destructive" });
      } else {
        const resent = (res.data as { resent?: boolean } | null)?.resent;
        toast({
          title: resent ? "Acesso reenviado!" : "Convite enviado!",
          description: resent
            ? `${inviteEmail} já tinha conta — enviamos um link de acesso; ao entrar, ele passa para a sua equipe.`
            : `Magic link enviado para ${inviteEmail}`,
        });
        setInviteEmail("");
        fetchAll();
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (userId: string, newRole: string) => {
    if (!orgId) return;
    if (!isOwner) {
      toast({ title: "Só o proprietário pode alterar papéis", variant: "destructive" });
      return;
    }
    if (userId === user?.id) {
      toast({ title: "Você não pode alterar seu próprio papel", variant: "destructive" });
      return;
    }
    const { error } = await supabase
      .from("user_roles")
      .update({ role: newRole } as any)
      .eq("user_id", userId)
      .eq("org_id", orgId);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Papel atualizado" });
      fetchAll();
    }
  };

  /**
   * Remove de verdade: transfere o trabalho, corta o acesso e desliga o vínculo.
   *
   * Tudo numa função no banco (`remove_org_member`). Não é preferência de
   * organização de código: limpar o `org_id` de outra pessoa é impossível pelo
   * cliente, porque a policy de `profiles` é `USING (id = auth.uid())`. Era por
   * isso que a lixeira não removia nada — apagava o papel, engolia o erro do
   * resto e ainda dizia "Membro removido".
   */
  const confirmarRemocao = async () => {
    if (!removendo) return;
    setRemovendoAgora(true);
    // NÃO extrair `supabase.rpc` para uma variável: o método precisa do `this`
    // para alcançar `this.rest`, e destacado ele estoura de forma SÍNCRONA —
    // antes de qualquer await. Foi o que travava este botão em "Removendo…"
    // para sempre, porque o setRemovendoAgora(false) nunca era alcançado.
    // O cast tem de ficar na chamada de método, não na função.
    let data: Record<string, number | boolean> | null = null;
    let error: { message: string } | null = null;
    try {
      const r = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, string | null>,
      ) => Promise<{ data: Record<string, number | boolean> | null; error: { message: string } | null }>
      ).call(supabase, "remove_org_member", {
        _user_id: removendo.id,
        _transfer_to: herdeiro || null,
        _apagar_conta: apagarConta,
      } as unknown as Record<string, string | null>);
      data = r.data;
      error = r.error;
    } catch (e) {
      // Rede fora, função ausente, qualquer estouro: o botão precisa voltar.
      error = { message: mensagemErro(e) };
    } finally {
      setRemovendoAgora(false);
    }

    if (error) {
      toast({ title: "Não foi possível remover", description: error.message, variant: "destructive" });
      return;
    }

    const r = (data ?? {}) as Record<string, number>;
    const contaApagada = Boolean((data as Record<string, unknown> | null)?.conta_apagada);
    const movidos = (r.contatos ?? 0) + (r.negocios ?? 0) + (r.empresas ?? 0) + (r.tarefas ?? 0);
    const destino = members.find((m) => m.id === (herdeiro || user?.id));
    setRemovendo(null);
    setHerdeiro("");
    fetchAll();
    const oQueFoi = movidos === 0
      ? "A pessoa não tinha registros sob responsabilidade."
      : `${movidos} ${movidos === 1 ? "registro transferido" : "registros transferidos"} para ${destino?.name || "você"}.`;

    toast({
      title: contaApagada ? "Membro e conta excluídos" : "Membro removido",
      description: contaApagada
        ? `${oQueFoi} O e-mail está livre para ser convidado de novo.`
        : oQueFoi,
    });
  };

  const cancelInvite = async (id: string) => {
    await supabase.from("invitations").delete().eq("id", id);
    fetchAll();
    toast({ title: "Convite cancelado" });
  };

  const createTeam = async () => {
    if (!orgId || !newTeamName) return;
    await supabase.from("teams").insert({ org_id: orgId, name: newTeamName });
    setNewTeamName("");
    fetchAll();
    toast({ title: "Equipe criada" });
  };

  const deleteTeam = async (id: string) => {
    await supabase.from("teams").delete().eq("id", id);
    fetchAll();
    toast({ title: "Equipe excluída" });
  };

  const toggleTeamMember = async (teamId: string, uid: string) => {
    const exists = teamMembers.find((tm: any) => tm.team_id === teamId && tm.user_id === uid);
    if (exists) {
      await supabase.from("team_members").delete().eq("team_id", teamId).eq("user_id", uid);
    } else {
      await supabase.from("team_members").insert({ team_id: teamId, user_id: uid });
    }
    fetchAll();
  };

  const roleIcon = (role: string) => {
    if (role === "owner") return <Crown className="h-3 w-3" />;
    if (role === "admin") return <Shield className="h-3 w-3" />;
    return null;
  };

  const roleColor = (role: string) => {
    if (role === "owner") return "text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800";
    if (role === "admin") return "text-primary border-primary/30";
    return "text-muted-foreground";
  };

  return (
    <PageShell
      title="Equipe"
      description={
        isAdmin
          ? "Gerencie membros, convites e permissões"
          : "Quem faz parte da equipe. Só administradores podem alterar."
      }
    >

      <Tabs defaultValue="members">
        <PageTabs
          abas={[
            { valor: "members", rotulo: "Membros", icone: UserRound },
            { valor: "permissions", rotulo: "Permissões", icone: KeyRound, rotuloCurto: "Permis." },
            { valor: "teams", rotulo: "Equipes", icone: UsersRound },
          ]}
        />

        {/* ── Members Tab ── */}
        <TabsContent value="members" className="mt-4 space-y-4">
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Convidar via Magic Link
                </CardTitle>
                <CardDescription>O convidado receberá um link de acesso por email</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="email@exemplo.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="h-9 text-sm flex-1"
                    onKeyDown={(e) => e.key === "Enter" && sendInvite()}
                  />
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger className="h-9 text-sm w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Comercial</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" className="h-9" onClick={sendInvite} disabled={inviting || !inviteEmail}>
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                    {inviting ? "Enviando..." : "Convidar"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pending invitations */}
          {invitations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Convites Pendentes ({invitations.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {invitations.map((inv: any) => (
                    <div key={inv.id} className="flex items-center justify-between rounded-md border border-dashed border-border p-2.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs">
                          <Mail className="h-3.5 w-3.5" />
                        </div>
                        <div>
                          <p className="text-sm">{inv.email}</p>
                          <p className="text-xs text-muted-foreground">
                            {ROLES.find((r) => r.value === inv.role)?.label || inv.role}
                          </p>
                        </div>
                      </div>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => cancelInvite(inv.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Members list */}
          <Card>
            <CardHeader>
              <CardTitle>Membros ({members.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/30">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={m.avatar_url || ""} />
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                        {m.name?.charAt(0)?.toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.name || "Sem nome"}</p>
                      <p className="text-xs text-muted-foreground truncate">{m.email} {m.title ? `· ${m.title}` : ""}</p>
                    </div>
                    {/* Rodízio de lead. Desligue para conta funcional que tem
                        login mas não prospecta (marketing@, financeiro@) —
                        senão lead novo cai na caixa dela. */}
                    {isOwner && (
                      <label
                        className="flex shrink-0 items-center gap-1.5"
                        title="Entra no rodízio de distribuição de lead"
                      >
                        <Switch
                          checked={m.receives_leads ?? false}
                          onCheckedChange={(v) => toggleReceivesLeads(m.id, v)}
                          aria-label={`${m.name || m.email} recebe lead`}
                        />
                        <span className="hidden text-micro uppercase tracking-wider text-muted-foreground lg:inline">
                          Recebe lead
                        </span>
                      </label>
                    )}
                    {isOwner && m.id !== user?.id ? (
                      <Select value={m.role || "member"} onValueChange={(v) => changeRole(m.id, v)}>
                        <SelectTrigger className={`h-8 text-meta w-36 gap-1 ${roleColor(m.role || "member")}`}>
                          {roleIcon(m.role || "member")}
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {currentUserRole === "owner" && <SelectItem value="owner">Proprietário</SelectItem>}
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="member">Comercial</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline" className={`text-label gap-1 ${roleColor(m.role || "member")}`}>
                        {roleIcon(m.role || "member")}
                        {ROLES.find((r) => r.value === m.role)?.label || "Comercial"}
                      </Badge>
                    )}
                    {isOwner && m.id !== user?.id && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => { setRemovendo(m); setHerdeiro(""); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Permissions Tab ── */}
        <TabsContent value="permissions" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Controle de Acesso (RBAC)</CardTitle>
              <CardDescription>
                O que cada papel pode fazer. Essas regras são aplicadas no banco de dados
                (Row Level Security) — valem para o app, exportações e API.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="vx-table">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-[260px]">Capacidade</TableHead>
                      {ROLES.map((r) => (
                        <TableHead key={r.value} className="text-xs text-center">{r.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ROLE_CAPABILITIES.map((cap) => (
                      <TableRow key={cap.label}>
                        <TableCell className="text-sm font-medium">{cap.label}</TableCell>
                        {(["owner", "admin", "member"] as const).map((role) => {
                          const value = cap[role];
                          const negative = value === "Não";
                          return (
                            <TableCell key={role} className="text-center">
                              <Badge
                                variant={negative ? "secondary" : "default"}
                                className={`text-label ${negative ? "bg-muted text-muted-foreground" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"}`}
                              >
                                {value}
                              </Badge>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Comercial vê apenas os leads, contatos e negócios em que é o responsável.
                Distribua leads na página Contatos (visão "Vendedor") ou pelo campo Responsável.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Teams Tab ── */}
        <TabsContent value="teams" className="mt-4 space-y-4">
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>Nova Equipe</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="Nome da equipe"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    className="h-9 text-sm flex-1"
                    onKeyDown={(e) => e.key === "Enter" && createTeam()}
                  />
                  <Button size="sm" className="h-9" onClick={createTeam}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />Criar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {teams.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <Users className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Nenhuma equipe criada ainda</p>
              </CardContent>
            </Card>
          ) : (
            teams.map((team: any) => (
              <Card key={team.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      {team.name}
                    </CardTitle>
                    {isAdmin && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteTeam(team.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {members.map((m) => {
                      const inTeam = teamMembers.some((tm: any) => tm.team_id === team.id && tm.user_id === m.id);
                      return (
                        <button
                          key={m.id}
                          onClick={() => isAdmin && toggleTeamMember(team.id, m.id)}
                          disabled={!isAdmin}
                          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                            inTeam
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border bg-background text-muted-foreground hover:border-primary/20"
                          } ${!isAdmin ? "cursor-default" : "cursor-pointer"}`}
                        >
                          <Avatar className="h-5 w-5">
                            <AvatarImage src={m.avatar_url || ""} />
                            <AvatarFallback className="text-micro">{m.name?.charAt(0)?.toUpperCase() || "U"}</AvatarFallback>
                          </Avatar>
                          {m.name || m.email}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
      {/* Remoção de membro — diz o que vai acontecer antes de acontecer, porque
          transferir a carteira de alguém não tem botão de desfazer. */}
      <Dialog open={!!removendo} onOpenChange={(aberto) => { if (!aberto) setRemovendo(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remover {removendo?.name || "membro"}?</DialogTitle>
            <DialogDescription className="space-y-2 pt-1 text-left">
              <span className="block">
                Perde o acesso ao CRM na hora e sai da lista. A conta continua existindo — você
                pode convidar de novo depois.
              </span>
              <span className="block">
                Os contatos, negócios, empresas e tarefas sob responsabilidade dela precisam de um
                novo dono, senão ficam invisíveis para o time.
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Transferir o trabalho para</label>
            <Select value={herdeiro || user?.id || ""} onValueChange={setHerdeiro}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {members
                  .filter((m) => m.id !== removendo?.id)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name || m.email}
                      {m.id === user?.id && " (você)"}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-meta text-muted-foreground">
              A caixa de e-mail e o histórico dela não são transferidos: continuam restritos a
              administradores.
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3">
            <Checkbox
              checked={apagarConta}
              onCheckedChange={(v) => setApagarConta(v === true)}
              className="mt-0.5"
            />
            <span className="text-xs leading-relaxed">
              <span className="font-medium">Excluir a conta também</span>
              <span className="mt-0.5 block text-muted-foreground">
                {apagarConta
                  ? "O e-mail fica livre para ser convidado de novo. É irreversível: a conta deixa de existir."
                  : "A conta continua existindo. Convidar este e-mail de novo vai falhar com “já registrado”."}
              </span>
            </span>
          </label>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setRemovendo(null)} disabled={removendoAgora}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmarRemocao} disabled={removendoAgora}>
              {removendoAgora
                ? "Removendo…"
                : apagarConta
                  ? "Excluir conta e transferir"
                  : "Remover e transferir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>

  );
}
