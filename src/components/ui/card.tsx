import * as React from "react";

import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    // Sombra em vez de borda -- não as duas.
    //
    // O primitivo do shadcn vinha com `border` E `shadow-sm`: dois sinais para
    // a mesma coisa, "isto é um plano separado". Cheguei a tirar a sombra e
    // ficar só com a linha; no estilo escolhido é o contrário -- o cartão se
    // levanta do fundo cinza, e a borda vira redundante.
    //
    // A sombra é em duas camadas: uma curta e opaca que ancora o cartão na
    // superfície, e uma longa e difusa que dá a altura. Uma sombra só, sem a
    // curta, faz o cartão parecer flutuar sem apoio.
    //
    // O raio vem da escala derivada do token, porque havia `rounded-md` (115
    // usos) e `rounded-lg` (92) competindo na mesma tela.
    className={cn("vx-elevado rounded-lg bg-card text-card-foreground", className)}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      // `p-6` (24px) era o default e NINGUÉM o queria: 42 dos 86 cabeçalhos
      // sobrescreviam, e nenhum sobrescrevia PARA p-6. A base tipográfica aqui
      // é 13px, não os 16px que o Tailwind assume, então 24px de respiro é
      // proporcionalmente exagerado.
      //
      // `pb-2` porque é o que 27 dos 42 já escreviam: o subtítulo fica colado
      // no título, e o vão maior vem do conteúdo abaixo.
      className={cn("flex flex-col space-y-1.5 p-4 pb-2", className)}
      {...props}
    />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      // `text-2xl` era o default e NUNCA era o que se queria: 81 dos 86 usos
      // sobrescreviam, 66 deles para `text-sm`. O default agora é o caso comum
      // -- título de seção dentro de um cartão -- e quem quer maior declara.
      className={cn("text-sm font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      // 11px, um degrau abaixo do título de 14. Os call sites usavam 10px em 26
      // lugares e 11px em 6; 10px ao lado de um título de 14 abre um vão de
      // quatro degraus e o texto some. Onze ainda é claramente secundário e se
      // lê.
      className={cn("text-meta text-muted-foreground", className)}
      {...props}
    />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      // Dois valores de respiro, e os dois são deliberados:
      //
      //   p-4  cartão normal — este default
      //   p-3  cartão em espaço ESTREITO: grade de métricas com três a cinco
      //        colunas, gaveta, painel lateral. São 15 lugares, todos em
      //        contêiner apertado, e apertar ali é o certo.
      //
      // O que não existe mais é o terceiro valor por acidente.
      className={cn("p-4 pt-0", className)}
      {...props}
    />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-4 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
