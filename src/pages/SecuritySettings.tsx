import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, RefreshCw } from "lucide-react";
import SessionsPanel from "@/components/settings/SessionsPanel";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SecuritySettings() {
  const { orgId } = useOrg();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Segurança</h1>
        <p className="text-sm text-muted-foreground">Audit log, sessões e configurações de segurança</p>
      </div>
      <Tabs defaultValue="audit">
        <TabsList>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
          <TabsTrigger value="sessions">Sessões</TabsTrigger>
        </TabsList>
        <TabsContent value="audit" className="mt-4"><AuditLogTab orgId={orgId} /></TabsContent>
        <TabsContent value="sessions" className="mt-4"><SessionsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function AuditLogTab({ orgId }: { orgId: string | null }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const fetchLogs = async () => {
    if (!orgId) return;
    setLoading(true);
    let query = supabase.from("audit_logs").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(200);
    if (actionFilter !== "all") query = query.eq("action", actionFilter);
    if (entityFilter !== "all") query = query.eq("entity_type", entityFilter);
    const { data } = await query;
    setLogs(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchLogs(); }, [orgId, actionFilter, entityFilter]);

  const actionLabels: Record<string, string> = {
    create: "Criou", update: "Atualizou", delete: "Deletou", login: "Login", logout: "Logout",
    export: "Exportou", import: "Importou", invite: "Convidou",
  };

  const actionColors: Record<string, string> = {
    create: "bg-emerald-500/10 text-emerald-400", update: "bg-blue-500/10 text-blue-400",
    delete: "bg-red-500/10 text-red-400", login: "bg-primary/10 text-primary",
    export: "bg-amber-500/10 text-amber-400",
  };

  const filtered = logs.filter((l) => !searchTerm || l.entity_type?.includes(searchTerm) || l.action?.includes(searchTerm));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-48" />
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Ação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas ações</SelectItem>
            <SelectItem value="create">Criação</SelectItem>
            <SelectItem value="update">Atualização</SelectItem>
            <SelectItem value="delete">Exclusão</SelectItem>
            <SelectItem value="login">Login</SelectItem>
            <SelectItem value="export">Exportação</SelectItem>
          </SelectContent>
        </Select>
        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Entidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="contact">Contatos</SelectItem>
            <SelectItem value="deal">Negócios</SelectItem>
            <SelectItem value="company">Empresas</SelectItem>
            <SelectItem value="activity">Atividades</SelectItem>
            <SelectItem value="user">Usuários</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={fetchLogs} aria-label="Recarregar">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Entidade</TableHead>
              <TableHead className="hidden md:table-cell">IP</TableHead>
              <TableHead className="hidden lg:table-cell">Detalhes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhum registro encontrado</TableCell></TableRow>
            ) : (
              filtered.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={actionColors[log.action] || ""}>
                      {actionLabels[log.action] || log.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium text-sm">{log.entity_type}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{log.ip_address || "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-xs truncate">
                    {log.entity_id?.slice(0, 8) || "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SessionsTab() {
  // isAdmin vem do papel real na organização: administrador vê as sessões de
  // todos, cada pessoa vê só as suas.
  const { isAdmin } = useAuth();

  return (
    <div className="space-y-4">
      <SessionsPanel isAdmin={!!isAdmin} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />Política de senha
          </CardTitle>
          <CardDescription>O que está de fato em vigor</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li>• Mínimo de 6 caracteres (padrão do Supabase Auth)</li>
            <li>• Sessão renovada automaticamente enquanto em uso</li>
            <li>• Limite de tentativas de login aplicado pelo Supabase por IP</li>
          </ul>
          {/* Este bloco existia afirmando "bloqueio após 5 tentativas inválidas" e
              "senhas comuns são rejeitadas automaticamente". Nada disso estava
              implementado — a tela prometia proteção inexistente. Trocado pelo
              que é verdade, com o que falta declarado como falta. */}
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
            <p className="text-xs font-medium">Ainda não ativado</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Exigir 8 caracteres e recusar senha vazada são opções do painel do
              Supabase, em Authentication → Policies. Enquanto não forem ligadas,
              não estão valendo.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

