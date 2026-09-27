import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "light" | "dark" | "system";
type Density = "compact" | "normal" | "comfortable";

interface ThemeContextType {
  theme: Theme;
  setTheme: (t: Theme) => void;
  density: Density;
  setDensity: (d: Density) => void;
  accentColor: string;
  setAccentColor: (c: string) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "system",
  setTheme: () => {},
  density: "normal",
  setDensity: () => {},
  accentColor: "blue",
  setAccentColor: () => {},
});

export const useTheme = () => useContext(ThemeContext);

/**
 * AS SEIS CORES DE DESTAQUE, CADA UMA COM UM PAR CLARO/ESCURO.
 *
 * O par não é decoração: uma cor que se lê sobre branco é escura e saturada, e
 * essa mesma cor sobre um fundo de 9% de claridade vira um borrão. No escuro
 * ela precisa SUBIR de claridade e DESCER de saturação -- subir para se
 * destacar do fundo, descer para não acender como néon.
 *
 * Quatro das seis (`emerald`, `orange`, `rose`, e o `teal` antigo) usavam o
 * MESMO valor nos dois temas, ou um valor mais saturado ainda no escuro. Era o
 * que deixava o tema escuro com cara de fluorescente. Agora as seis seguem a
 * regra.
 *
 * Estes valores são escritos na RAIZ em tempo de execução, por cima de
 * `--primary` / `--ring` / `--sidebar-primary`. Por isso nenhum lugar do CSS
 * pode cravar o teal: quem escolher roxo tem de ver roxo em tudo.
 */
const ACCENT_COLORS: Record<string, { light: string; dark: string }> = {
  // O teal do logo Vionex — o padrão, e a identidade da marca.
  teal: { light: "188 88% 26%", dark: "187 62% 48%" },
  blue: { light: "221 76% 46%", dark: "215 80% 62%" },
  violet: { light: "262 83% 58%", dark: "258 72% 68%" },
  emerald: { light: "160 78% 28%", dark: "158 56% 48%" },
  orange: { light: "24 82% 40%", dark: "28 82% 58%" },
  rose: { light: "347 72% 43%", dark: "348 70% 62%" },
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem("fc-theme") as Theme) || "light");
  const [density, setDensityState] = useState<Density>(() => (localStorage.getItem("fc-density") as Density) || "normal");
  const [accentColor, setAccentState] = useState(() => localStorage.getItem("fc-accent") || "teal");

  const applyTheme = (t: Theme) => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (t === "system") {
      const sys = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      root.classList.add(sys);
    } else {
      root.classList.add(t);
    }
  };

  /**
   * A DENSIDADE ERA UM CONTROLE MORTO.
   *
   * `density` era guardada no localStorage e desenhada em Configurações →
   * Aparência com três opções — e NADA no CSS lia o valor. Não existia
   * `data-density` em lugar nenhum: escolher "compacto" ou "confortável" não
   * mudava um pixel, e o único jeito de descobrir era medir.
   *
   * Agora ela é o eixo do respiro: o CSS lê `data-density` na raiz e ajusta os
   * tokens de espaçamento. É o que permite arejar o produto sem tirar de quem
   * prefere a densidade antiga.
   */
  const applyDensity = (d: Density) => {
    document.documentElement.dataset.density = d;
  };

  const applyAccent = (color: string) => {
    const root = document.documentElement;
    const isDark = root.classList.contains("dark");
    const palette = ACCENT_COLORS[color] || ACCENT_COLORS.teal;
    const val = isDark ? palette.dark : palette.light;
    root.style.setProperty("--primary", val);
    /*
     * O ANEL DE FOCO SEGUE O TEMA, não só a cor escolhida.
     *
     * Havia um terceiro valor, `ring`, que era sempre o da variante CLARA --
     * então no tema escuro o anel de foco saía numa cor escura sobre fundo
     * escuro, praticamente invisível. Era um problema de acessibilidade, e
     * silencioso: ninguém navega por teclado ao revisar.
     *
     * O anel é a mesma cor do acento. Não havia motivo para ser outra.
     */
    root.style.setProperty("--ring", val);
    root.style.setProperty("--sidebar-primary", val);
    root.style.setProperty("--sidebar-ring", val);
  };

  useEffect(() => {
    applyTheme(theme);
    applyAccent(accentColor);
  }, [theme, accentColor]);

  useEffect(() => { applyDensity(density); }, [density]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => { if (theme === "system") { applyTheme("system"); applyAccent(accentColor); } };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, accentColor]);

  const setTheme = (t: Theme) => { setThemeState(t); localStorage.setItem("fc-theme", t); };
  const setDensity = (d: Density) => { setDensityState(d); localStorage.setItem("fc-density", d); };
  const setAccentColor = (c: string) => { setAccentState(c); localStorage.setItem("fc-accent", c); };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, density, setDensity, accentColor, setAccentColor }}>
      {children}
    </ThemeContext.Provider>
  );
}
