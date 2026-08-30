import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export function GeneralTab({ orgId, userId, profile }: { orgId: string | null; userId?: string; profile: Profile | null }) {
  const { toast } = useToast();
  const [profileForm, setProfileForm] = useState({ name: "", title: "", timezone: "UTC" });
  const [orgForm, setOrgForm] = useState({ name: "", slug: "", currency: "BRL", timezone: "America/Sao_Paulo" });
  const [orgSettings, setOrgSettings] = useState<Record<string, unknown>>({});
  const [industries, setIndustries] = useState<string[]>([]);
  const [newIndustry, setNewIndustry] = useState("");

  const DEFAULT_INDUSTRIES = [
    "Tecnologia", "SaaS", "Serviços", "E-commerce", "Indústria",
    "Consultoria", "Educação", "Saúde", "Financeiro", "Varejo",
    "Logística", "Agronegócio", "Imobiliário", "Jurídico", "Marketing",
  ];

  useEffect(() => {
    if (profile) setProfileForm({ name: profile.name || "", title: profile.title || "", timezone: profile.timezone || "UTC" });
  }, [profile]);

  useEffect(() => {
    if (orgId) {
      supabase.from("organizations").select("*").eq("id", orgId).maybeSingle().then(({ data }) => {
        if (data) {
          const settings = (data.settings as Record<string, unknown>) || {};
          setOrgSettings(settings);
          setOrgForm({ name: data.name, slug: data.slug, currency: (settings.currency as string) || "BRL", timezone: (settings.timezone as string) || "America/Sao_Paulo" });
          const savedIndustries = settings.industries as string[] | undefined;
          setIndustries(savedIndustries && savedIndustries.length > 0 ? savedIndustries : DEFAULT_INDUSTRIES);
        }
      });
    }
  }, [orgId]);

  const saveProfile = async () => {
    if (!userId) return;
    const { error } = await supabase.from("profiles").update({
      name: profileForm.name, title: profileForm.title, timezone: profileForm.timezone,
    }).eq("id", userId);
    toast(error ? { title: "Erro", description: error.message, variant: "destructive" } : { title: "Perfil atualizado" });
  };

  const saveOrg = async () => {
    if (!orgId) return;
    const mergedSettings = { ...orgSettings, currency: orgForm.currency, timezone: orgForm.timezone };
    const { error } = await supabase.from("organizations").update({
      name: orgForm.name,
      slug: orgForm.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      settings: mergedSettings,
    }).eq("id", orgId);
    if (!error) setOrgSettings(mergedSettings);
    toast(error ? { title: "Erro", description: error.message, variant: "destructive" } : { title: "Organização atualizada" });
  };

  const saveIndustries = async (updated: string[]) => {
    if (!orgId) return;
    setIndustries(updated);
    const mergedSettings = { ...orgSettings, industries: updated };
    const { error } = await supabase.from("organizations").update({ settings: mergedSettings }).eq("id", orgId);
    if (!error) setOrgSettings(mergedSettings);
    toast(error ? { title: "Erro", description: error.message, variant: "destructive" } : { title: "Indústrias atualizadas" });
  };

  const addIndustry = () => {
    const trimmed = newIndustry.trim();
    if (!trimmed || industries.includes(trimmed)) return;
    saveIndustries([...industries, trimmed]);
    setNewIndustry("");
  };

  const removeIndustry = (ind: string) => {
    saveIndustries(industries.filter((i) => i !== ind));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Perfil Pessoal</CardTitle>
          <CardDescription>Suas informações pessoais</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label className="text-xs">Nome</Label><Input value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} className="h-8 text-xs" /></div>
            <div className="space-y-1"><Label className="text-xs">Cargo</Label><Input value={profileForm.title} onChange={(e) => setProfileForm({ ...profileForm, title: e.target.value })} className="h-8 text-xs" /></div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fuso horário</Label>
            <Select value={profileForm.timezone} onValueChange={(v) => setProfileForm({ ...profileForm, timezone: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="America/Sao_Paulo">São Paulo (BRT)</SelectItem>
                <SelectItem value="America/New_York">New York (EST)</SelectItem>
                <SelectItem value="Europe/London">London (GMT)</SelectItem>
                <SelectItem value="UTC">UTC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={saveProfile}>Salvar Perfil</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organização</CardTitle>
          <CardDescription>Configurações gerais da organização</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label className="text-xs">Nome</Label><Input value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} className="h-8 text-xs" /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Moeda padrão</Label>
              <Select value={orgForm.currency} onValueChange={(v) => setOrgForm({ ...orgForm, currency: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRL">BRL (R$)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fuso horário da organização</Label>
              <Select value={orgForm.timezone} onValueChange={(v) => setOrgForm({ ...orgForm, timezone: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/Sao_Paulo">São Paulo (BRT)</SelectItem>
                  <SelectItem value="America/New_York">New York (EST)</SelectItem>
                  <SelectItem value="UTC">UTC</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={saveOrg}>Salvar Organização</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Indústrias</CardTitle>
          <CardDescription>Personalize as opções de indústria disponíveis ao cadastrar empresas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Nova indústria"
              value={newIndustry}
              onChange={(e) => setNewIndustry(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addIndustry()}
              className="h-8 text-xs flex-1"
            />
            <Button size="sm" className="h-8" onClick={addIndustry}><Plus className="h-3 w-3" /></Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {industries.map((ind) => (
              <Badge key={ind} variant="secondary" className="text-label gap-1">
                {ind}
                <button onClick={() => removeIndustry(ind)} className="hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
