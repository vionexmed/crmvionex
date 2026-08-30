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
      fontSize: {
        micro: ["0.5625rem", { lineHeight: "0.75rem" }],  //  9px / 12
        label: ["0.625rem", { lineHeight: "0.875rem" }],  // 10px / 14
        meta: ["0.6875rem", { lineHeight: "0.9375rem" }], // 11px / 15
        // 13px é a base do `body`, e sete lugares a repetiam como valor
        // arbitrário. Nomeada, ela pode mudar em um lugar só.
        corpo: ["0.8125rem", { lineHeight: "1.125rem" }],  // 13px / 18
      },
      fontFamily: {
        sans: ['Nunito', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        heading: ['Poppins', 'sans-serif'],
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
