import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { PhoneInput } from "@/components/ui/phone-input";
import { AREAS_ATUACAO, PAISES } from "@/lib/contact-options";
import type { Database } from "@/integrations/supabase/types";

type Company = Database["public"]["Tables"]["companies"]["Row"];

interface ContactCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  companies: Company[];
}

export function ContactCreateModal({ open, onOpenChange, onCreated, companies }: ContactCreateModalProps) {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { toast } = useToast();

  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneValid, setPhoneValid] = useState(false);
  const [companyId, setCompanyId] = useState("none");
  const [companyName, setCompanyName] = useState("");
  const [pais, setPais] = useState("");
  const [cidade, setCidade] = useState("");
  const [areaAtuacao, setAreaAtuacao] = useState("");
  const [interesse, setInteresse] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setFullName(""); setEmail(""); setPhone(""); setPhoneValid(false);
    setCompanyId("none"); setCompanyName(""); setPais(""); setCidade("");
    setAreaAtuacao(""); setInteresse(""); setErrors({});
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = "Nome é obrigatório";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Email inválido";
    if (phone && !phoneValid) errs.phone = "Telefone inválido (inclua DDI + DDD)";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreate = async () => {
    if (!orgId || !validate()) return;
    setSaving(true);

    const [first, ...rest] = fullName.trim().split(/\s+/);
    const last = rest.join(" ") || null;

    // Se digitou nome de empresa manualmente e não selecionou uma existente,
    // salvamos no título/metadata
    const resolvedCompanyId = companyId !== "none" ? companyId : null;

    const { error } = await supabase.from("contacts").insert({
      org_id: orgId,
      first_name: first,
      last_name: last,
      email: email || null,
      phone: phone || null,
      title: areaAtuacao || null,
      // Nem `status` nem `lifecycle_stage`: o default da coluna é 'lead', que é
      // o certo -- pessoa nova entra na boca do funil.
      //
      // Havia `status: "prospect"` aqui, e não era enfeite. O trigger deriva o
      // ciclo de vida do status no INSERT, e 'prospect' vira 'qualified' -- ou
      // seja, todo contato cadastrado à mão nascia QUALIFICADO sem ninguém ter
      // qualificado, e por isso nunca aparecia na tela de Leads. Escrever
      // 'lead' explicitamente seria inócuo: nesse ramo do trigger o status
      // vence de todo jeito. O que resolve é não escrever o status.
      owner_id: user?.id,
      company_id: resolvedCompanyId,
      metadata: {
        source: "manual", // origem: cadastrado manualmente no CRM
        pais,
        cidade,
        area_atuacao: areaAtuacao,
        interesse,
        empresa_manual: companyId === "none" ? companyName : "",
        responsavel_cadastro: user?.email || "",
      } as never,
    });

    setSaving(false);
    if (error) {
      toast({ title: "Erro ao criar contato", description: error.message, variant: "destructive" });
      return;
    }
    onOpenChange(false);
    onCreated();
    toast({ title: "Contato criado com sucesso" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Contato</DialogTitle>
          <DialogDescription>Preencha os dados do contato</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-1">
          {/* Nome */}
          <Field label="Nome completo *" error={errors.fullName}>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ex: Ana Beatriz Costa"
              autoFocus
            />
          </Field>

          {/* Empresa */}
          <Field label="Empresa">
            {companies.length > 0 ? (
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger><SelectValue placeholder="Selecione ou deixe em branco" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Nenhuma cadastrada —</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Nome da empresa"
              />
            )}
          </Field>

          {/* País + Cidade — lado a lado */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="País">
              <Select value={pais || "__none__"} onValueChange={(v) => setPais(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhum —</SelectItem>
                  {PAISES.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Cidade">
              <Input
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                placeholder="Ex: São Paulo"
              />
            </Field>
          </div>

          {/* Número */}
          <Field label="Número de telefone" error={errors.phone}>
            <PhoneInput
              value={phone}
              onChange={(e164, valid) => { setPhone(e164); setPhoneValid(valid); }}
            />
          </Field>

          {/* Email */}
          <Field label="Email" error={errors.email}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contato@email.com"
            />
          </Field>

          {/* Área de atuação */}
          <Field label="Área de atuação (opcional)">
            <Select value={areaAtuacao || "__none__"} onValueChange={(v) => setAreaAtuacao(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Selecione ou deixe em branco" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Nenhuma —</SelectItem>
                {AREAS_ATUACAO.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Interesse */}
          <Field label="Produto / Interesse">
            <Input
              value={interesse}
              onChange={(e) => setInteresse(e.target.value)}
              placeholder="Ex: Likawave Pro, consultoria, assinatura..."
            />
          </Field>

          <Button onClick={handleCreate} className="w-full mt-2" disabled={saving}>
            {saving ? "Salvando..." : "Criar Contato"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
