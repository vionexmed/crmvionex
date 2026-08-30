import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { exportarCSV } from "@/lib/csv";

export function ImportExportTab({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [exporting, setExporting] = useState<string | null>(null);

  const exportEntity = async (entity: string) => {
    if (!orgId) return;
    setExporting(entity);
    try {
      const { data, error } = await supabase.from(entity as any).select("*").eq("org_id", orgId);
      if (error) throw error;
      if (!data || data.length === 0) { toast({ title: "Sem dados para exportar" }); return; }

      // Escrevia sem BOM: o Excel abria "São Paulo" como "SÃ£o Paulo". Aqui as
      // colunas vêm do banco e não são conhecidas de antemão, então
      // `exportarCSV` deriva os cabeçalhos da primeira linha, que é o mesmo que
      // este bloco fazia.
      const hoje = new Date().toISOString().slice(0, 10);
      exportarCSV(data as unknown as Record<string, unknown>[], `${entity}_export_${hoje}`);
      toast({ title: `${data.length} registros exportados` });
    } catch (e: any) {
      toast({ title: "Erro na exportação", description: e.message, variant: "destructive" });
    }
    setExporting(null);
  };

  const entities = [
    { key: "contacts", label: "Contatos", icon: "👤" },
    { key: "companies", label: "Empresas", icon: "🏢" },
    { key: "deals", label: "Negócios", icon: "💼" },
    { key: "activities", label: "Atividades", icon: "📋" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Exportar Dados</CardTitle>
          <CardDescription className="text-label">
            Exporte qualquer entidade como arquivo CSV
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {entities.map((ent) => (
              <Button
                key={ent.key}
                variant="outline"
                className="h-auto py-3 flex flex-col gap-1"
                onClick={() => exportEntity(ent.key)}
                disabled={exporting === ent.key}
              >
                {exporting === ent.key ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <span className="text-lg">{ent.icon}</span>
                )}
                <span className="text-label">{ent.label}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Importar Dados</CardTitle>
          <CardDescription className="text-label">
            Importe contatos e empresas via CSV. Acesse a lista de contatos ou empresas e use o botão "Importar CSV".
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-muted p-4 space-y-2">
            <p className="text-label font-medium">Formatos suportados:</p>
            <ul className="text-micro text-muted-foreground space-y-1">
              <li>• <strong>CSV genérico</strong> — mapeamento de colunas manual</li>
              <li>• <strong>HubSpot Export</strong> — detecta automaticamente colunas "First Name", "Last Name", "Email"</li>
              <li>• <strong>Pipedrive Export</strong> — detecta "Person - Name", "Organization - Name"</li>
            </ul>
            <p className="text-micro text-muted-foreground mt-2">
              A importação inclui preview, mapeamento e detecção de duplicatas por email.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
