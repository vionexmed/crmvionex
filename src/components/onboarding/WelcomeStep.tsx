import { Handshake, Zap, Bot, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OnboardingStepProps } from "./types";

const features = [
  { icon: Zap, label: "Funil visual", desc: "Kanban arrastável" },
  { icon: Bot, label: "AI Copilot", desc: "Powered by Claude" },
  { icon: Link2, label: "Integrações", desc: "WhatsApp, email e mais" },
];

export function WelcomeStep({ userName, onNext }: OnboardingStepProps) {
  const firstName = userName?.split(" ")[0] || "usuário";

  return (
    <div className="text-center space-y-8 py-6">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
        <Handshake className="h-7 w-7 text-primary-foreground" />
      </div>

      <div className="space-y-2">
        <h2 className="vx-titulo-tela">
          Bem-vindo ao VIONEX, {firstName}! 👋
        </h2>
        <p className="vx-subtitulo-tela max-w-md mx-auto">
          Vamos configurar tudo em menos de 5 minutos.
          Você pode pular qualquer integração agora e configurar depois em Configurações.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto">
        {features.map((f) => (
          <div key={f.label} className="flex flex-col items-center gap-2 rounded-xl border border-border bg-muted/50 p-4">
            <f.icon className="h-6 w-6 text-primary" />
            <span className="text-sm font-medium">{f.label}</span>
            <span className="text-xs text-muted-foreground">{f.desc}</span>
          </div>
        ))}
      </div>

      <Button size="lg" onClick={onNext} className="px-8">
        Vamos começar →
      </Button>
    </div>
  );
}
