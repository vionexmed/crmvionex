import { useState, useEffect, useRef } from "react";
import {
  LayoutGrid, Facebook, Chrome, TrendingUp, TrendingDown,
  ArrowUpRight, DollarSign, Target as TargetIcon, MousePointerClick,
  Eye, Users as UsersIcon, Zap, Activity, BarChart3, RefreshCw,
  Calendar, Database, PlugZap,
} from "lucide-react";


import {
  sumBy, fmtBRL, fmtNum, fmtPct,
  periodDays, type PeriodKey, type FunnelStage,
} from "@/lib/marketing-utils";
import { useMarketingData, type MarketingSource } from "@/hooks/useMarketingData";
import { formatarHora, formatarNumero } from "@/lib/formato";
import { SegmentedControl } from "@/components/layout/SegmentedControl";
import { EmptyState } from "@/components/layout/EstadoDaLista";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AreaSeries } from "@/components/dashboard/svg/AreaSeries";
import { RoscaComLegenda } from "@/components/dashboard/svg/RoscaComLegenda";
import { BarrasAgrupadas } from "@/components/dashboard/svg/BarrasAgrupadas";

type TabKey = "visao" | "meta" | "google";

const tabsConfig: Record<TabKey, { label: string; icon: any; color: string; bg: string; breadcrumb: string; h1: string; sub: string }> = {
  visao:  { label: "Visão geral", icon: LayoutGrid, color: "hsl(var(--primary))",   bg: "hsl(var(--primary) / 10%)",   breadcrumb: "Visão geral",  h1: "Visão geral de marketing", sub: "Performance consolidada de todas as fontes de tráfego" },
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
          <div className="flex items-center gap-1.5 text-label" style={{ color: "hsl(var(--muted-foreground))" }}>
            <span>Vionex</span>
            <span className="text-border">›</span>
            <span>Marketing</span>
            <span className="text-border">›</span>
            <span style={{ color: "hsl(var(--foreground))", fontWeight: 500 }}>{cfg.breadcrumb}</span>
          </div>
          <h1 className="vx-titulo-tela" style={{ color: "hsl(var(--foreground))" }}>
            {cfg.h1}
          </h1>
          <p className="vx-subtitulo-tela" style={{ color: "hsl(var(--muted-foreground))" }}>{cfg.sub}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <PeriodFilter value={period} onChange={setPeriod} customDays={customDays} onCustomChange={setCustomDays} />

          <SourceBadge source="real" />

          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md" style={{ background: "hsl(var(--primary) / 10%)", border: "0.5px solid hsl(var(--primary) / 30%)" }}>
            <span className="h-1.5 w-1.5 rounded-full vx-pulse-dot" style={{ background: "hsl(var(--primary))" }} />
            <span className="text-label" style={{ color: "hsl(var(--primary))" }}>Atualizado às {horaAtualizacao}</span>
          </div>
          <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-label font-medium transition-colors hover:bg-accent" style={{ border: "0.5px solid hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
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

/**
 * O seletor de período.
 *
 * Era a SEXTA cópia do grupo de pílulas, e tinha o teal CRAVADO como
 * `var(--vx-teal)` no fundo do item ativo -- mesmo defeito que a barra lateral
 * tinha: a cor de destaque é trocável em tempo de execução, e escolher roxo
 * deixava o período selecionado teal.
 *
 * "Custom" também era a única palavra em inglês da tela.
 */
function PeriodFilter({ value, onChange, customDays, onCustomChange }: {
  value: PeriodKey;
  onChange: (k: PeriodKey) => void;
  customDays: number;
  onCustomChange: (n: number) => void;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <SegmentedControl<PeriodKey>
        rotuloGrupo="Período"
        valor={value}
        onChange={onChange}
        compactoNoCelular={false}
        opcoes={[
          { valor: "7d", rotulo: "7 dias" },
          { valor: "30d", rotulo: "30 dias" },
          { valor: "90d", rotulo: "90 dias" },
          { valor: "custom", rotulo: "Escolher", icone: Calendar },
        ]}
      />
      {value === "custom" && (
        <div className="inline-flex items-center gap-1.5">
          <Input
            type="number"
            min={1}
            max={365}
            value={customDays}
            onChange={(e) => onCustomChange(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
            aria-label="Número de dias do período"
            className="h-8 w-16 text-center text-label tabular-nums"
          />
          <span className="text-label text-muted-foreground">dias</span>
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source: _source }: { source: MarketingSource }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-label font-medium"
      style={{
        background: "hsl(var(--success) / 10%)",
        color: "hsl(var(--success))",
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

/**
 * A barra de abas do Marketing.
 *
 * Era a SÉTIMA cópia deste controle no projeto, e a única que não usava nem
 * `PageTabs` nem `SegmentedControl` -- botões com estilo em linha, incluindo a
 * sombra e a borda escritas à mão.
 *
 * A cor por aba (azul do Meta, vermelho do Google) é o motivo de ela existir, e
 * agora é uma opção do primitivo em vez de uma cópia inteira.
 */
function TabBar({ tab, onChange }: { tab: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <SegmentedControl<TabKey>
      rotuloGrupo="Fonte de tráfego"
      valor={tab}
      onChange={onChange}
      compactoNoCelular={false}
      opcoes={(Object.keys(tabsConfig) as TabKey[]).map((k) => ({
        valor: k,
        rotulo: tabsConfig[k].label,
        icone: tabsConfig[k].icon,
        corAtiva: tabsConfig[k].color,
      }))}
    />
  );
}

// ────────────── Empty state ──────────────

/**
 * Era o décimo terceiro formato de estado vazio do projeto: ícone num anel,
 * título, descrição -- exatamente o que `EmptyState` faz, escrito de novo com
 * medidas próprias.
 *
 * A linha "Aba: {tab}" saiu. Não dizia nada a quem lê: a aba está selecionada
 * na barra logo acima.
 */
function MarketingEmptyState({
  platform,
  /**
   * `nao-integrado` não é "sem dados no período".
   *
   * O Google Ads dizia "Conecte sua conta Google Ads" e oferecia um botão para
   * Integrações -- onde não existe integração de Google Ads para conectar. A
   * tela mandava a pessoa procurar uma coisa que não está lá.
   */
  integrado = true,
}: {
  platform: string;
  integrado?: boolean;
}) {
  if (!integrado) {
    return (
      <EmptyState
        icone={PlugZap}
        titulo={`${platform} ainda não integrado`}
        descricao={`A sincronização com ${platform} não foi construída. Não é ausência de campanha no período — é ausência da integração.`}
      />
    );
  }
  return (
    <EmptyState
      icone={PlugZap}
      titulo={`Sem dados de ${platform}`}
      descricao={`Conecte sua conta ${platform} para ver as campanhas aqui.`}
      acao={
        <Button asChild size="sm" variant="outline">
          <a href="/settings/integrations">Ir para Integrações</a>
        </Button>
      }
    />
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
    return <MarketingEmptyState platform="Meta Ads ou Google Ads" />;
  }

  /**
   * Série diária REAL do período.
   *
   * A linha do Google era `Google: 0` CRAVADO — o gráfico desenhava uma reta no
   * zero e a tela dizia, sem dizer, que o Google não gastou nada. Agora vem do
   * hook, por plataforma. Os valores já estão em reais: a divisão dos micros do
   * Google acontece na edge function.
   */
  const series = data.daily.map((d) => ({ day: d.day, Meta: d.spendMeta, Google: d.spendGoogle }));
  const leadSources = data.sources;

  return (
    <div className="space-y-5">
      {/* Hero cards — deltas reais apenas quando há dados */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 vx-stagger">
        <HeroCard icon={DollarSign} iconColor="hsl(var(--primary))"   label="Total investido"   value={totalInv} format="brl"        sub={`Meta ${fmtBRL(totalMeta)} · Google ${fmtBRL(totalGoogle)}`} />
        <HeroCard icon={TrendingUp} iconColor="hsl(var(--success))"  label="Receita atribuída" value={totalRev} format="brl"        sub={`Atribuição ${days}d · last-click + view`} />
        <HeroCard icon={Zap}        iconColor="var(--vx-purple)" label="ROAS consolidado"  value={roas}     format="multiplier" sub="Meta interna 3.0×" />
      </div>

      {/* KPIs secundários — sem deltas inventados: só valores reais do período */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 vx-stagger">
        <Kpi icon={UsersIcon}          iconColor="hsl(var(--foreground))"       label="Leads totais"     value={totalLeads} format="num" />
        <Kpi icon={DollarSign}         iconColor="hsl(var(--warning))"      label="CPL médio"        value={cplMedio}   format="brl" />
        <Kpi icon={Eye}                iconColor="hsl(var(--foreground))"       label="Impressões"       value={totalImp}   format="numCompact" />
        <Kpi icon={MousePointerClick}  iconColor="hsl(var(--primary))" label="CTR médio"        value={ctrAvg}     format="pct" />
        <Kpi icon={TargetIcon}         iconColor="hsl(var(--primary))" label="Conversion rate"  value={cvrAvg}     format="pct" />
      </div>

      {/* Bloco trend + lead sources */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <SectionHeader title="Performance dos canais" sub={`Investimento diário Meta vs Google · últimos ${days} dias`}>
            <Legend items={[{ color: "var(--vx-meta)", label: "Meta Ads" }, { color: "var(--vx-google)", label: "Google Ads" }]} />
          </SectionHeader>
          <div className="mt-4">
            <AreaSeries
              altura={260}
              formatar={fmtBRL}
              rotulos={series.map((d) => d.day)}
              series={[
                { nome: "Meta Ads", cor: "var(--vx-meta)", pontos: series.map((d) => d.Meta), preencher: true },
                { nome: "Google Ads", cor: "var(--vx-google)", pontos: series.map((d) => d.Google), preencher: true },
              ]}
            />
          </div>
        </div>

        <div className="rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <SectionHeader title="Origem dos leads" sub="Distribuição por canal" />
          {/* A rosca e a lista de canais eram dois blocos separados, com a
              legenda montada à mão logo abaixo do gráfico. `RoscaComLegenda`
              já é o par -- e mostra o percentual, que a lista não mostrava. */}
          <div className="mt-2">
            <RoscaComLegenda
              tamanho={150}
              fatias={leadSources.map((f) => ({ nome: f.name, valor: f.count, cor: f.color }))}
            />
          </div>
          {leadSources.length === 0 && (
            <p className="mt-2 text-label text-muted-foreground">
              Nenhum lead no período selecionado.
            </p>
          )}
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
    return <MarketingEmptyState platform="Meta Ads" />;
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
        <Kpi icon={DollarSign}        iconColor="hsl(var(--primary))"       label="Investido"    value={inv} format="brl" />
        <Kpi icon={TrendingUp}        iconColor="hsl(var(--success))"      label="Receita"      value={rev} format="brl" />
        <Kpi icon={Eye}               iconColor="hsl(var(--foreground))"       label="Impressões"   value={imp} format="numCompact" />
        <Kpi icon={Activity}          iconColor="hsl(var(--foreground))"    label="Frequência"   value={freq} format="decimal" />
        <Kpi icon={DollarSign}        iconColor="hsl(var(--warning))"      label="CPM"          value={cpm} format="brl" />
        <Kpi icon={MousePointerClick} iconColor="hsl(var(--primary))" label="Cliques"      value={clicks} format="numCompact" />
        <Kpi icon={DollarSign}        iconColor="hsl(var(--warning))"      label="CPC"          value={cpc} format="brl" />
        <Kpi icon={UsersIcon}         iconColor="hsl(var(--foreground))"       label="Leads / CPL"  value={conv} format="num"   sub={` · ${fmtBRL(cpl)}`} />
      </div>

      {/* Trend + Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <SectionHeader title="Tendência diária" sub={`Investimento e leads · últimos ${days} dias`}>
            <Legend items={[{ color: "var(--vx-meta)", label: "Investido (R$)" }, { color: "var(--vx-purple)", label: "Leads" }]} />
          </SectionHeader>
          <div className="mt-4">
            {/* Dois eixos: investimento em reais à esquerda, leads à
                direita. Numa escala comum a contagem viraria uma linha colada
                no zero. */}
            <AreaSeries
              altura={240}
              formatar={fmtBRL}
              rotulos={trend.map((d) => d.day)}
              series={[
                { nome: "Investido", cor: "var(--vx-meta)", pontos: trend.map((d) => d.Investido), preencher: true },
                { nome: "Leads", cor: "var(--vx-purple)", pontos: trend.map((d) => d.Leads), eixoDireito: true },
              ]}
            />
          </div>
        </div>

        <div className="rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <SectionHeader title="Ranking de campanhas" sub="Por leads gerados" />
          {/* Já era `layout="vertical"`, ou seja barras horizontais. O nome
              deixa de ser truncado em 18 caracteres por `tickFormatter`: a
              linha inteira é do rótulo, e o CSS corta se precisar. */}
          <div className="mt-2">
            <BarrasAgrupadas
              linhas={sorted}
              rotulo={(c) => c.nome}
              formatar={formatarNumero}
              vazio="Nenhuma campanha com leads no período"
              series={[{ nome: "Leads", cor: "var(--vx-meta)", valor: (c) => c.conversoes }]}
            />
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
    return <MarketingEmptyState platform="Google Ads" integrado={false} />;
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
        <Kpi icon={DollarSign}        iconColor="hsl(var(--primary))"       label="Investido"     value={inv} format="brl" />
        <Kpi icon={TrendingUp}        iconColor="hsl(var(--success))"      label="Receita"       value={rev} format="brl" />
        <Kpi icon={Eye}               iconColor="hsl(var(--foreground))"       label="Impressões"    value={imp} format="numCompact" />
        <Kpi icon={BarChart3}         iconColor="hsl(var(--primary))" label="Imp. Share"    value={isAvg} format="pct" />
        <Kpi icon={MousePointerClick} iconColor="hsl(var(--primary))" label="Cliques"       value={clicks} format="numCompact" />
        <Kpi icon={DollarSign}        iconColor="hsl(var(--warning))"      label="CPC médio"     value={cpc} format="brl" />
        <Kpi icon={TargetIcon}        iconColor="hsl(var(--primary))" label="Conversões"    value={conv} format="num" />
        <Kpi icon={Zap}               iconColor="var(--vx-purple)"     label="Quality Score" value={qsAvg} format="decimal" sub=" /10" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <SectionHeader title="Tendência diária" sub={`Investimento e conversões · últimos ${days} dias`}>
            <Legend items={[{ color: "var(--vx-google)", label: "Investido (R$)" }, { color: "var(--vx-purple)", label: "Conversões" }]} />
          </SectionHeader>
          <div className="mt-4">
            {/* Dois eixos: investimento em reais à esquerda, conversões à
                direita. Numa escala comum a contagem viraria uma linha colada
                no zero. */}
            <AreaSeries
              altura={240}
              formatar={fmtBRL}
              rotulos={trend.map((d) => d.day)}
              series={[
                { nome: "Investido", cor: "var(--vx-google)", pontos: trend.map((d) => d.Investido), preencher: true },
                { nome: "Conversões", cor: "var(--vx-purple)", pontos: trend.map((d) => d["Conversões"]), eixoDireito: true },
              ]}
            />
          </div>
        </div>

        <div className="rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <SectionHeader title="CTR vs CPC" sub="Eficiência por dia" />
          <div className="mt-2">
            {/* Linha é área sem preenchimento -- o mesmo primitivo. CTR em
                porcento à esquerda, CPC em reais à direita: grandezas que não
                se comparam. */}
            <AreaSeries
              altura={240}
              formatar={(v) => `${v}`}
              rotulos={ctrSeries.map((d) => d.day)}
              series={[
                { nome: "CTR (%)", cor: "hsl(var(--primary))", pontos: ctrSeries.map((d) => d.CTR) },
                { nome: "CPC (R$)", cor: "hsl(var(--warning))", pontos: ctrSeries.map((d) => d.CPC), eixoDireito: true },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
        <SectionHeader title="Ranking de campanhas" sub="Por conversões" />
        <div className="mt-4">
          <BarrasAgrupadas
            linhas={sorted}
            rotulo={(c) => c.nome}
            formatar={formatarNumero}
            vazio="Nenhuma campanha com conversões no período"
            series={[{ nome: "Conversões", cor: "var(--vx-google)", valor: (c) => c.conversoes }]}
          />
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
      className="relative rounded-lg overflow-hidden vx-card-hover"
      style={{ border: "1px solid hsl(var(--border))", boxShadow: "var(--shadow-sm)" }}
    >
      {/* Top accent bar */}
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${iconColor}, ${iconColor}88)` }} />
      <div className="bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-label uppercase tracking-[0.10em] font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</span>
          <div className="h-8 w-8 rounded-lg grid place-items-center" style={{ background: `${iconColor}14` }}>
            <Icon className="h-4 w-4" style={{ color: iconColor }} />
          </div>
        </div>
        <div className="text-[28px] leading-none font-bold tabular-nums tracking-tight" style={{ color: "hsl(var(--foreground))" }}>
          {formatted}
        </div>
        {sub && <div className="text-label mt-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>{sub}</div>}

        {typeof delta === "number" && (
          <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: "0.5px solid hsl(var(--border))" }}>
            <span
              className="inline-flex items-center gap-0.5 text-label font-semibold px-1.5 py-0.5 rounded-full"
              style={{
                background: positive ? "hsl(var(--success) / 10%)" : "hsl(var(--destructive) / 10%)",
                color: positive ? "hsl(var(--success))" : "hsl(var(--destructive))",
              }}
            >
              {positive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
              {positive ? "+" : ""}{delta.toFixed(1)}%
            </span>
            <span className="text-label" style={{ color: "hsl(var(--muted-foreground))" }}>vs mês anterior</span>
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
    <div className="rounded-lg bg-card overflow-hidden vx-card-hover" style={{ border: "1px solid hsl(var(--border))" }}>
      <div className="h-[2px]" style={{ background: iconColor || "hsl(var(--primary))" }} />
      <div className="p-3.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-label uppercase tracking-[0.09em] font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</span>
          {Icon && (
            <div className="h-6 w-6 rounded-md grid place-items-center" style={{ background: `${iconColor || "hsl(var(--primary))"}14` }}>
              <Icon className="h-3 w-3" style={{ color: iconColor || "hsl(var(--muted-foreground))" }} />
            </div>
          )}
        </div>
        <div className="text-[18px] leading-tight font-bold tabular-nums" style={{ color: "hsl(var(--foreground))" }}>
          {formatted}
          {sub && <span className="text-label font-normal ml-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{sub}</span>}
        </div>
        {typeof delta === "number" && (
          <div className="mt-1.5 text-label font-semibold inline-flex items-center gap-0.5" style={{ color: positive ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
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
              <div className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{name}</div>
              <div className="text-label" style={{ color: "hsl(var(--muted-foreground))" }}>{sub}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-label font-medium px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--success) / 10%)", color: "hsl(var(--success))" }}>
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
              <div className="text-label uppercase tracking-[0.07em]" style={{ color: "hsl(var(--muted-foreground))" }}>{m.label}</div>
              <div className="text-sm font-medium tabular-nums mt-0.5" style={{ color: "hsl(var(--foreground))" }}>{m.value}</div>
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
  const colors = ["hsl(var(--primary))", "hsl(var(--primary))", "hsl(var(--foreground))", "var(--vx-purple)", "hsl(var(--success))"];
  return (
    <div className="rounded-[10px] bg-card p-5 vx-fade-up vx-card-hover" style={{ border: "0.5px solid hsl(var(--border))" }}>
      <SectionHeader title="Funil marketing → vendas" sub="Conversão por estágio (dados reais do período)" />
      <div className="space-y-3 mt-4">
        {stages.map((f, i) => {
          const value = parseN(f.num);
          const pct = (value / maxNum) * 100;
          const cor = colors[i] || "hsl(var(--primary))";
          return (
            <div key={i}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-label font-medium" style={{ color: "hsl(var(--foreground))" }}>{f.nome}</span>
                <span className="text-sm font-medium tabular-nums" style={{ color: cor }}>{f.num}</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--primary) / 10%)" }}>
                <div className="h-full rounded-full vx-grow-w" style={{ width: `${pct}%`, background: cor, animationDelay: `${i * 100}ms` }} />
              </div>
              <div className="text-label mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>{f.desc}</div>
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
        <Database className="h-6 w-6" style={{ color: "hsl(var(--muted-foreground))" }} />
        <p className="text-label max-w-[220px]" style={{ color: "hsl(var(--muted-foreground))" }}>{requirement}</p>
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
      ativo:      { bg: "hsl(var(--success) / 10%)", fg: "hsl(var(--success))" },
      pausado:    { bg: "hsl(var(--muted))",  fg: "hsl(var(--muted-foreground))" },
      aprendendo: { bg: "hsl(var(--warning) / 10%)", fg: "hsl(var(--warning))" },
    };
    const c = map[s];
    return <span className="text-[9.5px] font-medium px-1.5 py-0.5 rounded capitalize" style={{ background: c.bg, color: c.fg }}>{s}</span>;
  };
  const colorRoas = (v: number) => v >= 3 ? "hsl(var(--success))" : v >= 1 ? "hsl(var(--warning))" : "hsl(var(--destructive))";
  const colorCtr  = (v: number) => v >= 3 ? "hsl(var(--success))" : v >= 1 ? "hsl(var(--warning))" : "hsl(var(--destructive))";
  const colorIs   = (v: number) => v >= 80 ? "hsl(var(--success))" : v >= 60 ? "hsl(var(--warning))" : "hsl(var(--destructive))";
  const colorQs   = (v: number) => v >= 7 ? "hsl(var(--success))" : v >= 5 ? "hsl(var(--warning))" : "hsl(var(--destructive))";

  return (
    <div className="rounded-[10px] bg-card overflow-x-auto vx-fade-up" style={{ border: "0.5px solid hsl(var(--border))" }}>
      <table className="w-full text-label">
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
              <th key={i} className={`px-3 py-2.5 text-[9.5px] uppercase tracking-[0.05em] font-medium ${i >= 2 ? "text-right" : ""}`} style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="transition-colors hover:bg-accent/40" style={{ borderBottom: "0.5px solid hsl(var(--border))" }}>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <div className="font-medium" style={{ color: "hsl(var(--foreground))" }}>{r.nome}</div>
                <div className="text-label" style={{ color: "hsl(var(--muted-foreground))" }}>{r.tipo}</div>
              </td>
              <td className="px-3 py-2.5">{statusBadge(r.status)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{fmtBRL(r.investido)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(r.impressoes)}</td>
              {platform === "meta" ? (
                <>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(r.alcance)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: r.frequencia > 3.5 ? "hsl(var(--destructive))" : undefined }}>{r.frequencia.toFixed(2)}</td>
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
        <h3 className="vx-titulo-secao" style={{ color: "hsl(var(--foreground))" }}>{title}</h3>
        {sub && <p className="text-label mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{sub}</p>}
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
        <div key={i.label} className="flex items-center gap-1.5 text-label" style={{ color: "hsl(var(--muted-foreground))" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: i.color }} />
          {i.label}
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
