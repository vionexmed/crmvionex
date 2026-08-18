import { useEffect, useState, useMemo, useCallback } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { BarChart3 as BarChart3Icon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import {
  TrendingUp, Activity, FileText, BarChart3, Users,
} from "lucide-react";
import {
  Deal, Stage, Pipeline, Profile, ActivityRow, Contact, Company,
  PeriodFilter, getPeriodRange, inPeriod,
} from "@/components/reports/types";
import { SalesReport } from "@/components/reports/SalesReport";
import { ActivitiesReport } from "@/components/reports/ActivitiesReport";
import { ForecastReport } from "@/components/reports/ForecastReport";
import { ContactsReport } from "@/components/reports/ContactsReport";
import { CustomReportBuilder } from "@/components/reports/CustomReportBuilder";

export default function Reports() {
  const { orgId } = useOrg();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [, setLoading] = useState(true);

  // Global filters
  const [period, setPeriod] = useState<PeriodFilter>("this_month");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [pipelineFilter, setPipelineFilter] = useState("all");

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [dRes, sRes, pRes, mRes, aRes, cRes, coRes] = await Promise.all([
      supabase.from("deals").select("*").eq("org_id", orgId),
      supabase.from("pipeline_stages").select("*").eq("org_id", orgId).order("order"),
      supabase.from("pipelines").select("id,name,is_default").eq("org_id", orgId),
      supabase.from("profiles").select("id,name,email").eq("org_id", orgId),
      supabase.from("activities").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(1000),
      supabase.from("contacts").select("id,first_name,last_name,status,lead_score,created_at,owner_id").eq("org_id", orgId),
      supabase.from("companies").select("id,name").eq("org_id", orgId),
    ]);
    setDeals((dRes.data as Deal[]) || []);
    setStages((sRes.data as Stage[]) || []);
    setPipelines((pRes.data as Pipeline[]) || []);
    setMembers((mRes.data as Profile[]) || []);
    setActivities((aRes.data as ActivityRow[]) || []);
    setContacts((cRes.data as Contact[]) || []);
    setCompanies((coRes.data as Company[]) || []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Filtered data ──────────────────
  const periodRange = getPeriodRange(period);

  const filteredDeals = useMemo(() => {
    let list = deals;
    if (ownerFilter !== "all") list = list.filter((d) => d.owner_id === ownerFilter);
    if (pipelineFilter !== "all") {
      const pipeStages = stages.filter((s) => s.pipeline_id === pipelineFilter).map((s) => s.id);
      list = list.filter((d) => d.stage_id && pipeStages.includes(d.stage_id));
    }
    return list.filter((d) => inPeriod(d.created_at, periodRange));
  }, [deals, ownerFilter, pipelineFilter, stages, periodRange]);

  const filteredActivities = useMemo(() => {
    let list = activities;
    if (ownerFilter !== "all") list = list.filter((a) => a.user_id === ownerFilter);
    return list.filter((a) => inPeriod(a.created_at, periodRange));
  }, [activities, ownerFilter, periodRange]);

  const filteredContacts = useMemo(() => {
    let list = contacts;
    if (ownerFilter !== "all") list = list.filter((c) => c.owner_id === ownerFilter);
    return list;
  }, [contacts, ownerFilter]);

  if (!orgId) return <div className="py-20 text-center text-muted-foreground">Crie uma organização primeiro.</div>;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={BarChart3Icon}
        kicker="Análises"
        title="Relatórios"
        description="Análises completas de vendas, atividades e previsão"
        pattern="diagonal"
        actions={
          <>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
              <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo período</SelectItem>
                <SelectItem value="this_month">Este mês</SelectItem>
                <SelectItem value="last_month">Mês anterior</SelectItem>
                <SelectItem value="this_quarter">Trimestre</SelectItem>
                <SelectItem value="this_year">Este ano</SelectItem>
              </SelectContent>
            </Select>
            <Select value={ownerFilter} onValueChange={setOwnerFilter}>
              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os donos</SelectItem>
                {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name || m.email}</SelectItem>)}
              </SelectContent>
            </Select>
            {pipelines.length > 1 && (
              <Select value={pipelineFilter} onValueChange={setPipelineFilter}>
                <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos pipelines</SelectItem>
                  {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </>
        }
      />

      <Tabs defaultValue="sales" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="sales" className="text-xs gap-1"><BarChart3 className="h-3.5 w-3.5" />Vendas</TabsTrigger>
          <TabsTrigger value="activities" className="text-xs gap-1"><Activity className="h-3.5 w-3.5" />Atividades</TabsTrigger>
          <TabsTrigger value="forecast" className="text-xs gap-1"><TrendingUp className="h-3.5 w-3.5" />Forecast</TabsTrigger>
          <TabsTrigger value="contacts" className="text-xs gap-1"><Users className="h-3.5 w-3.5" />Contatos</TabsTrigger>
          <TabsTrigger value="custom" className="text-xs gap-1"><FileText className="h-3.5 w-3.5" />Custom</TabsTrigger>
        </TabsList>

        <TabsContent value="sales">
          <SalesReport deals={filteredDeals} stages={stages} members={members} companies={companies} allDeals={deals} periodRange={periodRange} />
        </TabsContent>

        <TabsContent value="activities">
          <ActivitiesReport activities={filteredActivities} members={members} />
        </TabsContent>

        <TabsContent value="forecast">
          <ForecastReport deals={deals} stages={stages} members={members} ownerFilter={ownerFilter} pipelineFilter={pipelineFilter} />
        </TabsContent>

        <TabsContent value="contacts">
          <ContactsReport contacts={filteredContacts} members={members} />
        </TabsContent>

        <TabsContent value="custom">
          <CustomReportBuilder deals={deals} contacts={contacts} activities={activities} stages={stages} members={members} companies={companies} orgId={orgId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
