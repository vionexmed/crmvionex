import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface PageHeaderProps {
  icon: LucideIcon;
  kicker?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}

export function PageHeader({
  icon: Icon,
  kicker,
  title,
  description,
  actions,
  meta,
}: PageHeaderProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card" style={{background: 'linear-gradient(135deg, hsl(var(--card)) 70%, hsl(var(--accent)) 100%)'}}>
      {/* Accent edge */}
      <div
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 bg-primary"
      />

      <div className="relative flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background shadow-sm">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            {kicker && (
              <p className="text-label font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {kicker}
              </p>
            )}
            {/* A classe, não as utilidades soltas: assim o nível existe em UM
                lugar, e as telas sem casca (entrada, wizard, erro) usam o mesmo. */}
            <h1 className="vx-titulo-tela truncate">
              {title}
            </h1>
            {description && (
              <p className="vx-subtitulo-tela">
                {description}
              </p>
            )}
            {meta && <div className="mt-2">{meta}</div>}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
