import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // 20x36, e não 24x44.
      //
      // A escada do shadcn é calibrada para corpo de 16px. Numa tela de
      // preferências com cinco linhas de 13px, cinco interruptores de 44px de
      // largura na cor da marca eram o elemento mais pesado da página -- a
      // decoração ganhando do texto que ela deveria acompanhar.
      //
      // A cor FICA: ligado/desligado é estado, e estado é exatamente o que este
      // sistema reserva para a cor. O que muda é a dose.
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        // `--shadow-sm` e não `shadow-lg`: a pastilha de um interruptor de 20px
        // não projeta sombra de modal. E o fundo é o do CARTÃO -- branco sobre
        // a trilha -- porque `bg-background` no tema escuro devolvia uma
        // pastilha quase preta dentro de uma trilha clara.
        "pointer-events-none block h-4 w-4 rounded-full bg-card shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
