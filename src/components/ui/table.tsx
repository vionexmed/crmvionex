import * as React from "react";

import { cn } from "@/lib/utils";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />,
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props} />
  ),
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      // O realce de linha é NEUTRO. Selecionada é um degrau mais firme que
      // sob o cursor -- os dois estados existem ao mesmo tempo numa seleção em
      // lote, e precisam continuar distinguíveis.
      className={cn(
        "border-b border-border/70 transition-colors data-[state=selected]:bg-muted hover:bg-muted/55",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        // `h-12` (48px) era o default do shadcn, calibrado para base 16px. Aqui
        // a base é 13px e o cabeçalho fica desproporcional -- quase o dobro da
        // altura da linha de dado. `.vx-table` já define padding próprio para
        // as 18 tabelas do projeto; esta altura é o piso para quem não usa.
        // Caixa alta em 11px com tracking aberto: é o rótulo de instrumento
        // que `.vx-table thead th` já aplica, trazido para o primitivo para
        // que as tabelas fora da classe não fiquem com outro cabeçalho.
        "h-9 px-3 text-left align-middle text-label font-semibold uppercase tracking-[0.08em] text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    // `p-4` (16px em todos os lados) era o default do shadcn, calibrado para
    // corpo de 16px. Aqui a base é 13px: dezesseis pixels acima e abaixo de uma
    // linha de 18px de altura davam 50px por linha, e uma lista de contatos
    // cabia em nove registros na tela. `.vx-table` já ajusta as 18 tabelas do
    // projeto; este é o piso para quem não usa a classe.
    <td ref={ref} className={cn("px-3 py-2.5 align-middle [&:has([role=checkbox])]:pr-0", className)} {...props} />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
