import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { nomeDoContato } from "@/lib/contato-formato";

/** O mínimo que o seletor precisa. Serve tanto para o tipo do banco quanto para
 *  o resumo que `listForPicker` devolve. */
export type ContatoSelecionavel = {
  id: string;
  first_name: string;
  last_name?: string | null;
  email?: string | null;
};

/*
  O NOME VEM DE `contato-formato.ts`, e não de uma função daqui.

  Eu havia escrito `${first_name} ${last_name}` neste arquivo -- que é a mesma
  concatenação, sem o que aquele módulo faz: ele normaliza a caixa, então
  "CLAUDIA MOSCHEN" chega como "Claudia Moschen", respeita partículas ("de",
  "da") e devolve "Sem nome" quando não há nome. Duas versões da mesma regra é
  como a base ganha um seletor que escreve o nome diferente da lista.
*/
/**
 * ESCOLHER UMA PESSOA NUMA LISTA QUE NÃO CABE NA TELA.
 *
 * Era um `<Select>` puro: a lista inteira de contatos, em ordem de cadastro,
 * sem busca. Com algumas dezenas de contatos isso já obriga a rolar procurando
 * um nome; com centenas, a única saída é rolar até achar -- e é o mesmo gesto
 * repetido em quatro telas diferentes.
 *
 * Um componente e não quatro comboboxes: as quatro chamadas diferem só no
 * rótulo, no sufixo e em permitir "Nenhum". Escrever o combobox quatro vezes
 * convidaria as quatro a divergirem no próximo ajuste -- foi exatamente o que
 * aconteceu com o `<Select>` que havia antes, que já tinha três aparências.
 *
 * A BUSCA CASA COM NOME E E-MAIL, e é de propósito: quem procura uma pessoa
 * costuma lembrar de um dos dois, e num CRM o e-mail é frequentemente o que
 * distingue dois homônimos.
 */
export function SeletorDeContato({
  contatos,
  valor,
  aoMudar,
  /** Mostra a opção "Nenhum" no topo. O valor dela é `"none"`. */
  permitirNenhum = false,
  rotuloNenhum = "Nenhum",
  placeholder = "Selecionar…",
  /** Texto extra à direita de cada nome — pontuação, e-mail, o que servir. */
  sufixoDe,
  disabled,
  className,
}: {
  contatos: ContatoSelecionavel[];
  valor: string;
  aoMudar: (valor: string) => void;
  permitirNenhum?: boolean;
  rotuloNenhum?: string;
  placeholder?: string;
  sufixoDe?: (c: ContatoSelecionavel) => string | null;
  disabled?: boolean;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);

  const selecionado = useMemo(
    () => contatos.find((c) => c.id === valor) ?? null,
    [contatos, valor],
  );

  const escolher = (id: string) => {
    aoMudar(id);
    setAberto(false);
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={aberto}
          disabled={disabled}
          // `font-normal` e `justify-between` para ficar igual ao `SelectTrigger`
          // que este componente substituiu -- as duas telas que ainda usam um e
          // outro não podem parecer controles diferentes.
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className={cn("truncate", !selecionado && valor !== "none" && "text-muted-foreground")}>
            {selecionado
              ? nomeDoContato(selecionado.first_name, selecionado.last_name)
              : valor === "none" && permitirNenhum
                ? rotuloNenhum
                : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      {/* A largura acompanha o gatilho: um popover mais estreito que o campo
          corta nome longo, e um mais largo desalinha da coluna do formulário. */}
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Buscar por nome ou e-mail…" className="h-9 text-xs" />
          <CommandList>
            <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">
              Nenhum contato encontrado.
            </CommandEmpty>
            <CommandGroup>
              {permitirNenhum && (
                <CommandItem value={rotuloNenhum} onSelect={() => escolher("none")} className="text-xs">
                  <Check className={cn("mr-2 h-3.5 w-3.5", valor === "none" ? "opacity-100" : "opacity-0")} />
                  {rotuloNenhum}
                </CommandItem>
              )}

              {contatos.map((c) => {
                const nome = nomeDoContato(c.first_name, c.last_name);
                const sufixo = sufixoDe?.(c) ?? null;
                return (
                  <CommandItem
                    key={c.id}
                    /*
                      O `value` do cmdk é ao mesmo tempo o texto que a busca
                      compara E a identidade do item. Por isso ele carrega nome,
                      e-mail e o id: sem o e-mail a busca não acha por endereço,
                      e sem o id dois homônimos viram o mesmo item -- escolher um
                      selecionaria o outro.
                    */
                    value={`${nome} ${c.email || ""} ${c.id}`}
                    onSelect={() => escolher(c.id)}
                    className="text-xs"
                  >
                    <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", valor === c.id ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">{nome}</span>
                    {sufixo && (
                      <span className="ml-2 shrink-0 text-label text-muted-foreground">{sufixo}</span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
