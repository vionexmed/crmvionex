import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CreditCard, Crown } from "lucide-react";

export function BillingTab({ orgId }: { orgId: string | null }) {
  const [org, setOrg] = useState<any>(null);
  const [counts, setCounts] = useState({ contacts: 0, deals: 0, companies: 0 });

  useEffect(() => {
    if (!orgId) return;
    supabase.from("organizations").select("*").eq("id", orgId).maybeSingle().then(({ data }) => setOrg(data));
    Promise.all([
      supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabase.from("deals").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabase.from("companies").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    ]).then(([c, d, co]) => setCounts({ contacts: c.count || 0, deals: d.count || 0, companies: co.count || 0 }));
  }, [orgId]);

  const plans = [
    { name: "Free", price: "R$ 0", features: ["500 contatos", "2 funis", "1 usuário", "Relatórios básicos"], limit: { contacts: 500, users: 1 }, current: org?.plan === "free" || !org?.plan },
    { name: "Pro", price: "R$ 149/mês", features: ["10.000 contatos", "Funis ilimitados", "10 usuários", "AI Copilot", "Automações", "API REST"], limit: { contacts: 10000, users: 10 }, current: org?.plan === "pro" },
    { name: "Enterprise", price: "Sob consulta", features: ["Contatos ilimitados", "Usuários ilimitados", "SSO / SAML", "SLA dedicado", "White-label", "Suporte prioritário"], limit: { contacts: Infinity, users: Infinity }, current: org?.plan === "enterprise" },
  ];

  const invoices = [
    { date: "01/03/2026", amount: "R$ 149,00", status: "Pago", plan: "Pro" },
    { date: "01/02/2026", amount: "R$ 149,00", status: "Pago", plan: "Pro" },
    { date: "01/01/2026", amount: "R$ 149,00", status: "Pago", plan: "Pro" },
  ];

  return (
    <div className="space-y-4">
      {/* Usage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-1.5"><CreditCard className="h-4 w-4" />Uso Atual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Contatos", count: counts.contacts, limit: plans.find((p) => p.current)?.limit.contacts || 500 },
              { label: "Negócios", count: counts.deals, limit: "∞" },
              { label: "Empresas", count: counts.companies, limit: "∞" },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <p className="text-lg font-bold">{item.count}</p>
                <p className="text-[10px] text-muted-foreground">{item.label} {typeof item.limit === "number" ? `/ ${item.limit.toLocaleString()}` : ""}</p>
                {typeof item.limit === "number" && (
                  <div className="mt-1 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, (item.count / item.limit) * 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Plans */}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.name} className={plan.current ? "border-primary" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                {plan.name === "Enterprise" && <Crown className="h-4 w-4 text-warning" />}
                <CardTitle className="text-sm">{plan.name}</CardTitle>
                {plan.current && <Badge className="text-[8px]">Atual</Badge>}
              </div>
              <p className="text-lg font-bold">{plan.price}</p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {plan.features.map((f) => (
                  <li key={f} className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                    <span className="text-success">✓</span>{f}
                  </li>
                ))}
              </ul>
              {!plan.current && (
                <Button variant="outline" size="sm" className="w-full mt-4 h-8 text-[10px]">
                  {plan.name === "Enterprise" ? "Falar com Vendas" : "Fazer Upgrade"}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Histórico de Faturas</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px]">Data</TableHead>
                <TableHead className="text-[10px]">Plano</TableHead>
                <TableHead className="text-[10px]">Valor</TableHead>
                <TableHead className="text-[10px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{inv.date}</TableCell>
                  <TableCell className="text-xs">{inv.plan}</TableCell>
                  <TableCell className="text-xs">{inv.amount}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[8px] text-success">{inv.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
