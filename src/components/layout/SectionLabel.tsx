import { cn } from "@/lib/utils";

/**
 * Rótulo de seção em versalete.
 *
 * O mesmo padrão aparecia ~25 vezes com **seis valores diferentes de
 * `tracking`** — `tracking-[0.14em]`, `tracking-widest`, `tracking-[0.12em]`,
 * `tracking-wider`, `tracking-wide`, `tracking-[0.10em]` — e em três tamanhos.
 * Ninguém escolheu isso; cada tela copiou de uma vizinha e ajustou no olho.
 */
export function SectionLabel({
  children,
  className,
  as: Tag = "p",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "p" | "span" | "h2" | "h3";
}) {
  return (
    <Tag
      className={cn(
        "text-label font-semibold uppercase tracking-[0.14em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
