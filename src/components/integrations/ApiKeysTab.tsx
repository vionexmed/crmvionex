import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Key, Copy, EyeOff, Eye, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatarData } from "@/lib/formato";

type ApiKey = {
  id: string; org_id: string; name: string; key_prefix: string; key_hash: string;
  created_at: string | null; last_used_at: string | null; is_active: boolean; request_count: number;
};

export function ApiKeysTab({ orgId, userId }: { orgId: string | null; userId?: string }) {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("Default");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const fetchKeys = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase.from("api_keys").select("*").eq("org_id", orgId) as any;
    setKeys(data || []);
  }, [orgId]);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const generateKey = async () => {
    if (!orgId) return;
    // Generate a random API key
    const rawKey = `fc_${crypto.randomUUID().replace(/-/g, "")}`;
    const prefix = rawKey.slice(0, 8);
    // Hash it (simplified — in production use edge function)
    const encoder = new TextEncoder();
    const data = encoder.encode(rawKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const { error } = await supabase.from("api_keys").insert({
      org_id: orgId, name: newKeyName, key_hash: hashHex, key_prefix: prefix, created_by: userId,
    } as any);

    if (error) {
      const msg = error.message.includes("policy") || error.code === "42501"
        ? "Sem permissão. Apenas Owners e Admins podem gerar API keys."
        : error.message;
      toast({ title: "Erro ao gerar chave", description: msg, variant: "destructive" });
      return;
    }
    setGeneratedKey(rawKey);
    setShowKey(true);
    fetchKeys();
    toast({ title: "API Key gerada" });
  };

  const revokeKey = async (id: string) => {
    await supabase.from("api_keys").update({ is_active: false } as any).eq("id", id);
    toast({ title: "Chave revogada", description: "Você pode reativá-la a qualquer momento." });
    fetchKeys();
  };

  const reactivateKey = async (id: string) => {
    // Reativa uma chave revogada — o hash foi preservado, então a mesma
    // chave volta a valer sem precisar reconfigurar quem já a usa
    await supabase.from("api_keys").update({ is_active: true } as any).eq("id", id);
    toast({ title: "Chave reativada" });
    fetchKeys();
  };

  const deleteKey = async (id: string) => {
    await supabase.from("api_keys").delete().eq("id", id);
    toast({ title: "Chave excluída" });
    fetchKeys();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>API Keys</CardTitle>
              <CardDescription>
                Gere chaves para acessar a API REST do CRM. Rate limit: 1000 req/hora.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Nome da chave" className="h-8 text-xs flex-1" />
            <Button size="sm" className="h-8 text-xs" onClick={generateKey}>
              <Key className="mr-1 h-3 w-3" />Gerar Chave
            </Button>
          </div>

          {generatedKey && showKey && (
            <div className="rounded-md border border-warning/30 bg-warning/5 p-3 space-y-2">
              <p className="text-label font-medium text-warning">⚠️ Copie esta chave agora — ela não será exibida novamente</p>
              <div className="flex gap-2">
                <Input value={generatedKey} readOnly className="h-8 text-label font-mono" />
                <Button variant="outline" size="sm" className="h-8"
                  onClick={() => { navigator.clipboard.writeText(generatedKey); toast({ title: "Copiado!" }); }}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <Button variant="ghost" size="sm" className="h-6 text-micro"
                onClick={() => { setShowKey(false); setGeneratedKey(null); }}>
                Esconder
              </Button>
            </div>
          )}

          {keys.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-label">Nome</TableHead>
                  <TableHead className="text-label">Prefixo</TableHead>
                  <TableHead className="text-label">Status</TableHead>
                  <TableHead className="text-label">Requests</TableHead>
                  <TableHead className="text-label">Criada</TableHead>
                  <TableHead className="text-label" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="text-xs">{k.name}</TableCell>
                    <TableCell className="text-xs font-mono">{k.key_prefix}...</TableCell>
                    <TableCell>
                      <Badge variant={k.is_active ? "default" : "destructive"} className="text-micro">
                        {k.is_active ? "Ativa" : "Revogada"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{k.request_count}</TableCell>
                    <TableCell className="text-xs">{k.created_at ? formatarData(k.created_at) : "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {k.is_active ? (
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="Revogar" onClick={() => revokeKey(k.id)}>
                            <EyeOff className="h-3 w-3" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-600" title="Reativar" onClick={() => reactivateKey(k.id)}>
                            <Eye className="h-3 w-3" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="Excluir" onClick={() => deleteKey(k.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* API Docs link */}
      <Card>
        <CardHeader>
          <CardTitle>Documentação da API</CardTitle>
          <CardDescription>
            Endpoints REST disponíveis: contacts, companies, deals, activities
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-muted p-4 space-y-3">
            <p className="text-label font-medium">Base URL</p>
            <code className="text-label font-mono bg-background px-2 py-1 rounded">
              {import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-api
            </code>

            <div className="grid gap-2 mt-3">
              {["GET /contacts", "POST /contacts", "PUT /contacts/:id", "DELETE /contacts/:id",
                "GET /companies", "POST /companies", "GET /deals", "POST /deals",
                "GET /activities", "POST /activities"].map((endpoint) => (
                <div key={endpoint} className="flex items-center gap-2">
                  <Badge variant="outline" className="text-micro w-12 justify-center">
                    {endpoint.split(" ")[0]}
                  </Badge>
                  <code className="text-micro font-mono text-muted-foreground">{endpoint.split(" ")[1]}</code>
                </div>
              ))}
            </div>

            <p className="text-micro text-muted-foreground mt-2">
              Headers: <code className="bg-background px-1 rounded">Authorization: Bearer fc_xxx</code>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
