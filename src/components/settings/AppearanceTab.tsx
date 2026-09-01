import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Moon, Sun, Monitor, Palette } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

export function AppearanceTab() {
  const { theme, setTheme, density, setDensity, accentColor, setAccentColor } = useTheme();

  const themes = [
    { value: "light" as const, label: "Claro", icon: Sun },
    { value: "dark" as const, label: "Escuro", icon: Moon },
    { value: "system" as const, label: "Sistema", icon: Monitor },
  ];

  const accents = [
    // Teal primeiro, e é correção: a cor OFICIAL da marca e o padrão do
    // ThemeContext estava ausente desta lista. Quem trocasse para outra cor não
    // tinha como voltar pela interface -- só limpando o armazenamento do
    // navegador.
    { value: "teal", label: "Teal", color: "hsl(187, 100%, 27%)" },
    { value: "blue", label: "Azul", color: "hsl(221, 83%, 53%)" },
    { value: "violet", label: "Violeta", color: "hsl(262, 83%, 58%)" },
    { value: "emerald", label: "Esmeralda", color: "hsl(160, 84%, 39%)" },
    { value: "orange", label: "Laranja", color: "hsl(25, 95%, 53%)" },
    { value: "rose", label: "Rosa", color: "hsl(347, 77%, 50%)" },
  ];

  const densities = [
    { value: "compact" as const, label: "Compacta", desc: "Menos espaçamento, mais dados visíveis" },
    { value: "normal" as const, label: "Normal", desc: "Espaçamento padrão" },
    { value: "comfortable" as const, label: "Confortável", desc: "Mais espaçamento, leitura facilitada" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><Palette className="h-4 w-4" />Tema</CardTitle>
          <CardDescription>Escolha entre modo claro, escuro ou automático</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            {themes.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.value} onClick={() => setTheme(t.value)}
                  className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${theme === t.value ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50"}`}>
                  <Icon className="h-5 w-5" />
                  <span className="text-xs font-medium">{t.label}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cor de Destaque</CardTitle>
          <CardDescription>Cor primária da interface</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {accents.map((a) => (
              <button key={a.value} onClick={() => setAccentColor(a.value)}
                className={`flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 transition-colors ${accentColor === a.value ? "border-primary" : "border-border hover:bg-accent/50"}`}>
                <div className="h-6 w-6 rounded-full" style={{ backgroundColor: a.color }} />
                <span className="text-label">{a.label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Densidade da Tabela</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            {densities.map((d) => (
              <button key={d.value} onClick={() => setDensity(d.value)}
                className={`text-left rounded-lg border-2 p-3 transition-colors ${density === d.value ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50"}`}>
                <p className="text-xs font-medium">{d.label}</p>
                <p className="text-label text-muted-foreground mt-0.5">{d.desc}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
