import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // A TRILHA CINZA SAIU, E COM ELA O CONTROLE SEGMENTADO DE 1100px.
      //
      // As abas de página ocupam a largura toda dividida em partes iguais (é o
      // `PageTabs` quem decide isso, e com razão: dá alvos grandes no celular).
      // Dentro de uma trilha rebaixada com fio em volta, porém, "largura toda"
      // vira uma barra cinza atravessando a tela com uma pastilha branca de um
      // lado -- o desenho de um seletor de duas opções, não de uma navegação.
      // Em Configurações essa barra era o objeto mais pesado da página.
      //
      // Sem trilha, o que resta é o que a aba de fato é: uma fileira de rótulos
      // com um sublinhado sob o que está aberto. Menos tinta, mesma informação.
      "inline-flex items-center justify-center bg-transparent text-muted-foreground",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // O SUBLINHADO É NEUTRO, e isso é a mesma decisão da pastilha do item
      // ativo da lateral: "você está aqui" é ORIENTAÇÃO, não ação. A cor de
      // destaque fica reservada para o que se decide -- o botão primário, a
      // série de um gráfico, um estado que mudou.
      //
      // O fio de 2px existe em TODA aba, transparente nas fechadas: sem isso a
      // aba aberta ficaria 2px mais alta que as outras e a fileira dançaria a
      // cada troca.
      //
      // `rounded-none` porque o canto arredondado era da pastilha que saiu;
      // num rótulo sublinhado ele não descreve nada.
      // `justify-self-center` é o que faz o sublinhado ABRAÇAR O RÓTULO.
      //
      // As abas de página vivem numa grade de colunas iguais, e a aba estica
      // para preencher a coluna: num cabeçalho de duas abas isso dava um traço
      // preto de 570px, que não marca um rótulo -- pinta metade da tela. Como
      // item de grade, a aba passa a medir o próprio conteúdo e a se centrar na
      // coluna; o sublinhado mede a palavra.
      //
      // A propriedade é inerte fora de uma grade, então as barras de aba que
      // não usam colunas iguais (gaveta, painel lateral) não mudam.
      // `min-w-0 max-w-full` acompanha, e não é detalhe: sem o teto, uma aba
      // cujo rótulo é mais largo que a coluna (quatro canais numa lista de
      // 330px) mede o conteúdo e VAZA para fora do painel, em vez de cortar o
      // texto com reticências como fazia quando esticava.
      "inline-flex min-w-0 max-w-full items-center justify-center justify-self-center whitespace-nowrap rounded-none border-b-2 border-transparent px-4 py-1.5 text-xs font-medium ring-offset-background transition-colors hover:text-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
