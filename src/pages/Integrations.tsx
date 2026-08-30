import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/hooks/useOrg";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IntegrationsTab } from "@/components/integrations/IntegrationsTab";
import { WebhooksTab } from "@/components/integrations/WebhooksTab";
import { ApiKeysTab } from "@/components/integrations/ApiKeysTab";
import { LeadCaptureTab } from "@/components/integrations/LeadCaptureTab";
import { TrackingTab } from "@/components/integrations/TrackingTab";
import { ImportExportTab } from "@/components/integrations/ImportExportTab";

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
        <TabsList className="flex-wrap">
          <TabsTrigger value="integrations">Integrações</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="api">API Keys</TabsTrigger>
          <TabsTrigger value="lead-capture">Captação de Leads</TabsTrigger>
          <TabsTrigger value="tracking">Rastreamento</TabsTrigger>
          <TabsTrigger value="import-export">Import/Export</TabsTrigger>
        </TabsList>

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
