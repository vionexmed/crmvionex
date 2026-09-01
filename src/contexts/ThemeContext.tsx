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

const ACCENT_COLORS: Record<string, { light: string; dark: string; ring: string }> = {
  // Vionex official teal
  teal: { light: "187 100% 27%", dark: "187 100% 35%", ring: "187 100% 27%" },
  blue: { light: "221 83% 53%", dark: "217 91% 60%", ring: "221 83% 53%" },
  violet: { light: "262 83% 58%", dark: "263 70% 50%", ring: "262 83% 58%" },
  emerald: { light: "160 84% 39%", dark: "160 84% 39%", ring: "160 84% 39%" },
  orange: { light: "25 95% 53%", dark: "25 95% 53%", ring: "25 95% 53%" },
  rose: { light: "347 77% 50%", dark: "347 77% 50%", ring: "347 77% 50%" },
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
    root.style.setProperty("--ring", palette.ring);
    root.style.setProperty("--sidebar-primary", val);
    root.style.setProperty("--sidebar-ring", palette.ring);
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
