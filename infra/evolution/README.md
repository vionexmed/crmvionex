# Evolution API para o Vionex CRM

Servidor de WhatsApp por QR code. O CRM fala com ele pelas edge functions do
Supabase, então ele precisa de **endereço público com HTTPS** — não funciona em
`localhost` nem por IP sem certificado.

## Sem instalar nada na sua máquina

`render.yaml` faz o Render provisionar tudo pelo navegador — serviço, banco e
disco. Não há CLI para instalar nem Docker local.

    render.com → New → Blueprint → conecte o repositório

Ele pede a `AUTHENTICATION_API_KEY` (gere uma longa e guarde: é a que você cola
no CRM). Depois do primeiro deploy, copie a URL que o Render deu, cole em
`SERVER_URL` e redeploye — a Evolution precisa saber o próprio endereço para
montar o QR, e esse endereço só nasce no primeiro deploy.

**Não use o plano gratuito.** Ele hiberna após 15 minutos sem tráfego, e
hibernar derrubaria a sessão do WhatsApp: cada queda obriga todo mundo a ler o
QR de novo.

## O caminho curto (VPS, com Docker)

Numa máquina Linux com Docker, com um domínio já apontado para o IP dela:

```bash
git clone <este repositório> && cd infra/evolution
./gerar-chave.sh                      # gera a chave e a senha do banco
nano .env                             # troque SERVER_URL pelo seu domínio
nano Caddyfile                        # troque o domínio aqui também
docker compose --profile https up -d
```

O script imprime a chave no fim. Ela e o `SERVER_URL` são as duas coisas que
você cola no CRM, em **Integrações → WhatsApp por QR code**.

## Onde hospedar

**Um VPS é a escolha certa aqui, e não é preferência.** A Evolution mantém uma
sessão viva do WhatsApp Web. Plataformas que hibernam ou reiniciam o contêiner
com frequência — os planos gratuitos de quase todas — derrubam essa sessão, e
cada queda obriga todo mundo a ler o QR de novo.

| Onde | Custo aproximado | Observação |
|---|---|---|
| Hetzner CX22 | € 4/mês | 2 vCPU, 4 GB — sobra |
| DigitalOcean | US$ 6/mês | painel mais simples |
| Contabo | € 5/mês | mais barato por GB, suporte pior |
| Railway / Render | variável | evite o plano que hiberna |

Requisitos reais: 2 GB de RAM dão conta de algumas dezenas de instâncias.

## O domínio

Um registro `A` apontando para o IP do servidor, e as portas 80 e 443 abertas.
O Caddy resolve o certificado sozinho na primeira subida — o `Caddyfile` já vem
escrito, só troque o domínio nas duas linhas (`.env` e `Caddyfile`).

## Depois de subir

```bash
docker compose logs -f evolution      # acompanhar
curl -s https://SEU_DOMINIO/ | head   # deve responder, não dar timeout
```

Se o `curl` responder, o CRM alcança. Cole a URL e a chave na tela de
Integrações: a credencial é validada **antes** de ser gravada, então chave
errada é recusada na hora, com o motivo que o servidor devolveu.

## O que fica guardado, e por quê

A sessão do WhatsApp — o que o QR code cria — vive no Postgres e no volume
`evolution_instances`. É o que faz o pareamento sobreviver a `docker compose
restart`. `docker compose down` preserva os volumes; `down -v` apaga, e aí todo
mundo lê o QR de novo.

As mensagens **não** são guardadas aqui: o CRM já as tem em `whatsapp_messages`,
e duplicar só faria o disco crescer sem ninguém ler.

## Manutenção

Atualizar troca a linha `image:` do `docker-compose.yml` e roda
`docker compose up -d`. A versão está fixa de propósito — `latest` que pula de
major sozinho num restart aparece como "parou de enviar" sem ninguém ter tocado
em nada.

Backup do que importa:

```bash
docker compose exec postgres pg_dump -U evolution evolution > evolution.sql
```

## O risco, registrado

A Evolution roda por cima do WhatsApp Web, o que viola os termos da Meta e pode
derrubar o número. É escolha de produto, não de engenharia.
