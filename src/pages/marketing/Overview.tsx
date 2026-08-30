import { useState, useEffect, useRef } from "react";
import {
  LayoutGrid, Facebook, Chrome, TrendingUp, TrendingDown,
  ArrowUpRight, DollarSign, Target as TargetIcon, MousePointerClick,
  Eye, Users as UsersIcon, Zap, Activity, BarChart3, RefreshCw,
  Calendar, Database, PlugZap,
} from "lucide-react";
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis,
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, LineChart, Line,
} from "recharts";

import {
  sumBy, fmtBRL, fmtNum, fmtPct,
  periodDays, type PeriodKey, type FunnelStage,
} from "@/lib/marketing-utils";
import { useMarketingData, type MarketingSource } from "@/hooks/useMarketingData";
import { formatarHora } from "@/lib/formato";

type TabKey = "visao" | "meta" | "google";

const tabsConfig: Record<TabKey, { label: string; icon: any; color: string; bg: string; breadcrumb: string; h1: string; sub: string }> = {
  visao:  { label: "Visão geral", icon: LayoutGrid, color: "var(--vx-teal)",   bg: "var(--vx-teal-bg)",   breadcrumb: "Visão geral",  h1: "Visão geral de marketing", sub: "Performance consolidada de todas as fontes de tráfego" },
  meta:   { label: "Meta Ads",    icon: Facebook,   color: "var(--vx-meta)",   bg: "var(--vx-meta-bg)",   breadcrumb: "Meta Ads",     h1: "Meta Ads — performance",    sub: "Facebook · Instagram · Reels" },
  google: { label: "Google Ads",  icon: Chrome,     color: "var(--vx-google)", bg: "var(--vx-google-bg)", breadcrumb: "Google Ads",   h1: "Google Ads — performance",  sub: "Search · Display · YouTube" },
};

// ────────────── Hooks utilitários ──────────────

function useCountUp(target: number, duration = 900) {
  const [v, setV] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    start.current = null;
    let raf = 0;
    const step = (t: number) => {
      if (start.current === null) start.current = t;
      const p = Math.min(1, (t - start.current) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(target * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

// ────────────── Componente raiz ──────────────

export default function MarketingOverview() {
  const [tab, setTab] = useState<TabKey>("visao");
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [customDays, setCustomDays] = useState(14);
  const cfg = tabsConfig[tab];

  const data = useMarketingData(period, customDays);
  const days = periodDays(period, customDays);

  const horaAtualizacao = formatarHora(data.updatedAt);

  return (
    <div className="space-y-5 p-5 md:p-6 lg:p-8 max-w-[1600px] mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap vx-fade-up">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-meta" style={{ color: "var(--vx-text-3)" }}>
            <span>Vionex</span>
            <span className="text-border">›</span>
            <span>Marketing</span>
            <span className="text-border">›</span>
            <span style={{ color: "var(--vx-navy)", fontWeight: 500 }}>{cfg.breadcrumb}</span>
          </div>
          <h1 className="vx-titulo-tela" style={{ color: "var(--vx-navy)" }}>
            {cfg.h1}
          </h1>
          <p className="vx-subtitulo-tela" style={{ color: "var(--vx-text-2)" }}>{cfg.sub}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <PeriodFilter value={period} onChange={setPeriod} customDays={customDays} onCustomChange={setCustomDays} />

          <SourceBadge source="real" />

          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md" style={{ background: "var(--vx-teal-bg)", border: "0.5px solid var(--vx-teal-border)" }}>
            <span className="h-1.5 w-1.5 rounded-full vx-pulse-dot" style={{ background: "var(--vx-teal)" }} />
            <span className="text-meta" style={{ color: "var(--vx-teal)" }}>Atualizado às {horaAtualizacao}</span>
          </div>
          <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-meta font-medium transition-colors hover:bg-accent" style={{ border: "0.5px solid hsl(var(--border))", color: "var(--vx-text-2)" }}>
            <RefreshCw className={`h-3.5 w-3.5 ${data.loading ? "animate-spin" : ""}`} /> Sincronizar
          </button>
        </div>
      </div>

      {/* Tab bar — segmented */}
      <TabBar tab={tab} onChange={setTab} />

      {/* Painéis com transição */}
      <div key={`${tab}-${period}-${customDays}`} className="vx-fade-up">
        {tab === "visao"  && <PanelVisao data={data} days={days} />}
        {tab === "meta"   && <PanelMeta  data={data} days={days} />}
        {tab === "google" && <PanelGoogle data={data} days={days} />}
      </div>
    </div>
  );
}

// ────────────── Period filter ──────────────

function PeriodFilter({ value, onChange, customDays, onCustomChange }: {
  value: PeriodKey;
  onChange: (k: PeriodKey) => void;
  customDays: number;
  onCustomChange: (n: number) => void;
}) {
  const opts: { k: PeriodKey; label: string }[] = [
    { k: "7d", label: "7d" },
    { k: "30d", label: "30d" },
    { k: "90d", label: "90d" },
    { k: "custom", label: "Custom" },
  ];
  return (
    <div className="inline-flex items-center gap-2">
      <div className="inline-flex p-0.5 rounded-md bg-card" style={{ border: "0.5px solid hsl(var(--border))" }}>
        {opts.map((o) => {
          const active = value === o.k;
          return (
            <button
              key={o.k}
              onClick={() => onChange(o.k)}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded text-meta font-medium transition-all duration-150"
              style={{
                background: active ? "var(--vx-teal)" : "transparent",
                color: active ? "#fff" : "var(--vx-text-2)",
              }}
            >
              {o.k === "custom" && <Calendar className="h-3 w-3" />}
              {o.label}
            </button>
          );
        })}
      </div>
      {value === "custom" && (
        <input
          type="number"
          min={1}
          max={365}
          value={customDays}
          onChange={(e) => onCustomChange(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
          className="h-7 w-16 px-2 rounded text-meta tabular-nums bg-card"
          style={{ border: "0.5px solid hsl(var(--border))", color: "var(--vx-navy)" }}
        />
      )}
    </div>
  );
}

function SourceBadge({ source: _source }: { source: MarketingSource }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-label font-medium"
      style={{
        background: "var(--vx-green-bg)",
        color: "var(--vx-green)",
        border: "0.5px solid rgba(10,102,64,0.25)",
      }}
      title="Dados reais sincronizados via Supabase"
    >
      <Database className="h-3 w-3" />
      Dados reais
    </div>
  );
}


// ────────────── Tab bar ──────────────

function TabBar({ tab, onChange }: { tab: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <div className="inline-flex p-1 rounded-xl bg-muted/60" style={{ border: "1px solid hsl(var(--border))" }}>
      {(Object.keys(tabsConfig) as TabKey[]).map((k) => {
        const c = tabsConfig[k];
        const Icon = c.icon;
        const active = tab === k;
        return (
          <button
            key={k}
            onClick={() => onChange(k)}
            className="relative inline-flex items-center gap-2 px-4 h-9 rounded-lg text-xs font-semibold transition-all duration-200"
            style={{
              background: active ? "hsl(var(--card))" : "transparent",
              color: active ? c.color : "var(--vx-text-3)",
              boxShadow: active ? "var(--shadow-sm)" : "none",
            }}
          >
            <Icon className="h-3.5 w-3.5" /> {c.label}
          </button>
        );
      })}
    </div>
  );
}

// ────────────── Empty state ──────────────

function MarketingEmptyState({ platform, tab }: { platform: string; tab: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent mb-4 ring-8 ring-accent/20">
        <PlugZap className="h-8 w-8 text-primary" />
      </div>
      <h3 className="vx-titulo-painel" style={{ color: "var(--vx-navy)" }}>
        Sem dados de {platform}
      </h3>
      <p className="mt-2 max-w-sm text-sm" style={{ color: "var(--vx-text-2)" }}>
        Conecte sua conta <strong>{platform}</strong> em{" "}
        <a href="/settings/integrations" className="text-primary underline underline-offset-2">Configurações → Integrações</a>{" "}
        para ver os dados de campanhas aqui.
      </p>
      <p className="mt-3 text-xs" style={{ color: "var(--vx-text-3)" }}>
        Aba: {tab}
      </p>
    </div>
  );
}

// ────────────── PANEL: VISÃO GERAL ──────────────

type PanelProps = { data: ReturnType<typeof useMarketingData>; days: number };

function PanelVisao({ data, days }: PanelProps) {
  const metaCamps = data.meta.campaigns;
  const googleCamps = data.google.campaigns;
  const hasData = metaCamps.length > 0 || googleCamps.length > 0;

  const totalMeta = sumBy(metaCamps, "investido");
  const totalGoogle = sumBy(googleCamps, "investido");
  const totalInv = totalMeta + totalGoogle;
  const totalRev = sumBy(metaCamps, "receita_atrib") + sumBy(googleCamps, "receita_atrib");
  const roas = totalInv > 0 ? totalRev / totalInv : 0;
  const totalLeads = sumBy(metaCamps, "conversoes") + sumBy(googleCamps, "conversoes");
  const cplMedio = totalLeads > 0 ? totalInv / totalLeads : 0;
  const totalImp = sumBy(metaCamps, "impressoes") + sumBy(googleCamps, "impressoes");
  const totalClicks = sumBy(metaCamps, "cliques") + sumBy(googleCamps, "cliques");
  const ctrAvg = totalImp ? (totalClicks / totalImp) * 100 : 0;
  const cvrAvg = totalClicks ? (totalLeads / totalClicks) * 100 : 0;

  if (!hasData) {
    return <MarketingEmptyState platform="Meta Ads ou Google Ads" tab="Visão Geral" />;
  }

  // Série diária REAL do período (Meta = insights sincronizados; Google sem integração)
  const series = data.daily.map((d) => ({ day: d.day, Meta: d.spend, Google: 0 }));
  const leadSources = data.sources;

  return (
    <div className="space-y-5">
      {/* Hero cards — deltas reais apenas quando há dados */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 vx-stagger">
        <HeroCard icon={DollarSign} iconColor="var(--vx-teal)"   label="Total investido"   value={totalInv} format="brl"        sub={`Meta ${fmtBRL(totalMeta)} · Google ${fmtBRL(totalGoogle)}`} />
        <HeroCard icon={TrendingUp} iconColor="var(--vx-green)"  label="Receita atribuída" value={totalRev} format="brl"        sub={`Atribuição ${days}d · last-click + view`} />
        <HeroCard icon={Zap}        iconColor="var(--vx-purple)" label="ROAS consolidado"  value={roas}     format="multiplier" sub="Meta interna 3.0×" />
      </div>

      {/* KPIs secundários — sem deltas inventados: só valores reais do período */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 vx-stagger">
        <Kpi icon={UsersIcon}          iconColor="var(--vx-navy)"       label="Leads totais"     value={totalLeads} format="num" />
        <Kpi icon={DollarSign}         iconColor="var(--vx-amber)"      label="CPL médio"        value={cplMedio}   format="brl" />
        <Kpi icon={Eye}                iconColor="var(--vx-navy)"       label="Impressões"       value={totalImp}   format="numCompact" />
        <Kpi icon={MousePointerClick}  iconColor="var(--vx-teal-light)" label="CTR médio"        value={ctrAvg}     format="pct" />
        <Kpi icon={TargetIcon}         iconColor="var(--vx-teal-light)" label="Conversion rate"  value={cvrAvg}     format="pct" />
      </div>

      {/* Bloco trend + lead sources */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <SectionHeader title="Performance dos canais" sub={`Investimento diário Meta vs Google · últimos ${days} dias`}>
            <Legend items={[{ color: "var(--vx-meta)", label: "Meta Ads" }, { color: "var(--vx-google)", label: "Google Ads" }]} />
          </SectionHeader>
          <div className="h-[260px] mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="gradMeta" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1877F2" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#1877F2" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradGoogle" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#EA4335" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="#EA4335" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--vx-text-3)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--vx-text-3)" }} axisLine={false} tickLine={false} width={42} tickFormatter={(v) => `${(v/1000).toFixed(1)}k`} />
                <Tooltip content={<VxTooltip prefix="R$ " />} />
                <Area type="monotone" dataKey="Meta" stroke="#1877F2" strokeWidth={2} fill="url(#gradMeta)" animationDuration={900} />
                <Area type="monotone" dataKey="Google" stroke="#EA4335" strokeWidth={2} fill="url(#gradGoogle)" animationDuration={900} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <SectionHeader title="Origem dos leads" sub="Distribuição por canal" />
          <div className="h-[180px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={leadSources} dataKey="count" nameKey="name" innerRadius={48} outerRadius={75} stroke="hsl(var(--card))" strokeWidth={2} animationDuration={800}>
                  {leadSources.map((s) => <Cell key={s.name} fill={s.color} />)}
                </Pie>
                <Tooltip content={<VxTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 mt-2">
            {leadSources.length === 0 && (
              <p className="text-meta" style={{ color: "var(--vx-text-3)" }}>Nenhum lead no período selecionado.</p>
            )}
            {leadSources.slice(0, 4).map(s => (
              <div key={s.name} className="flex items-center gap-2 text-meta">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 truncate" style={{ color: "var(--vx-text-2)" }}>{s.name}</span>
                <span className="tabular-nums" style={{ color: "var(--vx-navy)", fontWeight: 500 }}>{s.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Funil + comparativo de canais */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <FunnelCard stages={data.funnel} />
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          <ChannelMiniCard color="var(--vx-meta)"   bg="var(--vx-meta-bg)"   icon={Facebook} name="Meta Ads"    sub="Facebook · Instagram · Reels"
            activeCount={metaCamps.filter(c => c.status === "ativo").length}
            metrics={[
              { label: "Investido", value: fmtBRL(totalMeta) },
              { label: "Leads", value: fmtNum(sumBy(metaCamps, "conversoes")) },
              { label: "CTR", value: fmtPct(metaCamps.length ? (sumBy(metaCamps, "cliques") / Math.max(1, sumBy(metaCamps, "impressoes"))) * 100 : 0) },
              { label: "CPC", value: fmtBRL(metaCamps.length ? sumBy(metaCamps, "investido") / Math.max(1, sumBy(metaCamps, "cliques")) : 0) },
            ]}
            bars={metaCamps.map(c => ({ label: c.nome, value: c.conversoes }))}
          />
          <ChannelMiniCard color="var(--vx-google)" bg="var(--vx-google-bg)" icon={Chrome}   name="Google Ads"  sub="Search · Display · YouTube"
            activeCount={googleCamps.filter(c => c.status === "ativo").length}
            metrics={[
              { label: "Investido", value: fmtBRL(totalGoogle) },
              { label: "Leads", value: fmtNum(sumBy(googleCamps, "conversoes")) },
              { label: "CTR", value: fmtPct(googleCamps.length ? (sumBy(googleCamps, "cliques") / Math.max(1, sumBy(googleCamps, "impressoes"))) * 100 : 0) },
              { label: "CPC", value: fmtBRL(googleCamps.length ? sumBy(googleCamps, "investido") / Math.max(1, sumBy(googleCamps, "cliques")) : 0) },
            ]}
            bars={googleCamps.map(c => ({ label: c.nome, value: c.conversoes }))}
          />
        </div>
      </div>
    </div>
  );
}

// ────────────── PANEL: META ──────────────

function PanelMeta({ data, days }: PanelProps) {
  const rows = data.meta.campaigns;

  if (rows.length === 0) {
    return <MarketingEmptyState platform="Meta Ads" tab="Meta Ads" />;
  }

  const inv = sumBy(rows, "investido");
  const rev = sumBy(rows, "receita_atrib");
  const imp = sumBy(rows, "impressoes");
  const clicks = sumBy(rows, "cliques");
  const conv = sumBy(rows, "conversoes");
  const reach = sumBy(rows, "alcance");
  const cpc = clicks ? inv / clicks : 0;
  const cpm = imp ? (inv / imp) * 1000 : 0;
  const freq = reach ? imp / reach : 0;
  const cpl = conv ? inv / conv : 0;

  // Série diária REAL vinda do meta_insights (antes era uma curva sintética)
  const trend = data.daily.map((d) => ({ day: d.day, Investido: d.spend, Leads: d.conversions }));

  const sorted = [...rows].sort((a, b) => b.conversoes - a.conversoes).slice(0, 6);

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2.5 vx-stagger">
        <Kpi icon={DollarSign}        iconColor="var(--vx-teal)"       label="Investido"    value={inv} format="brl" />
        <Kpi icon={TrendingUp}        iconColor="var(--vx-green)"      label="Receita"      value={rev} format="brl" />
        <Kpi icon={Eye}               iconColor="var(--vx-navy)"       label="Impressões"   value={imp} format="numCompact" />
        <Kpi icon={Activity}          iconColor="var(--vx-grafite)"    label="Frequência"   value={freq} format="decimal" />
        <Kpi icon={DollarSign}        iconColor="var(--vx-amber)"      label="CPM"          value={cpm} format="brl" />
        <Kpi icon={MousePointerClick} iconColor="var(--vx-teal-light)" label="Cliques"      value={clicks} format="numCompact" />
        <Kpi icon={DollarSign}        iconColor="var(--vx-amber)"      label="CPC"          value={cpc} format="brl" />
        <Kpi icon={UsersIcon}         iconColor="var(--vx-navy)"       label="Leads / CPL"  value={conv} format="num"   sub={` · ${fmtBRL(cpl)}`} />
      </div>

      {/* Trend + Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <SectionHeader title="Tendência diária" sub={`Investimento e leads · últimos ${days} dias`}>
            <Legend items={[{ color: "var(--vx-meta)", label: "Investido (R$)" }, { color: "var(--vx-purple)", label: "Leads" }]} />
          </SectionHeader>
          <div className="h-[240px] mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="gradMetaInv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1877F2" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#1877F2" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--vx-text-3)" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="l" tick={{ fontSize: 10, fill: "var(--vx-text-3)" }} axisLine={false} tickLine={false} width={42} tickFormatter={(v) => `${(v/1000).toFixed(1)}k`} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: "var(--vx-text-3)" }} axisLine={false} tickLine={false} width={32} />
                <Tooltip content={<VxTooltip />} />
                <Area yAxisId="l" type="monotone" dataKey="Investido" stroke="#1877F2" strokeWidth={2} fill="url(#gradMetaInv)" animationDuration={900} />
                <Line yAxisId="r" type="monotone" dataKey="Leads" stroke="var(--vx-purple)" strokeWidth={2} dot={false} animationDuration={900} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <SectionHeader title="Ranking de campanhas" sub="Por leads gerados" />
          <div className="h-[240px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "var(--vx-text-3)" }} axisLine={false} tickLine={false} />
                <YAxis dataKey="nome" type="category" width={120} tick={{ fontSize: 10, fill: "var(--vx-text-2)" }} axisLine={false} tickLine={false} tickFormatter={(s) => s.length > 18 ? s.slice(0, 17) + "…" : s} />
                <Tooltip content={<VxTooltip />} />
                <Bar dataKey="conversoes" name="Leads" fill="var(--vx-meta)" radius={[0, 4, 4, 0]} animationDuration={900} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <CampaignTable rows={rows} platform="meta" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <PublicoCard />
        <CriativoCard />
        <DemograficoCard />
      </div>
    </div>
  );
}

// ────────────── PANEL: GOOGLE ──────────────

function PanelGoogle({ data, days }: PanelProps) {
  const rows = data.google.campaigns;

  if (rows.length === 0) {
    return <MarketingEmptyState platform="Google Ads" tab="Google Ads" />;
  }

  const inv = sumBy(rows, "investido");
  const rev = sumBy(rows, "receita_atrib");
  const imp = sumBy(rows, "impressoes");
  const clicks = sumBy(rows, "cliques");
  const conv = sumBy(rows, "conversoes");
  const cpc = clicks ? inv / clicks : 0;
  const qsAvg = rows.length ? rows.reduce((s, r) => s + (r.quality_score || 0), 0) / rows.length : 0;
  const isAvg = rows.length ? rows.reduce((s, r) => s + (r.impression_share || 0), 0) / rows.length : 0;

  // Google Ads ainda não tem sincronização de insights — séries zeradas honestas
  const trend = data.daily.map((d) => ({ day: d.day, Investido: 0, Conversões: 0 }));
  const ctrSeries = data.daily.map((d) => ({ day: d.day, CTR: 0, CPC: 0 }));
  const sorted = [...rows].sort((a, b) => b.conversoes - a.conversoes).slice(0, 6);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2.5 vx-stagger">
        <Kpi icon={DollarSign}        iconColor="var(--vx-teal)"       label="Investido"     value={inv} format="brl" />
        <Kpi icon={TrendingUp}        iconColor="var(--vx-green)"      label="Receita"       value={rev} format="brl" />
        <Kpi icon={Eye}               iconColor="var(--vx-navy)"       label="Impressões"    value={imp} format="numCompact" />
        <Kpi icon={BarChart3}         iconColor="var(--vx-teal-light)" label="Imp. Share"    value={isAvg} format="pct" />
        <Kpi icon={MousePointerClick} iconColor="var(--vx-teal-light)" label="Cliques"       value={clicks} format="numCompact" />
        <Kpi icon={DollarSign}        iconColor="var(--vx-amber)"      label="CPC médio"     value={cpc} format="brl" />
        <Kpi icon={TargetIcon}        iconColor="var(--vx-teal-light)" label="Conversões"    value={conv} format="num" />
        <Kpi icon={Zap}               iconColor="var(--vx-purple)"     label="Quality Score" value={qsAvg} format="decimal" sub=" /10" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <SectionHeader title="Tendência diária" sub={`Investimento e conversões · últimos ${days} dias`}>
            <Legend items={[{ color: "var(--vx-google)", label: "Investido (R$)" }, { color: "var(--vx-purple)", label: "Conversões" }]} />
          </SectionHeader>
          <div className="h-[240px] mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="gradGoogleInv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#EA4335" stopOpacity={0.20} />
                    <stop offset="100%" stopColor="#EA4335" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--vx-text-3)" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="l" tick={{ fontSize: 10, fill: "var(--vx-text-3)" }} axisLine={false} tickLine={false} width={42} tickFormatter={(v) => `${(v/1000).toFixed(1)}k`} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: "var(--vx-text-3)" }} axisLine={false} tickLine={false} width={32} />
                <Tooltip content={<VxTooltip />} />
                <Area yAxisId="l" type="monotone" dataKey="Investido" stroke="#EA4335" strokeWidth={2} fill="url(#gradGoogleInv)" animationDuration={900} />
                <Line yAxisId="r" type="monotone" dataKey="Conversões" stroke="var(--vx-purple)" strokeWidth={2} dot={false} animationDuration={900} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <SectionHeader title="CTR vs CPC" sub="Eficiência por dia" />
          <div className="h-[240px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ctrSeries} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--vx-text-3)" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="l" tick={{ fontSize: 10, fill: "var(--vx-text-3)" }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => `${v}%`} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: "var(--vx-text-3)" }} axisLine={false} tickLine={false} width={32} />
                <Tooltip content={<VxTooltip />} />
                <Line yAxisId="l" type="monotone" dataKey="CTR" stroke="var(--vx-teal)" strokeWidth={2} dot={false} animationDuration={900} />
                <Line yAxisId="r" type="monotone" dataKey="CPC" stroke="var(--vx-amber)" strokeWidth={2} dot={false} animationDuration={900} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
        <SectionHeader title="Ranking de campanhas" sub="Por conversões" />
        <div className="h-[260px] mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "var(--vx-text-3)" }} axisLine={false} tickLine={false} />
              <YAxis dataKey="nome" type="category" width={160} tick={{ fontSize: 10, fill: "var(--vx-text-2)" }} axisLine={false} tickLine={false} tickFormatter={(s) => s.length > 26 ? s.slice(0, 25) + "…" : s} />
              <Tooltip content={<VxTooltip />} />
              <Bar dataKey="conversoes" name="Conversões" fill="var(--vx-google)" radius={[0, 4, 4, 0]} animationDuration={900} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <CampaignTable rows={rows} platform="google" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <KeywordsCard />
        <ImpShareCard />

        <QualityScoreCard />
      </div>
    </div>
  );
}

// ────────────── Hero card ──────────────

function HeroCard({ icon: Icon, iconColor, label, value, format, delta, sub }: any) {
  const animated = useCountUp(value);
  const formatted = formatValue(animated, format);
  const positive = delta >= 0;
  return (
    <div
      className="relative rounded-xl overflow-hidden vx-card-hover"
      style={{ border: "1px solid hsl(var(--border))", boxShadow: "var(--shadow-sm)" }}
    >
      {/* Top accent bar */}
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${iconColor}, ${iconColor}88)` }} />
      <div className="bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-label uppercase tracking-[0.10em] font-semibold" style={{ color: "var(--vx-text-3)" }}>{label}</span>
          <div className="h-8 w-8 rounded-lg grid place-items-center" style={{ background: `${iconColor}14` }}>
            <Icon className="h-4 w-4" style={{ color: iconColor }} />
          </div>
        </div>
        <div className="text-[28px] leading-none font-bold tabular-nums tracking-tight" style={{ color: "var(--vx-navy)" }}>
          {formatted}
        </div>
        {sub && <div className="text-meta mt-1.5" style={{ color: "var(--vx-text-2)" }}>{sub}</div>}

        {typeof delta === "number" && (
          <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: "0.5px solid hsl(var(--border))" }}>
            <span
              className="inline-flex items-center gap-0.5 text-label font-semibold px-1.5 py-0.5 rounded-full"
              style={{
                background: positive ? "var(--vx-green-bg)" : "var(--vx-red-bg)",
                color: positive ? "var(--vx-green)" : "var(--vx-red)",
              }}
            >
              {positive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
              {positive ? "+" : ""}{delta.toFixed(1)}%
            </span>
            <span className="text-label" style={{ color: "var(--vx-text-3)" }}>vs mês anterior</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────── Mini KPI ──────────────

function Kpi({ icon: Icon, iconColor, label, value, format, delta, sub, inverted }: any) {
  const animated = useCountUp(value);
  const formatted = formatValue(animated, format);
  const positive = inverted ? delta <= 0 : delta >= 0;
  return (
    <div className="rounded-xl bg-card overflow-hidden vx-card-hover" style={{ border: "1px solid hsl(var(--border))" }}>
      <div className="h-[2px]" style={{ background: iconColor || "var(--vx-teal)" }} />
      <div className="p-3.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-micro uppercase tracking-[0.09em] font-semibold" style={{ color: "var(--vx-text-3)" }}>{label}</span>
          {Icon && (
            <div className="h-6 w-6 rounded-md grid place-items-center" style={{ background: `${iconColor || "var(--vx-teal)"}14` }}>
              <Icon className="h-3 w-3" style={{ color: iconColor || "var(--vx-text-3)" }} />
            </div>
          )}
        </div>
        <div className="text-[18px] leading-tight font-bold tabular-nums" style={{ color: "var(--vx-navy)" }}>
          {formatted}
          {sub && <span className="text-meta font-normal ml-0.5" style={{ color: "var(--vx-text-3)" }}>{sub}</span>}
        </div>
        {typeof delta === "number" && (
          <div className="mt-1.5 text-label font-semibold inline-flex items-center gap-0.5" style={{ color: positive ? "var(--vx-green)" : "var(--vx-red)" }}>
            {positive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
            {delta > 0 ? "+" : ""}{Math.abs(delta) < 10 ? delta.toFixed(1) : Math.round(delta)}{format === "pct" ? "pp" : "%"}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────── Channel mini card ──────────────

function ChannelMiniCard({ color, bg, icon: Icon, name, sub, activeCount, metrics, bars }: any) {
  const max = Math.max(...bars.map((b: any) => b.value), 1);
  return (
    <div className="rounded-[10px] bg-card overflow-hidden vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
      <div style={{ height: 3, background: color }} />
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md grid place-items-center" style={{ background: bg }}>
              <Icon className="h-4 w-4" style={{ color }} />
            </div>
            <div>
              <div className="text-corpo font-medium" style={{ color: "var(--vx-navy)" }}>{name}</div>
              <div className="text-label" style={{ color: "var(--vx-text-3)" }}>{sub}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-label font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--vx-green-bg)", color: "var(--vx-green)" }}>
              {activeCount} ativas
            </span>
            <button className="text-label inline-flex items-center gap-0.5 hover:underline" style={{ color }}>
              Detalhes <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3 mb-4">
          {metrics.map((m: any) => (
            <div key={m.label}>
              <div className="text-micro uppercase tracking-[0.07em]" style={{ color: "var(--vx-text-3)" }}>{m.label}</div>
              <div className="text-corpo font-medium tabular-nums mt-0.5" style={{ color: "var(--vx-navy)" }}>{m.value}</div>
            </div>
          ))}
        </div>
        <div className="flex items-end gap-1 h-14" style={{ borderTop: "0.5px solid hsl(var(--border))", paddingTop: 12 }}>
          {bars.map((b: any, i: number) => (
            <div key={i} className="flex-1 rounded-t-sm vx-grow-h" style={{
              background: color,
              height: `${(b.value / max) * 100}%`,
              minHeight: 4,
              opacity: 0.85,
              animationDelay: `${i * 80}ms`,
            }} title={`${b.label}: ${b.value}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ────────────── Funil ──────────────

function FunnelCard({ stages }: { stages: FunnelStage[] }) {
  const parseN = (s: string) => {
    const n = parseFloat(s.replace(/[^\d.]/g, ""));
    return s.toLowerCase().includes("k") ? n * 1000 : n;
  };
  const maxNum = Math.max(1, ...stages.map((f) => parseN(f.num)));
  const colors = ["var(--vx-teal)", "var(--vx-teal-light)", "var(--vx-navy)", "var(--vx-purple)", "var(--vx-green)"];
  return (
    <div className="rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
      <SectionHeader title="Funil marketing → vendas" sub="Conversão por estágio (dados reais do período)" />
      <div className="space-y-3 mt-4">
        {stages.map((f, i) => {
          const value = parseN(f.num);
          const pct = (value / maxNum) * 100;
          const cor = colors[i] || "var(--vx-teal)";
          return (
            <div key={i}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-meta font-medium" style={{ color: "var(--vx-navy)" }}>{f.nome}</span>
                <span className="text-sm font-medium tabular-nums" style={{ color: cor }}>{f.num}</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--vx-teal-bg)" }}>
                <div className="h-full rounded-full vx-grow-w" style={{ width: `${pct}%`, background: cor, animationDelay: `${i * 100}ms` }} />
              </div>
              <div className="text-label mt-1" style={{ color: "var(--vx-text-3)" }}>{f.desc}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────── Subcards Meta ──────────────

/** Placeholder honesto para métricas que exigem sincronização detalhada ainda não integrada */
function PendingDataCard({ title, sub, requirement }: { title: string; sub: string; requirement: string }) {
  return (
    <SubCard title={title} sub={sub}>
      <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
        <Database className="h-6 w-6" style={{ color: "var(--vx-text-3)" }} />
        <p className="text-meta max-w-[220px]" style={{ color: "var(--vx-text-3)" }}>{requirement}</p>
      </div>
    </SubCard>
  );
}

function PublicoCard() {
  return (
    <PendingDataCard
      title="CPL por público"
      sub="Quanto menor, melhor"
      requirement="Requer sincronização de conjuntos de anúncios (ad sets) do Meta — ainda não integrada."
    />
  );
}

function CriativoCard() {
  return (
    <PendingDataCard
      title="Top criativos"
      sub="Ordenado por CTR"
      requirement="Requer sincronização de anúncios individuais (ads) do Meta — ainda não integrada."
    />
  );
}

function DemograficoCard() {
  return (
    <PendingDataCard
      title="Demografia"
      sub="% leads por faixa etária"
      requirement="Requer insights demográficos do Meta — ainda não integrados."
    />
  );
}

// ────────────── Subcards Google ──────────────

function KeywordsCard() {
  return (
    <PendingDataCard
      title="Palavras-chave"
      sub="Performance Search"
      requirement="Requer integração com Google Ads — ainda não disponível."
    />
  );
}

function ImpShareCard() {
  return (
    <PendingDataCard
      title="Impression Share"
      sub="Onde estou perdendo"
      requirement="Requer integração com Google Ads — ainda não disponível."
    />
  );
}

function QualityScoreCard() {
  return (
    <PendingDataCard
      title="Quality Score"
      sub="Saúde geral das campanhas"
      requirement="Requer integração com Google Ads — ainda não disponível."
    />
  );
}

// ────────────── Tabela de campanhas ──────────────

function CampaignTable({ rows, platform }: { rows: any[]; platform: "meta" | "google" }) {
  const statusBadge = (s: string) => {
    const map: Record<string, { bg: string; fg: string }> = {
      ativo:      { bg: "var(--vx-green-bg)", fg: "var(--vx-green)" },
      pausado:    { bg: "hsl(var(--muted))",  fg: "var(--vx-text-3)" },
      aprendendo: { bg: "var(--vx-amber-bg)", fg: "var(--vx-amber)" },
    };
    const c = map[s];
    return <span className="text-[9.5px] font-medium px-1.5 py-0.5 rounded capitalize" style={{ background: c.bg, color: c.fg }}>{s}</span>;
  };
  const colorRoas = (v: number) => v >= 3 ? "var(--vx-green)" : v >= 1 ? "var(--vx-amber)" : "var(--vx-red)";
  const colorCtr  = (v: number) => v >= 3 ? "var(--vx-green)" : v >= 1 ? "var(--vx-amber)" : "var(--vx-red)";
  const colorIs   = (v: number) => v >= 80 ? "var(--vx-green)" : v >= 60 ? "var(--vx-amber)" : "var(--vx-red)";
  const colorQs   = (v: number) => v >= 7 ? "var(--vx-green)" : v >= 5 ? "var(--vx-amber)" : "var(--vx-red)";

  return (
    <div className="rounded-[10px] bg-card overflow-x-auto vx-fade-up" style={{ border: "0.5px solid hsl(var(--border))" }}>
      <table className="w-full text-meta">
        <thead>
          <tr className="text-left" style={{ borderBottom: "0.5px solid hsl(var(--border))" }}>
            {[
              "Campanha", "Status", "Invest.", "Impressões",
              ...(platform === "meta" ? ["Alcance", "Freq.", "CPM"] : ["Imp.Share", "Cliques"]),
              "CPC", "CTR",
              ...(platform === "meta" ? ["Leads"] : ["Conv.", "CVR"]),
              "CPL", "ROAS",
              ...(platform === "meta" ? ["Receita"] : ["Q.Score"]),
            ].map((h, i) => (
              <th key={i} className={`px-3 py-2.5 text-[9.5px] uppercase tracking-[0.05em] font-medium ${i >= 2 ? "text-right" : ""}`} style={{ color: "var(--vx-text-3)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="transition-colors hover:bg-accent/40" style={{ borderBottom: "0.5px solid hsl(var(--border))" }}>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <div className="font-medium" style={{ color: "var(--vx-navy)" }}>{r.nome}</div>
                <div className="text-label" style={{ color: "var(--vx-text-3)" }}>{r.tipo}</div>
              </td>
              <td className="px-3 py-2.5">{statusBadge(r.status)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{fmtBRL(r.investido)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(r.impressoes)}</td>
              {platform === "meta" ? (
                <>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(r.alcance)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: r.frequencia > 3.5 ? "var(--vx-red)" : undefined }}>{r.frequencia.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">R$ {r.cpm.toFixed(2)}</td>
                </>
              ) : (
                <>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: colorIs(r.impression_share) }}>{r.impression_share}%</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(r.cliques)}</td>
                </>
              )}
              <td className="px-3 py-2.5 text-right tabular-nums">R$ {r.cpc.toFixed(2)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: colorCtr(r.ctr), fontWeight: 500 }}>{r.ctr.toFixed(2)}%</td>
              {platform === "google" && <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(r.conversoes)}</td>}
              {platform === "google" && <td className="px-3 py-2.5 text-right tabular-nums">{r.cvr.toFixed(2)}%</td>}
              {platform === "meta" && <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(r.conversoes)}</td>}
              <td className="px-3 py-2.5 text-right tabular-nums">R$ {r.cpl.toFixed(2)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium" style={{ color: colorRoas(r.roas) }}>{r.roas.toFixed(2)}×</td>
              {platform === "meta" && <td className="px-3 py-2.5 text-right tabular-nums">{fmtBRL(r.receita_atrib)}</td>}
              {platform === "google" && <td className="px-3 py-2.5 text-right tabular-nums font-medium" style={{ color: colorQs(r.quality_score) }}>{r.quality_score}/10</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ────────────── Helpers visuais ──────────────

function SectionHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <h3 className="vx-titulo-secao" style={{ color: "var(--vx-navy)" }}>{title}</h3>
        {sub && <p className="text-label mt-0.5" style={{ color: "var(--vx-text-3)" }}>{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function SubCard({ title, sub, children }: any) {
  return (
    <div className="rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
      <SectionHeader title={title} sub={sub} />
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-3">
      {items.map(i => (
        <div key={i.label} className="flex items-center gap-1.5 text-label" style={{ color: "var(--vx-text-2)" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: i.color }} />
          {i.label}
        </div>
      ))}
    </div>
  );
}

function VxTooltip({ active, payload, label, prefix = "", suffix = "" }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md p-2 text-label bg-card" style={{ border: "0.5px solid hsl(var(--border))", boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}>
      {label && <div className="font-medium mb-1" style={{ color: "var(--vx-navy)" }}>{label}</div>}
      {payload.map((p: any) => (
        <div key={p.dataKey || p.name} className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color || p.payload?.color }} />
          <span style={{ color: "var(--vx-text-2)" }}>{p.name}:</span>
          <span className="tabular-nums font-medium" style={{ color: "var(--vx-navy)" }}>{prefix}{typeof p.value === "number" ? p.value.toLocaleString("pt-BR") : p.value}{suffix}</span>
        </div>
      ))}
    </div>
  );
}

// ────────────── Format helper ──────────────

function formatValue(v: number, format: string) {
  switch (format) {
    case "brl":         return fmtBRL(Math.round(v));
    case "num":         return fmtNum(Math.round(v));
    case "numCompact":  return v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v/1_000).toFixed(1)}k` : fmtNum(Math.round(v));
    case "pct":         return `${v.toFixed(2)}%`;
    case "decimal":     return v.toFixed(1);
    case "multiplier":  return `${v.toFixed(2)}×`;
    default:            return String(Math.round(v));
  }
}
