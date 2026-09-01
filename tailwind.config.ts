import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      /**
       * Os três degraus ABAIXO de `text-xs`, que o Tailwind não oferece.
       *
       * O projeto tinha 487 tamanhos arbitrários em px, e a leitura óbvia era
       * "a escala está quebrada". Medindo, o quadro é outro: `text-xs` (546
       * usos) e `text-sm` (379) seguem sendo os cavalos de batalha, e quase
       * todo arbitrário está no extremo PEQUENO -- 10px (262), 9px (107),
       * 11px (78), 8px (24). O Tailwind simplesmente não tem nome para eles,
       * porque assume corpo de 16px, e aqui o corpo é 13px.
       *
       * Por isso a escala é ADITIVA, não substitutiva: trocar o valor de
       * `text-xs` mexeria em 546 lugares de uma vez. Aqui nada muda de tamanho
       * -- os nomes só param de ser inventados.
       *
       * 8px foi absorvido em `micro`: um pixel a mais é imperceptível nas
       * iniciais de avatar, e 8px está abaixo do mínimo legível de qualquer
       * jeito. Uma medida a menos na régua.
       *
       * A entrelinha vem junto de propósito. Tamanho sem entrelinha declarada
       * herda a do contexto, e é daí que vem a sensação de texto "apertado" em
       * umas telas e "solto" em outras usando o mesmo tamanho.
       */
      /**
       * TRÊS degraus abaixo do corpo, não seis.
       *
       * Havia 9 / 10 / 11 / 12 / 13 / 14px em uso simultâneo -- seis tamanhos
       * num intervalo de cinco pixels. Isso não forma hierarquia: a diferença
       * entre 10 e 11px não é perceptível como "um é mais importante", só como
       * "algo está desalinhado". E o piso de 9px é menor que o mínimo legível
       * confortável.
       *
       *   label   11px   rótulo, meta, selo, contagem
       *   xs      12px   corpo secundário  (510 usos, o mais praticado)
       *   sm      14px   corpo             (260 usos)
       *
       * `micro`, `meta` e `corpo` continuam existindo como APELIDO dos três
       * acima, porque são 199 chamadas espalhadas -- reescrevê-las de uma vez
       * misturaria a mudança de escala com a de código. O teste proíbe uso
       * NOVO deles.
       */
      fontSize: {
        label: ["0.6875rem", { lineHeight: "1rem" }],     // 11px / 16
        xs: ["0.75rem", { lineHeight: "1.125rem" }],      // 12px / 18 — era 12/16
        // Apelidos, em vias de sair:
        micro: ["0.6875rem", { lineHeight: "1rem" }],     // = label
        meta: ["0.6875rem", { lineHeight: "1rem" }],      // = label
        corpo: ["0.875rem", { lineHeight: "1.25rem" }],   // = sm
      },
      fontFamily: {
        /*
         * UMA FAMÍLIA SÓ, e é o que a referência da lateral faz.
         *
         * Eram duas -- Nunito no corpo, Poppins nos títulos. A referência usa a
         * mesma em tudo, e misturar Jakarta com Poppins daria dois geométricos
         * discutindo: parecidos o bastante para não contrastar, diferentes o
         * bastante para incomodar.
         *
         * `heading` CONTINUA EXISTINDO como apelido. São 12 usos de
         * `font-heading` mais `.vx-titulo-*` no CSS, e apontar o apelido para a
         * mesma família troca tudo de uma vez sem reescrever chamada nenhuma --
         * e deixa o caminho aberto para voltar a ter uma display própria.
         */
        sans: ['Plus Jakarta Sans', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        heading: ['Plus Jakarta Sans', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))" },
        warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(var(--warning-foreground))" },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
