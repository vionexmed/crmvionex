import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/hooks/useOrg";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { IntegrationsTab } from "@/components/integrations/IntegrationsTab";
import { WebhooksTab } from "@/components/integrations/WebhooksTab";
import { ApiKeysTab } from "@/components/integrations/ApiKeysTab";
import { LeadCaptureTab } from "@/components/integrations/LeadCaptureTab";
import { TrackingTab } from "@/components/integrations/TrackingTab";
import { ImportExportTab } from "@/components/integrations/ImportExportTab";
import { PageTabs } from "@/components/layout/PageTabs";
import { ArrowLeftRight, KeyRound, Magnet as MagnetIcon, Plug, Radar, Webhook } from "lucide-react";

export default function Integrations() {
  const { user } = useAuth();
  const { orgId } = useOrg();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Integrações & API</h1>
        <p className="text-muted-foreground">Conecte ferramentas externas e gerencie sua API</p>
      </div>

      <Tabs defaultValue="integrations">
        <PageTabs
          abas={[
            { valor: "integrations", rotulo: "Integrações", icone: Plug, rotuloCurto: "Integr." },
            { valor: "webhooks", rotulo: "Webhooks", icone: Webhook },
            { valor: "api", rotulo: "Chaves de API", icone: KeyRound, rotuloCurto: "Chaves" },
            { valor: "lead-capture", rotulo: "Captação de leads", icone: MagnetIcon, rotuloCurto: "Captação" },
            { valor: "tracking", rotulo: "Rastreamento", icone: Radar, rotuloCurto: "Rastreio" },
            { valor: "import-export", rotulo: "Importar e exportar", icone: ArrowLeftRight, rotuloCurto: "Import." },
          ]}
        />

        <TabsContent value="integrations" className="mt-4">
          <IntegrationsTab orgId={orgId} userId={user?.id} />
        </TabsContent>
        <TabsContent value="webhooks" className="mt-4">
          <WebhooksTab orgId={orgId} />
        </TabsContent>
        <TabsContent value="api" className="mt-4">
          <ApiKeysTab orgId={orgId} userId={user?.id} />
        </TabsContent>
        <TabsContent value="lead-capture" className="mt-4">
          <LeadCaptureTab orgId={orgId} />
        </TabsContent>
        <TabsContent value="tracking" className="mt-4">
          <TrackingTab orgId={orgId} />
        </TabsContent>
        <TabsContent value="import-export" className="mt-4">
          <ImportExportTab orgId={orgId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
