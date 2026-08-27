# Vionex CRM — o que já morde

Não é visão geral do projeto: é a lista de armadilhas que **já custaram tempo**.
Cada item corresponde a um bug real, com o arquivo onde ele mora. Leia antes de
mexer na área correspondente.

---

## Banco

### `contacts` tem DUAS colunas de estágio, e uma delas é armadilha

- `status` — **LEGADO** (4 valores). Não escreva.
- `lifecycle_stage` — a que vale (6 valores).

Um trigger (`sync_contact_lifecycle`) sincroniza as duas, e **no INSERT o `status`
manda**. Escrever `status: 'prospect'` faz o trigger gravar
`lifecycle_stage = 'qualified'`.

**O que isso causou:** contato cadastrado à mão ou importado por CSV nascia
"qualificado" sem ninguém ter qualificado, e por isso nunca aparecia na tela de
Leads. Escrever `lifecycle_stage: 'lead'` explicitamente é **inócuo** — nesse
ramo do trigger o status vence de todo jeito. O que resolve é **não escrever o
status**.

Use `contactsApi.updateLifecycleStage` ou `useUpdateContactsLifecycle`.

### Quatro chaves estrangeiras sem `ON DELETE` recusam exclusão

| Coluna | Comportamento |
|---|---|
| `deals.contact_id` | NO ACTION — **bloqueia** apagar o contato |
| `activities.contact_id` | NO ACTION — **bloqueia** apagar o contato |
| `activities.deal_id` | NO ACTION — **bloqueia** apagar o negócio |
| `emails.*`, `whatsapp_messages.*` | SET NULL — não bloqueiam |

Antes de qualquer DELETE, conte os vínculos e diga ao usuário o que vai embora
(`contactsApi.contarVinculos`, `dealsApi.contarVinculos`). O PostgREST **não expõe
transação**: os filhos vão primeiro, e se o pai falhar depois sobra um registro
sem histórico — é o motivo de a tela confirmar nomeando o que será apagado.

### `deals.owner_id` aponta para `auth.users`, não para `profiles`

Não existe FK `deals` → `profiles`, e o PostgREST não atravessa `auth.users`
(schema não exposto). Então `owner:profiles!deals_owner_id_fkey(*)` **falha
sempre** com PGRST200.

**O que isso causou:** clicar num negócio girava ~7 segundos (três tentativas com
backoff) e devolvia o usuário para a lista, sem erro em tela. Resolva o
responsável no cliente com `useMembers()`, como `Deals.tsx` já faz.

Há teste conferindo todo embed contra os tipos gerados:
`src/test/api/embed-com-fk.test.ts`. Ele entende embed nas duas direções (a chave
pode estar na tabela pai ou na embutida).

### `CREATE OR REPLACE` não troca o tipo de retorno

Mudar as colunas de um `RETURNS TABLE` exige `DROP` + `CREATE`.

### Em `RETURNS TABLE`, os nomes das colunas são variáveis

Um alias de CTE com o mesmo nome de uma coluna de retorno causa
`ambiguous column reference` **em tempo de execução**, não na criação.

### Corpo de função plpgsql não é validado na criação

Chamar função inexistente passa no `CREATE` e falha ao executar. É o que permite
uma migração referenciar função criada numa migração posterior — funciona por
ordem de nome de arquivo, mas é implícito. Ao reaplicar à mão, respeite a ordem.

---

## Frontend

### `.vx-page` anima `transform` — e isso quebra arraste

Um ancestral com `transform` vira **bloco de contenção para `position: fixed`**,
então o `DragOverlay` do dnd-kit passa a se posicionar em relação ao `<main>` e
"foge do cursor" pela largura da sidebar.

**O que isso causou:** três correções erradas antes de a causa aparecer.

Duas proteções, e a primeira é a que importa:
1. renderizar o `DragOverlay` com `createPortal(…, document.body)` —
   `ContactsKanbanByOwner.tsx` faz, `DealsKanban.tsx` **não**;
2. `animation-fill-mode: backwards` em vez de `both` (já aplicado).

**Nunca** adicione `transform`, `scale-*`, `rotate-*`, `filter` ou `backdrop-*`
em wrapper de kanban. `scale-105` num realce de drop zone basta para o bug voltar.

### `--background` e `--muted` têm o MESMO valor (`220 14% 97%`)

O truque padrão de kanban — coluna cinza, card branco — é **invisível no tema
claro**. Para separar coluna de página use `bg-card/50`, que funciona nos dois
temas.

### A cor de destaque é trocável em tempo de execução

`ThemeContext` sobrescreve `--primary`, `--ring` e `--sidebar-primary` conforme a
escolha do usuário. Nunca fixe o teal: use `hsl(var(--primary))`.

Os hex `--vx-*` (`--vx-teal`, `--vx-navy`, …) **não têm valores para o tema
escuro**. Usá-los quebra o dark em silêncio.

### Base tipográfica é 13px, não 16px

`body { font-size: 13px }`. A escala praticada é **9 / 10 / 11 / 12 (`text-xs`) /
13 / 14 (`text-sm`)** — um a dois degraus abaixo do default do Tailwind.
`text-xs` é o corpo, não a legenda.

### Espalhamento não dispara a checagem de propriedade excedente

`{...filters}` passando para uma API: renomear a chave de um lado só faz o filtro
**parar de filtrar em silêncio**, sem erro de tipo. Já aconteceu com
`ContactFilters.status` → `lifecycleStage`.

### Listas sem paginação truncam em 1000 linhas, sem avisar

O PostgREST corta e não sinaliza. `useContacts({ pageSize: 1000 })` faz o
contato simplesmente não aparecer no select. Use `listAll`/`useAllContacts` ou
`listForPicker`, que paginam em blocos.

### `e instanceof Error ? e.message : String(e)` produz `[object Object]`

`PostgrestError` é objeto simples, não instância de `Error`. Use
`mensagemErro(e)` de `src/lib/erro-supabase.ts`, que lê `message`/`details`/`hint`
e traduz os códigos que merecem frase própria.

**O que isso causou:** uma violação de chave estrangeira perfeitamente
diagnosticável apareceu como `[object Object]`, em 12 lugares de 6 telas.

---

## Métricas do painel

Cada tabela guarda **a intenção e a conclusão** em campos separados, e é a
conclusão que conta:

| Tabela | O que diz que aconteceu |
|---|---|
| `activities` | `completed_at IS NOT NULL`, e janela pela **conclusão** |
| `emails` | `status = 'sent'` (nasce `'sending'`), janela por `sent_at` |
| `whatsapp_messages` | `status IN ('sent','delivered','read')` |
| `deals` | oportunidade = **saiu da etapa de entrada** |

Contar por `created_at` faz um mês fechado mudar depois de fechado. Contar sem
filtrar conclusão faz reunião agendada para semana que vem virar abordagem feita
hoje.

A etapa de entrada é identificada pelo **menor `order`**, nunca pelo nome — o
rótulo é editável numa tela de configuração.

Card, gráfico e lista contam a mesma coisa em **funções SQL separadas**
(`sdr_metrics`, `sdr_series`, `sdr_metric_leads`). Mudar uma exige mudar as três,
ou o painel se contradiz. Há testes travando isso.

---

## Fluxo de trabalho

### O lint tem 219 erros pré-existentes

Todos `no-explicit-any` e afins. **Nunca** diga "lint limpo" sem comparar:

```bash
npx eslint src > depois.txt 2>&1
git stash -q && npx eslint src > antes.txt 2>&1 && git stash pop -q
diff antes.txt depois.txt
```

O que importa é o número **não subir**.

### `zsh` não faz word-splitting de variável não citada

`F="a.ts b.ts"; eslint $F` passa a string inteira como **um** argumento. Liste os
arquivos explicitamente ou use array.

### `/tmp` é bloqueado

Use o diretório de scratchpad da sessão.

### Edge function precisa de deploy manual

```bash
npx supabase functions deploy <nome> --project-ref kschuwekbrrwmhzinsrv
```

O frontend sobe pela Vercel; **as duas metades não chegam juntas**. Mudança que
depende das duas precisa de ordem pensada.

Cada função **empacota a própria cópia** de `_shared/*`: mexer em código
compartilhado exige redeployar todos os consumidores.

### Supabase Edge Functions rebaixam `text/html`

O runtime troca por `text/plain` + `nosniff` (anti-phishing no domínio
compartilhado). Página HTML servida por função aparece como código-fonte. JSON e
302 passam.

### Verificação completa

```bash
npm run typecheck && npm test && npm run build
```

---

## Como escrever teste aqui

Muita coisa deste projeto quebra **em silêncio** e não aparece em captura de
tela. Os testes que pegam isso leem arquivo e conferem invariantes:

- embeds contra os tipos gerados (`src/test/api/embed-com-fk.test.ts`)
- critérios de métrica idênticos entre as funções SQL
- o que o dnd-kit precisa: spread de `attributes`/`listeners`, ordem do
  `onPointerDown`, ids `"won-drop"`/`"lost-drop"` (comparados por **string**,
  então renomear não dá erro de tipo)
- nenhuma tela reintroduzindo o padrão do `[object Object]`

**Ignore comentários ao varrer código.** Um teste que proíbe `X` reprova o
comentário que explica por que não usar `X` — e aí fica impossível documentar a
armadilha. Todos os testes de varredura aqui removem comentários antes.

**Prefira lista explícita a varredura genérica.** Uma tentativa de extrair "texto
visível" de `.tsx` por regex reprovou 20 arquivos de uma vez, nenhum por rótulo
errado: pegava nome de tabela em `.from()`, caminho de import e — pior —
genéricos do TypeScript, porque `useState<Stage[]>` tem um `>` e um `<`. Sem
parser de JSX, um scanner desses ou deixa passar o que importa ou grita sem
motivo. Teste que grita sem motivo é teste que alguém desliga.
