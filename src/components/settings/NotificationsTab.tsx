import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Bell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useId } from "react";

/**
 * Linha de preferência: rótulo à esquerda, interruptor à direita.
 *
 * Estava declarado dentro do render -- tipo novo a cada render, então o
 * `Switch` do Radix era DESMONTADO e remontado a cada mudança de preferência.
 * Na prática: a animação do interruptor não completava e o foco do teclado se
 * perdia ao alternar.
 *
 * O rótulo também não estava associado ao controle. `<span>` solto não é
 * clicável e o leitor de tela anunciava o interruptor sem nome; `useId` +
 * `htmlFor` resolve os dois.
 */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between py-1.5">
      <Label htmlFor={id} className="text-xs font-normal cursor-pointer">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function NotificationsTab({ orgId, userId }: { orgId: string | null; userId?: string }) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState({
    daily_summary: true, daily_summary_hour: 9,
    notify_deal_won: true, notify_deal_lost: true,
    notify_task_overdue: true, notify_mention: true, notify_assignment: true,
    email_daily_summary: true, email_deal_won: false, email_task_overdue: false,
  });
  const [, setLoaded] = useState(false);

  useEffect(() => {
    if (!orgId || !userId) return;
    supabase.from("notification_preferences").select("*").eq("user_id", userId).eq("org_id", orgId).maybeSingle()
      .then(({ data }: any) => {
        if (data) setPrefs(data);
        setLoaded(true);
      });
  }, [orgId, userId]);

  const save = async () => {
    if (!orgId || !userId) return;
    const { error } = await supabase.from("notification_preferences").upsert({
      user_id: userId, org_id: orgId, ...prefs,
    } as any, { onConflict: "user_id,org_id" });
    toast(error ? { title: "Erro", variant: "destructive" } : { title: "Preferências salvas" });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-1.5"><Bell className="h-4 w-4" />Notificações In-App</CardTitle>
          <CardDescription className="text-[10px]">Quais eventos geram notificação no CRM</CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <Toggle label="Negócio ganho" checked={prefs.notify_deal_won} onChange={(v) => setPrefs({ ...prefs, notify_deal_won: v })} />
          <Toggle label="Negócio perdido" checked={prefs.notify_deal_lost} onChange={(v) => setPrefs({ ...prefs, notify_deal_lost: v })} />
          <Toggle label="Tarefa vencida" checked={prefs.notify_task_overdue} onChange={(v) => setPrefs({ ...prefs, notify_task_overdue: v })} />
          <Toggle label="Menção (@)" checked={prefs.notify_mention} onChange={(v) => setPrefs({ ...prefs, notify_mention: v })} />
          <Toggle label="Atribuição de registro" checked={prefs.notify_assignment} onChange={(v) => setPrefs({ ...prefs, notify_assignment: v })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Notificações por Email</CardTitle>
          <CardDescription className="text-[10px]">Quais emails você deseja receber</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="divide-y divide-border">
            <Toggle label="Resumo diário" checked={prefs.email_daily_summary} onChange={(v) => setPrefs({ ...prefs, email_daily_summary: v })} />
            <Toggle label="Negócio ganho" checked={prefs.email_deal_won} onChange={(v) => setPrefs({ ...prefs, email_deal_won: v })} />
            <Toggle label="Tarefa vencida" checked={prefs.email_task_overdue} onChange={(v) => setPrefs({ ...prefs, email_task_overdue: v })} />
          </div>
          {prefs.email_daily_summary && (
            <div className="flex items-center gap-2">
              <Label className="text-xs">Horário do resumo:</Label>
              <Select value={String(prefs.daily_summary_hour)} onValueChange={(v) => setPrefs({ ...prefs, daily_summary_hour: parseInt(v) })}>
                <SelectTrigger className="h-8 text-xs w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>{String(i).padStart(2, "0")}:00</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <Button size="sm" className="h-8 text-xs" onClick={save}>Salvar Preferências</Button>
    </div>
  );
}
