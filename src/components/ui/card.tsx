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
      // O CABEÇALHO É UM PAR, NÃO DUAS LINHAS EMPILHADAS.
      //
      // Era `space-y-1.5` (6px) entre o título de 14px e o subtítulo de 11px,
      // e `pb-2` (8px) até o corpo -- ou seja, o vão DENTRO do par era quase o
      // mesmo que o vão que o separa do resto do cartão. Sem diferença de
      // proximidade não há par: são três blocos soltos à mesma distância.
      //
      // Agora 2px entre título e subtítulo (eles se leem como uma unidade) e
      // metade do respiro até o corpo, pela `.vx-cabeca-cartao`. O padding
      // continua saindo de `--respiro`, então a densidade escolhida em
      // Configurações continua mandando.
      className={cn("flex flex-col space-y-0.5 vx-cabeca-cartao", className)}
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
      // `leading-tight` e não `leading-none`: com entrelinha 1 um título que
      // quebra em duas linhas encosta uma na outra, e as descidas do "g" e do
      // "ç" batem na linha de baixo. Em português isso acontece o tempo todo.
      className={cn("text-sm font-semibold leading-tight tracking-tight", className)}
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
      // `leading-[1.5]`: o subtítulo é a única linha do cartão que costuma
      // quebrar, e 11px com entrelinha de 16px (o default do degrau `label`)
      // fica denso demais quando são duas ou três linhas de explicação.
      className={cn("text-label text-muted-foreground leading-[1.5]", className)}
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
      //   vx-respiro  cartão normal — este default, e ele MUDA com a densidade
      //               escolhida em Configurações (ver --respiro no index.css)
      //   p-3         cartão em espaço ESTREITO: grade de métricas com três a
      //               cinco colunas, gaveta, painel lateral. São 15 lugares,
      //               todos em contêiner apertado, e apertar ali é o certo.
      //
      // O que não existe é um terceiro valor por acidente.
      //
      // `.vx-corpo-cartao` é `0 var(--respiro) calc(var(--respiro) * .8)`: a
      // margem lateral continua inteira -- é ela que alinha cabeçalho, corpo e
      // rodapé numa coluna só -- e o pé fecha um pouco mais curto, porque não
      // há linha de texto embaixo empurrando o olho para fora.
      className={cn("vx-corpo-cartao", className)}
      {...props}
    />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center gap-2 vx-corpo-cartao", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
