# Power BI — conectar ao CRM Vionex

## O que dá para fazer sem pagar

**Power BI Desktop é gratuito** e tem conector nativo de PostgreSQL. Dá para montar qualquer
análise sobre os dados do CRM sem custo nenhum.

**Embutir um relatório dentro do CRM é pago**, sem exceção — capacidade Fabric F2 (~US$ 263/mês),
A1 legado (~US$ 735/mês) ou Power BI Pro (US$ 14 por usuário/mês). A opção "publicar na web" é
gratuita mas torna o relatório **público para qualquer pessoa com o link**, o que é inaceitável
para dado de CRM. Por isso o caminho adotado é o Desktop conectado ao banco.

## Como conectar

### 1. Definir a senha do papel de leitura

A migração `20260817180000_onboarding_herdado_e_analytics.sql` cria o papel `bi_readonly`
**sem senha** — colocar senha em migração deixaria o segredo versionado no repositório.

No SQL Editor do Supabase:

```sql
ALTER ROLE bi_readonly WITH PASSWORD 'uma-senha-forte-e-longa';
```

### 2. Pegar os dados de conexão

No painel do Supabase, em **Project Settings → Database → Connection string**, use o
**Session pooler** (não o Transaction pooler — o Power BI precisa de sessão persistente).

Você vai precisar de: host, porta, nome do banco (`postgres`).

### 3. Conectar no Power BI Desktop

**Obter dados → Banco de dados → PostgreSQL**

| Campo | Valor |
|---|---|
| Servidor | o host do pooler, com a porta — ex.: `aws-0-sa-east-1.pooler.supabase.com:5432` |
| Banco de dados | `postgres` |
| Modo | Importação (mais rápido) ou DirectQuery (sempre atual) |
| Usuário | `bi_readonly` |
| Senha | a que você definiu no passo 1 |

Em **Configurações avançadas**, marque a opção de criptografia da conexão.

## O que você enxerga

O papel só alcança o schema `analytics`. Ele **não** vê as tabelas do schema `public` e
**não** consegue escrever nada.

| View | Conteúdo |
|---|---|
| `analytics.v_leads` | Contatos com estágio do ciclo de vida, especialidade, origem, cidade, pacientes/mês, equipamento atual, responsável, datas de qualificação e descarte |
| `analytics.v_funil` | Negócios com etapa, funil, valor, moeda, status, responsável, motivo de perda |
| `analytics.v_atividades` | Atividades por tipo, com responsável, vencimento e conclusão |
| `analytics.v_mensagens_whatsapp` | Mensagens com direção e status de entrega |
| `analytics.v_emails` | E-mails com direção, status, aberturas e cliques |

Todas trazem `org_id` e `created_at`, então dá para filtrar por empresa e por período no
próprio Power BI.

## Duas ressalvas

**O papel de banco não passa pela RLS.** Isso é o comportamento desejado para análise — o dono
precisa ver tudo — mas significa que as views enxergam os dados de todas as organizações da
instância. Hoje existe uma organização só. Se um dia houver mais de uma, ou as views passam a
filtrar por `org_id`, ou é preciso um papel por organização.

**A senha do `bi_readonly` dá acesso de leitura a todo o schema `analytics`.** Trate como
credencial: não compartilhe em grupo de mensagem e troque se alguém sair da empresa.

## Sugestão de primeiro relatório

Com `v_leads` e `v_funil` já dá para montar o que o painel do CRM não cobre:

- Conversão por especialidade médica (`v_leads.especialidade` × `v_funil.status`)
- Ticket médio por origem (`v_leads.origem` × `v_funil.value`)
- Tempo entre entrada e qualificação (`v_leads.created_at` × `v_leads.qualified_at`)
- Motivos de perda mais frequentes (`v_funil.motivo_perda`) — hoje é texto livre, e vai ficar
  confiável quando o motivo passar a ser vinculado ao catálogo
