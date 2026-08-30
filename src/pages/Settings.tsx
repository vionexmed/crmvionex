/**
 * Configurações.
 *
 * A empresa é configurada UMA vez, pelo dono, e todo mundo herda — inclusive
 * as edições futuras. Por isso as abas de organização (Geral, Funis e etapas,
 * Campos, Assinatura, Plano) só aparecem para owner/admin.
 *
 * As abas pessoais (Notificações, Aparência) valem para qualquer papel. Antes a
 * página inteira estava atrás de RequireAdmin, então um funcionário não conseguia
 * nem trocar o próprio tema.
 */
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/hooks/useOrg";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Mail } from "lucide-react";
import { GeneralTab } from "@/components/settings/GeneralTab";
import { PipelinesTab } from "@/components/settings/PipelinesTab";
import { CustomFieldsTab } from "@/components/settings/CustomFieldsTab";
import { EmailSignatureTab } from "@/components/settings/EmailSignatureTab";
import { NotificationsTab } from "@/components/settings/NotificationsTab";
import { AppearanceTab } from "@/components/settings/AppearanceTab";
import { BillingTab } from "@/components/settings/BillingTab";
import { PageTabs } from "@/components/layout/PageTabs";
import { Bell, CreditCard, FormInput, GitBranch, Palette, SlidersHorizontal } from "lucide-react";

export default function Settings() {
  const { user, profile, isAdmin } = useAuth();
  const { orgId } = useOrg();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">
          {isAdmin
            ? "Gerencie seu perfil, a organização e as preferências"
            : "Suas preferências pessoais. A configuração da empresa é definida pelo administrador."}
        </p>
      </div>

      <Tabs defaultValue={isAdmin ? "general" : "notifications"}>
        {/* Abas condicionais: quem não é admin vê três. Como o número de
            colunas é CONTADO do array, a barra se divide certo nos dois casos
            -- com `grid-cols-N` escrito à mão, um dos dois ficaria errado. */}
        <PageTabs
          abas={[
            ...(isAdmin
              ? [
                  { valor: "general", rotulo: "Geral", icone: SlidersHorizontal },
                  { valor: "pipelines", rotulo: "Funis e etapas", icone: GitBranch, rotuloCurto: "Funis" },
                  { valor: "custom-fields", rotulo: "Campos", icone: FormInput },
                  { valor: "email-signature", rotulo: "Assinatura", icone: Mail },
                ]
              : []),
            { valor: "notifications", rotulo: "Notificações", icone: Bell, rotuloCurto: "Notif." },
            { valor: "appearance", rotulo: "Aparência", icone: Palette },
            ...(isAdmin ? [{ valor: "billing", rotulo: "Plano", icone: CreditCard }] : []),
          ]}
        />

        {isAdmin && (
          <>
            <TabsContent value="general" className="mt-4">
              <GeneralTab orgId={orgId} userId={user?.id} profile={profile} />
            </TabsContent>
            <TabsContent value="pipelines" className="mt-4">
              <PipelinesTab orgId={orgId} />
            </TabsContent>
            <TabsContent value="custom-fields" className="mt-4">
              <CustomFieldsTab orgId={orgId} />
            </TabsContent>
            <TabsContent value="email-signature" className="mt-4">
              <EmailSignatureTab orgId={orgId} />
            </TabsContent>
            <TabsContent value="billing" className="mt-4">
              <BillingTab orgId={orgId} />
            </TabsContent>
          </>
        )}

        <TabsContent value="notifications" className="mt-4">
          <NotificationsTab orgId={orgId} userId={user?.id} />
        </TabsContent>
        <TabsContent value="appearance" className="mt-4">
          <AppearanceTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
