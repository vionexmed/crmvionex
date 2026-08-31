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
import { CADASTRO_FIELDS } from "@/lib/contact-options";
import { mensagemErro } from "@/lib/erro-supabase";
import { formatarData } from "@/lib/formato";
import { buscarEmBlocos } from "@/lib/paginar";
import type { Database } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";

interface CSVImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
  entityType: "contacts" | "companies";
}

/**
 * Prefixo das perguntas do formulário.
 *
 * Elas NÃO são colunas de `contacts` — vivem em `metadata`, que é jsonb. Sem o
 * prefixo, mapear "Cidade / Estado" tentaria gravar uma coluna `cidade` que não
 * existe, e o insert falharia com a planilha inteira dentro dele.
 */
const PREFIXO_META = "meta:";

/** Destino especial: a coluna vira uma atividade do tipo `note`. */
const NOTA = "__nota";

/** O tipo GERADO da tabela, em vez de cast: o compilador cobra org_id, title e
 *  type, que são exatamente os três que um insert de atividade não pode
 *  esquecer. */
type NotaNova = Database["public"]["Tables"]["activities"]["Insert"];

const contactFields = [
  { key: "first_name", label: "Nome" },
  { key: "last_name", label: "Sobrenome" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Telefone" },
  { key: "title", label: "Cargo" },
  { key: "lifecycle_stage", label: "Ciclo de vida" },
  { key: "linkedin_url", label: "LinkedIn" },
  // As mesmas perguntas que a ficha do contato exibe. Vinham só de formulário
  // de captação; agora uma planilha também as preenche, e a ficha não sabe a
  // diferença — é o mesmo `metadata`.
  ...CADASTRO_FIELDS.map((f) => ({ key: `${PREFIXO_META}${f.key}`, label: f.label })),
  /**
   * Observação livre vira NOTA na ficha, não campo.
   *
   * Coluna de "obs" traz texto de tamanho imprevisível e sem estrutura --
   * gravá-la em `metadata` a esconderia atrás de um rótulo fixo, e em `title`
   * (Especialidade) a colocaria no lugar errado. Nota é o que a ficha já sabe
   * exibir em ordem cronológica.
   *
   * É seguro para o funil: `tg_atividade_contatou` só promove lead para
   * contatado em `type IN ('call','email','meeting')` -- nota fica fora, então
   * importar observação NÃO faz a base inteira parecer já abordada.
   */
  { key: NOTA, label: "Observação (vira nota na ficha)" },
  { key: "__skip", label: "— Ignorar —" },
];

/**
 * Parser CSV correto: respeita campos entre aspas (com vírgulas e quebras
 * de linha embutidas), aspas escapadas ("") e arquivos CRLF do Excel.
 * O split ingênuo por \n e , corrompia arquivos reais.
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim()));
}

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

/**
 * A chave de comparação de um telefone: os ÚLTIMOS 8 DÍGITOS.
 *
 * O mesmo número aparece com e sem o 9, com e sem +55, com e sem parênteses --
 * "(11) 99999-8888", "+5511999998888" e "11 9999-8888" são a mesma pessoa. Oito
 * dígitos é o que sobra estável em todas as formas, e é o mesmo critério que o
 * webhook do WhatsApp já usa para casar contato.
 */
function chaveTelefone(v: string | null | undefined): string | null {
  const so = String(v ?? "").replace(/\D/g, "");
  return so.length >= 8 ? so.slice(-8) : null;
}

/** E-mail comparado sem caixa e sem espaço em volta. */
function chaveEmail(v: string | null | undefined): string | null {
  const e = String(v ?? "").trim().toLowerCase();
  return e || null;
}

const companyFields = [
  { key: "name", label: "Nome" },
  { key: "domain", label: "Domínio" },
  { key: "industry", label: "Indústria" },
  { key: "size", label: "Tamanho" },
  { key: "revenue", label: "Receita" },
  { key: "website", label: "Website" },
  { key: "linkedin_url", label: "LinkedIn" },
  { key: "__skip", label: "— Ignorar —" },
];

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

  const fields = entityType === "contacts" ? contactFields : companyFields;

  /**
   * Compara cabeçalho de planilha com rótulo de campo.
   *
   * Sem tirar acento e pontuação, "Cidade / Estado" não casa com "cidade /
   * estado" exportado de outro sistema, e o mapeamento automático erra
   * justamente nas perguntas cujos rótulos são mais longos.
   */
  const normalizar = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

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

    const autoMap: Record<number, string> = {};
    cabecalho.forEach((header, i) => {
      const lower = header.toLowerCase();
      const norm = normalizar(header);
      const match = fields.find((f) =>
        f.key !== "__skip" && (
          normalizar(f.label) === norm ||
          f.key === lower ||
          f.key === `${PREFIXO_META}${norm.replace(/ /g, "_")}` ||
          (f.key === "first_name" && (lower.includes("nome") || lower.includes("first"))) ||
          (f.key === "last_name" && (lower.includes("sobrenome") || lower.includes("last"))) ||
          (f.key === "email" && lower.includes("email")) ||
          (f.key === "phone" && (lower.includes("telefone") || lower.includes("phone"))) ||
          (f.key === "name" && lower.includes("empresa"))
        )
      );
      autoMap[i] = match?.key || "__skip";
    });
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
        const texto = await file.text();
        aplicarPlanilha(parseCSV(texto), file.name);
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

      const records = csvRows.map((row) => {
        const record: Record<string, any> = { org_id: orgId, owner_id: user?.id };
        const perguntas: Record<string, string> = {};
        let nota: string | null = null;

        Object.entries(mapping).forEach(([colIdx, fieldKey]) => {
          if (fieldKey === "__skip") return;
          const valor = row[Number(colIdx)] || null;
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

      let valid = comNome;
      let repetidos = 0;

      if (entityType === "contacts") {
        // A base JÁ cadastrada, para comparar. Paginada em blocos porque o
        // PostgREST corta em 1000 linhas EM SILÊNCIO -- e um teto silencioso
        // aqui seria pior que não deduplicar: a partir do contato 1001, a
        // comparação passaria a dizer "não existe" para gente que existe, e a
        // importação criaria duplicata parecendo ter conferido.
        const jaExistem = await buscarEmBlocos<{ email: string | null; phone: string | null }>(
          (inicio, fim) =>
            supabase.from("contacts").select("email, phone").eq("org_id", orgId).range(inicio, fim),
        );

        const emails = new Set<string>();
        const telefones = new Set<string>();
        for (const c of jaExistem) {
          const e = chaveEmail(c.email);
          if (e) emails.add(e);
          const t = chaveTelefone(c.phone);
          if (t) telefones.add(t);
        }

        // O mesmo conjunto cresce com o que a própria planilha vai inserindo:
        // sem isso, uma pessoa repetida DENTRO do arquivo entraria duas vezes --
        // e é o caso mais comum quando duas listas encaminhadas são coladas numa
        // aba só.
        valid = comNome.filter((r) => {
          const e = chaveEmail(r.email as string | null);
          const t = chaveTelefone(r.phone as string | null);
          if ((e && emails.has(e)) || (t && telefones.has(t))) {
            repetidos++;
            return false;
          }
          if (e) emails.add(e);
          if (t) telefones.add(t);
          return true;
        });

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
          repetidos > 0
            ? `${repetidos} ${repetidos === 1 ? "já estava cadastrado e foi ignorado" : "já estavam cadastrados e foram ignorados"}`
            : null,
          notasGravadas > 0
            ? `${notasGravadas} ${notasGravadas === 1 ? "observação virou nota" : "observações viraram notas"}`
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
