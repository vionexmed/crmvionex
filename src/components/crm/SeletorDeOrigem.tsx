import { useState } from "react";
import { Check, Pencil } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ORIGIN_OPTIONS } from "@/lib/contact-options";
import { useOrigensDeContato } from "@/hooks/queries/useOrigensDeContato";

const NENHUMA = "__none__";
const NOVA = "__nova__";

/**
 * De onde a pessoa veio, escolhida ou escrita.
 *
 * A lista tinha só os quatro grupos conhecidos, e a base tem muito mais: nome
 * de planilha importada, campanha, evento. Quem editava uma ficha ou cadastrava
 * à mão não tinha como reaproveitar uma origem que já existe -- e origem
 * digitada de formas diferentes ("Congresso 2026", "congresso 2026") vira duas
 * fatias no gráfico de canais e dois itens no filtro.
 *
 * Por isso a lista mostra o que a base JÁ USA, com a contagem ao lado: ela
 * responde "esta é a que eu quero?" antes do clique. Digitar continua possível,
 * e é o único jeito de a primeira ocorrência de uma origem nova existir.
 *
 * Serve a ficha do contato e o cadastro manual. Uma só para as duas: com uma
 * cópia em cada, a lista de uma cresce e a da outra não.
 */
export function SeletorDeOrigem({
  valor,
  aoMudar,
  permitirVazio = true,
}: {
  valor: string;
  aoMudar: (v: string) => void;
  /** O cadastro manual sempre grava alguma origem; a ficha aceita não ter. */
  permitirVazio?: boolean;
}) {
  const { data: origens } = useOrigensDeContato();
  const [digitando, setDigitando] = useState(false);

  const grupos = ORIGIN_OPTIONS.map((o) => o.value);
  /*
    As da base, sem repetir as quatro conhecidas.

    Sem isto, um contato com `source: "manual"` faria "Manual" aparecer duas
    vezes -- uma como grupo e outra como valor real --, e as duas gravariam
    exatamente a mesma coisa.
  */
  const daBase = (origens ?? []).filter((o) => o.origem && !grupos.includes(o.origem));

  /* A origem atual pode não estar em lista nenhuma: a consulta pode ter
     falhado, ou o valor pode ter acabado de ser digitado. Ela entra como opção
     para abrir e salvar a ficha não apagar de onde a pessoa veio. */
  const soltaNaLista =
    valor && !grupos.includes(valor) && !daBase.some((o) => o.origem === valor);

  if (digitando) {
    return (
      <div className="flex gap-2">
        <Input
          autoFocus
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          placeholder="Ex: Congresso 2026, indicação do Dr. Silva…"
          aria-label="Nova origem"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10 shrink-0"
          onClick={() => setDigitando(false)}
          aria-label="Concluir e voltar à lista"
        >
          <Check className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={valor || NENHUMA}
      onValueChange={(v) => {
        if (v === NOVA) {
          // Começa em branco: aproveitar o valor anterior faria a pessoa apagar
          // antes de escrever.
          aoMudar("");
          setDigitando(true);
          return;
        }
        aoMudar(v === NENHUMA ? "" : v);
      }}
    >
      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
      <SelectContent>
        {permitirVazio && <SelectItem value={NENHUMA}>— Não informada —</SelectItem>}

        {ORIGIN_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}

        {soltaNaLista && <SelectItem value={valor}>{valor}</SelectItem>}

        {daBase.length > 0 && (
          <>
            <div className="my-1 border-t border-border" role="presentation" />
            {/* A contagem responde "é esta mesmo?" antes do clique -- e denuncia
                a origem escrita de dois jeitos, que aparece como duas linhas de
                contagem baixa. */}
            {daBase.map((o) => (
              <SelectItem key={o.origem} value={o.origem}>
                {o.origem} ({o.contatos})
              </SelectItem>
            ))}
          </>
        )}

        <div className="my-1 border-t border-border" role="presentation" />
        <SelectItem value={NOVA}>
          <span className="flex items-center gap-1.5">
            <Pencil className="h-3 w-3" />Digitar uma nova…
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
