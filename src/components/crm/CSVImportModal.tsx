import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Upload, Table2, Loader2 } from "lucide-react";
import { mensagemErro } from "@/lib/erro-supabase";
import { formatarData } from "@/lib/formato";
import { chaveDeNome, chaveDeTelefone } from "@/lib/contato-formato";
import { buscarEmBlocos } from "@/lib/paginar";
import { detectarSeparador, lerTexto, parseCSV } from "@/lib/csv";
import {
  CAMPOS_DE_CONTATO, CAMPOS_DE_EMPRESA, EMPRESA, NOTA, OPCOES_QUANDO_EXISTE,
  PREFIXO_META, type QuandoExiste,
  camposParaAtualizar, chaveDeEmpresa, mapearColunas, planejarEmpresas,
} from "@/lib/importar-colunas";
import type { Database } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";

interface CSVImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
  entityType: "contacts" | "companies";
}


/** O tipo GERADO da tabela, em vez de cast: o compilador cobra org_id, title e
 *  type, que são exatamente os três que um insert de atividade não pode
 *  esquecer. */
type NotaNova = Database["public"]["Tables"]["activities"]["Insert"];


/**
 * O que a planilha pode dizer no campo de estágio.
 *
 * Aceita os seis do ciclo de vida e os rótulos em português que a interface
 * mostra -- quem exporta do CRM e reimporta traz o rótulo, não o valor do
 * banco. E aceita os quatro valores da coluna LEGADA `status`, porque planilhas
 * antigas existem: eles entram pelo estágio equivalente mais conservador.
 */
const ESTAGIO_DA_PLANILHA: Record<string, string> = {
  lead: "lead",
  "novo lead": "lead",
  contacted: "contacted",
  contatado: "contacted",
  qualified: "qualified",
  qualificado: "qualified",
  opportunity: "opportunity",
  "em negociação": "opportunity",
  "em negociacao": "opportunity",
  customer: "customer",
  cliente: "customer",
  disqualified: "disqualified",
  descartado: "disqualified",
  // Legado: `prospect` cobria qualificado E em negociação. Entra pelo primeiro
  // dos dois -- afirmar "em negociação" a partir de um dado que não distingue
  // seria inventar.
  prospect: "qualified",
  churned: "disqualified",
};

/**
 * Uma célula de planilha, como texto.
 *
 * O leitor de xlsx devolve o TIPO da célula: número, data, booleano. O CSV
 * devolve tudo como texto, e o mapeamento adiante assume texto — converter aqui
 * mantém um formato só em vez de espalhar checagem de tipo.
 *
 * Data passa por `formatarData` e não por `toLocaleDateString`: o formato
 * inline estava em 18 arquivos com oito variações, e há teste proibindo que
 * volte.
 *
 * Número inteiro sem casas perde o `.0` que o leitor às vezes traz — telefone
 * digitado como número numa planilha vira "5511999998888", não
 * "5511999998888.0".
 */
function textoDaCelula(c: unknown): string {
  if (c instanceof Date) return formatarData(c);
  if (typeof c === "boolean") return c ? "Sim" : "Não";
  if (typeof c === "number") return Number.isInteger(c) ? String(c) : String(c);
  return String(c).trim();
}

/** E-mail comparado sem caixa e sem espaço em volta. */
function chaveEmail(v: string | null | undefined): string | null {
  const e = String(v ?? "").trim().toLowerCase();
  return e || null;
}


export function CSVImportModal({ open, onOpenChange, onImported, entityType }: CSVImportModalProps) {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"upload" | "mapping" | "preview">("upload");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const [lendo, setLendo] = useState(false);
  /** Nome do arquivo, como veio. Só para exibir. */
  const [arquivo, setArquivo] = useState("");
  /**
   * A ORIGEM que será gravada, EDITÁVEL.
   *
   * Nasce do nome do arquivo, que é o caso comum — mas planilha encaminhada
   * chega com nome que não descreve nada ("Pasta1.xlsx", "leads (3).xlsx"), e
   * quem importa sabe de onde veio. Sem poder trocar, a origem viraria lixo
   * exatamente nas listas de terceiros, que são as que mais precisam de rastro.
   */
  const [origem, setOrigem] = useState("");
  /**
   * O que fazer com quem já existe. Padrão "ignorar" para não mudar o
   * comportamento de quem já usava; "completar" é o que conserta um lote
   * importado com colunas faltando.
   */
  const [quandoExiste, setQuandoExiste] = useState<QuandoExiste>("ignorar");

  const fields = entityType === "contacts" ? CAMPOS_DE_CONTATO : CAMPOS_DE_EMPRESA;

  const aplicarPlanilha = (linhas: string[][], nomeArquivo: string) => {
    const naoVazias = linhas.filter((r) => r.some((c) => c && c.trim()));
    if (naoVazias.length < 2) {
      toast({ title: "A planilha está vazia ou só tem cabeçalho", variant: "destructive" });
      return;
    }

    const cabecalho = naoVazias[0];
    setCsvHeaders(cabecalho);
    setCsvRows(naoVazias.slice(1));
    setArquivo(nomeArquivo);
    // Sugestão, e só quando o campo está VAZIO: a pessoa pode ter digitado a
    // origem antes de escolher o arquivo, e sobrescrever perderia o que ela
    // acabou de escrever. Sem extensão, porque "Leads Congresso 2026" lê melhor
    // que o mesmo nome com ".xlsx" num selo de 11px.
    setOrigem((atual) => atual.trim() || nomeArquivo.replace(/\.[^.]+$/, "").trim());

    // Uma chamada. A resolução vive em `lib/importar-colunas`, testada com os
    // sete cabeçalhos reais que expuseram o defeito.
    const autoMap = mapearColunas(cabecalho, fields);
    setMapping(autoMap);
    setStep("mapping");
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Permite escolher o MESMO arquivo de novo depois de um erro: sem isto o
    // input não dispara change na segunda vez e a tela parece travada.
    e.target.value = "";

    const ehPlanilha = /\.xlsx?$/i.test(file.name);
    setLendo(true);
    try {
      if (ehPlanilha) {
        // Import dinâmico: a biblioteca de xlsx só é baixada por quem importa
        // planilha. Estática, ela entraria no pacote de TODA tela.
        // Duas armadilhas do pacote, as duas apontadas pelo compilador:
        //
        // 1. não há export raiz -- só subcaminhos por ambiente, então é
        //    "read-excel-file/browser" e não "read-excel-file";
        // 2. na v9 o export PADRÃO devolve a lista de ABAS, não as linhas.
        //    Quem devolve linhas é `readSheet`, que lê a primeira aba.
        const { readSheet } = await import("read-excel-file/browser");
        const linhas = await readSheet(file);
        // As células vêm tipadas (número, data, booleano). O mapeamento adiante
        // trabalha com texto, e converter aqui mantém um formato só.
        aplicarPlanilha(
          linhas.map((r) =>
            r.map((c) => (c === null || c === undefined ? "" : textoDaCelula(c)))),
          file.name,
        );
      } else {
        // `lerTexto` e não `file.text()`: o Excel em português salva em
        // Windows-1252, e `file.text()` assume UTF-8 -- "Observações" chegava
        // como "Observa??es".
        const texto = await lerTexto(file);
        aplicarPlanilha(parseCSV(texto, detectarSeparador(texto)), file.name);
      }
    } catch (err) {
      toast({
        title: "Não consegui ler o arquivo",
        description: mensagemErro(err),
        variant: "destructive",
      });
    } finally {
      setLendo(false);
    }
  };

  const handleImport = async () => {
    if (!orgId) return;
    setImporting(true);
    try {
      // O que a pessoa escreveu no campo de origem. Vazio cai no nome do
      // arquivo, e nome vazio cai em "Importação" -- nunca fica em branco,
      // senão o selo aparece sem texto.
      const origemFinal =
        origem.trim() || arquivo.replace(/\.[^.]+$/, "").trim() || "Importação";
      const importadoEm = new Date().toISOString();

      /**
       * As notas, na MESMA ordem de `records`.
       *
       * Índice paralelo em vez de campo dentro do registro: `records` vai
       * inteiro para o `insert`, e uma chave a mais que não é coluna faria o
       * PostgREST recusar a planilha completa.
       */
      const notasPorLinha: (string | null)[] = [];
      /** Nome da empresa por linha, na mesma ordem. */
      const empresaPorLinha: (string | null)[] = [];

      const records = csvRows.map((row) => {
        const record: Record<string, any> = { org_id: orgId, owner_id: user?.id };
        const perguntas: Record<string, string> = {};
        let nota: string | null = null;
        let empresa: string | null = null;

        Object.entries(mapping).forEach(([colIdx, fieldKey]) => {
          if (fieldKey === "__skip") return;
          const valor = row[Number(colIdx)] || null;
          if (fieldKey === EMPRESA) {
            empresa = valor?.trim() || null;
            return;
          }
          if (fieldKey === NOTA) {
            // Duas colunas mapeadas para nota entram na MESMA nota, separadas
            // por quebra. Criar duas atividades faria a ficha repetir carimbo
            // de data para o que é um só comentário.
            nota = nota ? `${nota}\n${valor ?? ""}`.trim() : valor;
            return;
          }
          if (fieldKey.startsWith(PREFIXO_META)) {
            // Resposta de formulário: vai para `metadata`, não para coluna.
            // Vazia é omitida — a ficha do contato só mostra o que tem valor, e
            // gravar string vazia faria aparecer um rótulo sem resposta.
            if (valor) perguntas[fieldKey.slice(PREFIXO_META.length)] = valor;
          } else {
            record[fieldKey] = valor;
          }
        });

        notasPorLinha.push(nota);
        empresaPorLinha.push(empresa);
        if (entityType === "contacts") {
          // Status vindo da PLANILHA continua valendo. O que saiu foi o
          // fallback.
          //
          // Ele forçava 'prospect' quando a planilha não trazia a coluna, e o
          // comentário antigo explicava o porquê: com 'lead', o importado sumia
          // da página Contatos. Era verdade -- a lista filtrava `.neq("status",
          // "lead")` -- mas a saída trocava um sumiço por outro: o trigger
          // deriva 'prospect' → lifecycle 'qualified', então o contato passava a
          // existir em Contatos e a NÃO existir no funil, marcado como
          // qualificado sem ninguém ter olhado para ele.
          //
          // A causa foi removida na origem: Contatos não esconde mais ninguém.
          // Sem status na planilha, vale o default da coluna: 'lead'.
          // Escreve `lifecycle_stage`, NUNCA `status`.
          //
          // No INSERT o gatilho dá a vitória ao `status`: gravar
          // `status = 'prospect'` faz o contato nascer com
          // `lifecycle_stage = 'qualified'` -- qualificado sem ninguém ter
          // olhado para ele. Gravando só o ciclo de vida, o gatilho vai pelo
          // outro ramo e deriva o `status` a partir dele.
          const bruto = String(record.lifecycle_stage || "").trim().toLowerCase();
          const estagio = ESTAGIO_DA_PLANILHA[bruto];
          if (estagio) record.lifecycle_stage = estagio;
          else delete record.lifecycle_stage;
          delete record.status;
          // A ORIGEM é o nome do documento. `getContactOrigin` não conhece
          // esse valor e cai no ramo final, que exibe o texto cru — então o
          // selo mostra o nome do arquivo sem precisar de caso novo.
          //
          // `importado_em` existe separado porque o filtro "Importação" da
          // página Contatos casava o texto `csv_import` de forma exata. Com o
          // nome do arquivo no lugar, esse casamento morreria e os importados
          // sumiriam do filtro; a marca de data é o que o mantém funcionando
          // seja qual for o nome do arquivo.
          record.metadata = {
            ...(record.metadata || {}),
            ...perguntas,
            source: origemFinal,
            importado_em: importadoEm,
          };
        }
        return record;
      });

      // Sem o campo obrigatório não há registro; linha em branco no fim da
      // planilha é o caso comum.
      const comNome = entityType === "contacts"
        ? records.filter((r) => r.first_name)
        : records.filter((r) => r.name);

      if (comNome.length === 0) {
        toast({ title: "Nenhum registro válido", variant: "destructive" });
        setImporting(false);
        return;
      }

      // ---------- empresas: procura ou cria, ANTES de inserir os contatos ----------
      //
      // Antes porque `company_id` é coluna do contato: resolver depois exigiria
      // um segundo UPDATE por linha, e uma falha no meio deixaria metade
      // vinculada.
      //
      // Casa por nome em MINÚSCULA: "Hospital Santa Casa" e "HOSPITAL SANTA
      // CASA" são a mesma instituição, e criar as duas encheria a tela de
      // Empresas de duplicata na primeira planilha.
      const temEmpresa = empresaPorLinha.some((n) => n?.trim());
      let empresaIdPorNome = new Map<string, string>();

      if (entityType === "contacts" && temEmpresa) {
        // Em blocos: o PostgREST corta em 1000 EM SILÊNCIO, e uma lista
        // truncada aqui faria a importação CRIAR empresa que já existe.
        const jaExistem = await buscarEmBlocos<{ id: string; name: string }>(
          (inicio, fim) =>
            supabase.from("companies").select("id, name").eq("org_id", orgId).range(inicio, fim),
        );
        // O PLANO vem de uma função pura, testada: quais criar e quais reusar.
        //
        // A versão anterior fazia `new Set` das grafias EXATAS, então
        // "Hospital X" e "hospital x" eram duas entradas e criavam DUAS
        // empresas para a mesma instituição.
        const plano = planejarEmpresas(empresaPorLinha, jaExistem);
        empresaIdPorNome = plano.porChave;

        if (plano.aCriar.length > 0) {
          const { data: criadas, error: erroEmp } = await supabase
            .from("companies")
            .insert(plano.aCriar.map((name) => ({ org_id: orgId, name })))
            .select("id, name");
          if (erroEmp) {
            toast({ title: "Erro ao criar as empresas", description: mensagemErro(erroEmp), variant: "destructive" });
            setImporting(false);
            return;
          }
          for (const e of criadas ?? []) {
            const nome = (e.name as string)?.trim();
            if (nome) empresaIdPorNome.set(chaveDeEmpresa(nome), e.id as string);
          }
        }

        // O vínculo, percorrendo `records` pelo ÍNDICE.
        //
        // `records.indexOf(r)` dentro de um laço seria busca por referência a
        // cada volta -- quadrático, e com 835 contatos são ~700 mil comparações
        // para resolver o que o índice paralelo já responde de graça.
        records.forEach((r, i) => {
          const nome = empresaPorLinha[i];
          const id = nome?.trim() ? empresaIdPorNome.get(chaveDeEmpresa(nome)) : undefined;
          if (id) r.company_id = id;
        });
      }

      // Quantas empresas os contatos importados de fato usam. `empresaIdPorNome`
      // contém a base inteira -- anunciar o tamanho dela diria "300 empresas
      // vinculadas" numa planilha de duas.
      const empresasVinculadas = new Set(
        comNome.map((r) => r.company_id as string | undefined).filter(Boolean),
      ).size;

      let valid = comNome;
      let repetidos = 0;
      let atualizados = 0;

      if (entityType === "contacts") {
        // A base JÁ cadastrada, para comparar. Paginada em blocos porque o
        // PostgREST corta em 1000 linhas EM SILÊNCIO -- e um teto silencioso
        // aqui seria pior que não deduplicar: a partir do contato 1001, a
        // comparação passaria a dizer "não existe" para gente que existe, e a
        // importação criaria duplicata parecendo ter conferido.
        // A lista de colunas é LITERAL, não montada por variável: os tipos
        // gerados do Supabase analisam a string do `select()` em tempo de
        // compilação, e uma string dinâmica não passa. A tentativa de trazer
        // menos colunas no modo "ignorar" custava isso e economizava pouco.
        const jaExistem = await buscarEmBlocos<Record<string, unknown>>(
          (inicio, fim) =>
            supabase.from("contacts")
              .select("id, email, phone, first_name, last_name, title, linkedin_url, company_id, metadata")
              .eq("org_id", orgId).range(inicio, fim),
        );

        // Mapa e não Set: para ATUALIZAR é preciso a linha existente, não só
        // saber que ela existe.
        const porEmail = new Map<string, Record<string, unknown>>();
        const porTelefone = new Map<string, Record<string, unknown>>();
        /** Só para quem não tem e-mail nem telefone. Ver `chaveDeNome`. */
        const porNomeSemContato = new Map<string, Record<string, unknown>>();
        for (const c of jaExistem) {
          const e = chaveEmail(c.email as string | null);
          const t = chaveDeTelefone(c.phone as string | null);
          if (e && !porEmail.has(e)) porEmail.set(e, c);
          if (t && !porTelefone.has(t)) porTelefone.set(t, c);
          if (!e && !t) {
            const n = chaveDeNome(`${c.first_name ?? ""} ${c.last_name ?? ""}`);
            if (n && !porNomeSemContato.has(n)) porNomeSemContato.set(n, c);
          }
        }

        // O mesmo conjunto cresce com o que a própria planilha vai inserindo:
        // sem isso, uma pessoa repetida DENTRO do arquivo entraria duas vezes --
        // e é o caso mais comum quando duas listas encaminhadas são coladas numa
        // aba só.
        /** Duplicados que vão receber UPDATE, quando o modo não é "ignorar". */
        const atualizacoes: { id: string; campos: Record<string, unknown> }[] = [];

        valid = comNome.filter((r) => {
          const e = chaveEmail(r.email as string | null);
          const t = chaveDeTelefone(r.phone as string | null);
          // Último recurso, e SÓ sem e-mail e sem telefone: nesse caso os dois
          // registros são indistinguíveis para o sistema e para quem lê a tela.
          // Com e-mail ou telefone presente, casar por nome descartaria homônimo
          // -- comum em lista médica.
          const n = !e && !t
            ? chaveDeNome(`${r.first_name ?? ""} ${r.last_name ?? ""}`)
            : null;

          const existente =
            (e ? porEmail.get(e) : undefined)
            ?? (t ? porTelefone.get(t) : undefined)
            ?? (n ? porNomeSemContato.get(n) : undefined);

          if (existente) {
            repetidos++;
            const campos = camposParaAtualizar(r, existente, quandoExiste);
            if (campos) atualizacoes.push({ id: existente.id as string, campos });
            return false;
          }

          // Registra as chaves DESTA linha, para uma repetida dentro do próprio
          // arquivo também ser pega.
          if (e) porEmail.set(e, r);
          if (t) porTelefone.set(t, r);
          if (n) porNomeSemContato.set(n, r);
          return true;
        });

        // ---------- os UPDATEs ----------
        //
        // Um por contato, e em série. `upsert` em lote exigiria a linha completa
        // e sobrescreveria campo que a planilha não traz -- exatamente o que
        // `camposParaAtualizar` existe para impedir.
        for (const a of atualizacoes) {
          const { error: erroUp } = await supabase
            .from("contacts").update(a.campos).eq("id", a.id);
          if (erroUp) {
            console.error("atualizar duplicado", a.id, erroUp);
            continue;   // um que falha não derruba os outros
          }
          atualizados++;
        }

        if (valid.length === 0) {
          toast({
            title: "Nada novo nesta planilha",
            description: `${repetidos} ${repetidos === 1 ? "contato já estava" : "contatos já estavam"} cadastrados.`,
          });
          setImporting(false);
          return;
        }
      }

      // `.select("id")` para poder amarrar as notas aos contatos criados. Sem
      // ele o insert não devolve nada e a nota não teria a quem pertencer.
      const { data: criados, error } = await supabase
        .from(entityType)
        .insert(valid as any)
        .select("id");
      if (error) { toast({ title: "Erro na importação", description: mensagemErro(error), variant: "destructive" }); setImporting(false); return; }

      // ---------- as observações, como notas na ficha ----------
      let notasGravadas = 0;
      if (entityType === "contacts" && criados?.length) {
        // `valid` foi filtrado a partir de `comNome`, que preserva a ordem de
        // `csvRows` -- então a i-ésima linha VÁLIDA corresponde ao i-ésimo id
        // devolvido. Amarrar por índice só funciona por causa dessa ordem, e é
        // por isso que o filtro de duplicados devolve array em vez de Set.
        const indiceValido = comNome
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => valid.includes(r))
          .map(({ i }) => i);

        const notas: NotaNova[] = criados
          .flatMap<NotaNova>((c, k) => {
            const texto = notasPorLinha[indiceValido[k]];
            if (!texto?.trim()) return [];
            return [{
              org_id: orgId,
              contact_id: (c as { id: string }).id,
              user_id: user?.id,
              type: "note",
              title: "Observação da importação",
              body: texto.trim().slice(0, 4000),
              // CONCLUÍDA, com a data de agora: nota é registro do que já
              // existe, não tarefa a fazer. Sem `completed_at` ela cairia na
              // lista de pendências de quem importou.
              completed_at: new Date().toISOString(),
            }];
          });

        if (notas.length) {
          const { error: erroNota } = await supabase.from("activities").insert(notas);
          if (erroNota) {
            // Não desfaz a importação: os contatos entraram, e perder a
            // observação é recuperável reimportando só ela. Avisar é o certo.
            console.error("notas da importação", erroNota);
            toast({
              title: "Contatos importados, observações não",
              description: mensagemErro(erroNota),
              variant: "destructive",
            });
          } else {
            notasGravadas = notas.length;
          }
        }
      }

      toast({
        title: `${valid.length} ${valid.length === 1 ? "registro importado" : "registros importados"}`,
        // Dizer quantos foram ignorados, e não só quantos entraram: sem essa
        // linha, importar 200 e ver "50 importados" parece falha do sistema.
        description: [
          atualizados > 0
            ? `${atualizados} ${atualizados === 1 ? "já existia e foi atualizado" : "já existiam e foram atualizados"}`
            : repetidos > 0
              ? `${repetidos} ${repetidos === 1 ? "já estava cadastrado e foi ignorado" : "já estavam cadastrados e foram ignorados"}`
              : null,
          notasGravadas > 0
            ? `${notasGravadas} ${notasGravadas === 1 ? "observação virou nota" : "observações viraram notas"}`
            : null,
          empresasVinculadas > 0
            ? `${empresasVinculadas} ${empresasVinculadas === 1 ? "empresa vinculada" : "empresas vinculadas"}`
            : null,
        ].filter(Boolean).join(" · ") || undefined,
      });
      onOpenChange(false);
      onImported();
      resetState();
    } finally {
      setImporting(false);
    }
  };

  const resetState = () => {
    setStep("upload");
    setCsvHeaders([]);
    setCsvRows([]);
    setMapping({});
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) resetState(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar CSV</DialogTitle>
          <DialogDescription>
            {step === "upload" && "Selecione uma planilha (.xlsx) ou um arquivo .csv"}
            {step === "mapping" && `Mapeie as colunas de ${arquivo || "a planilha"} para os campos`}
            {step === "preview" && `Preview: ${csvRows.length} registros`}
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              Planilha do Excel (.xlsx) ou arquivo .csv
            </p>
            {entityType === "contacts" && (
              /* A ORIGEM É PEDIDA AQUI, antes do arquivo.
                 Ela estava só no passo de mapeamento, e quem sabe de onde a
                 lista veio sabe disso ANTES de escolher o arquivo -- pedir
                 depois obriga a pessoa a lembrar no meio de outra tarefa. Fica
                 nos dois passos: aqui para escrever, lá para conferir.
                 Escolher o arquivo SUGERE o nome dele, mas só se este campo
                 ainda estiver vazio: sobrescrever o que a pessoa acabou de
                 digitar seria perder o trabalho dela. */
              <div className="w-full max-w-sm space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
                <Label htmlFor="origem-antes" className="text-xs font-semibold">
                  De onde vem esta lista?
                </Label>
                <Input
                  id="origem-antes"
                  value={origem}
                  onChange={(e) => setOrigem(e.target.value)}
                  placeholder="Ex.: APROXIMA MED"
                  maxLength={60}
                />
                <p className="text-label text-muted-foreground">
                  Vira o selo de <strong>Origem</strong> de cada contato, e serve para
                  filtrar depois. Em branco, usamos o nome do arquivo.
                </p>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFile}
              className="hidden"
            />
            <Button onClick={() => fileRef.current?.click()} disabled={lendo}>
              {lendo
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Table2 className="mr-2 h-4 w-4" />}
              {lendo ? "Lendo o arquivo…" : "Selecionar arquivo"}
            </Button>
          </div>
        )}

        {step === "mapping" && (
          <div className="space-y-4">
            {entityType === "contacts" && (
              <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
                <Label htmlFor="origem-import" className="text-xs font-semibold">
                  Origem destes contatos
                </Label>
                <Input
                  id="origem-import"
                  value={origem}
                  onChange={(e) => setOrigem(e.target.value)}
                  placeholder="Ex.: APROXIMA MED"
                  maxLength={60}
                />
                <p className="text-label text-muted-foreground">
                  Aparece no selo de <strong>Origem</strong> de cada contato, e serve para
                  você filtrar depois. Sugerimos o nome do arquivo — troque se a lista
                  vier de outro lugar.
                </p>

                {/* O QUE FAZER COM QUEM JÁ EXISTE.
                    Antes havia um comportamento só, silencioso: ignorar. E ele
                    tem um custo que só apareceu no uso real — importar com o
                    mapeamento errado, corrigir e reimportar NÃO conserta
                    ninguém. O aviso dizia "90 já estavam cadastrados e foram
                    ignorados", e os 90 seguiam sem telefone. */}
                <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                  <Label htmlFor="quando-existe" className="text-xs font-semibold">
                    Se o contato já existir
                  </Label>
                  <Select value={quandoExiste} onValueChange={(v) => setQuandoExiste(v as QuandoExiste)}>
                    <SelectTrigger id="quando-existe"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OPCOES_QUANDO_EXISTE.map((o) => (
                        <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-label text-muted-foreground">
                    {OPCOES_QUANDO_EXISTE.find((o) => o.valor === quandoExiste)?.ajuda}
                  </p>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {csvHeaders.map((header, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-40 truncate text-sm font-medium">{header}</span>
                  <span className="text-muted-foreground">→</span>
                  <Select value={mapping[i] || "__skip"} onValueChange={(v) => setMapping({ ...mapping, [i]: v })}>
                    <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {fields.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("upload")}>Voltar</Button>
              <Button onClick={() => setStep("preview")}>Preview</Button>
            </DialogFooter>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <div className="vx-table max-h-60">
              <Table>
                <TableHeader>
                  <TableRow>
                    {Object.entries(mapping).filter(([, v]) => v !== "__skip").map(([i, key]) => (
                      <TableHead key={i} className="text-xs">{fields.find((f) => f.key === key)?.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {csvRows.slice(0, 5).map((row, ri) => (
                    <TableRow key={ri}>
                      {Object.entries(mapping).filter(([, v]) => v !== "__skip").map(([i]) => (
                        <TableCell key={i} className="text-xs">{row[Number(i)]}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {csvRows.length > 5 && (
              <p className="text-xs text-muted-foreground text-center">... e mais {csvRows.length - 5} registros</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("mapping")}>Voltar</Button>
              <Button onClick={handleImport} disabled={importing}>
                {importing ? "Importando..." : `Importar ${csvRows.length} registros`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
