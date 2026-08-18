# VIONEX

Projeto interno. Todos os direitos reservados.

## Rodar localmente

```bash
npm install
cp .env.example .env    # preencher com as credenciais do ambiente
npm run dev
```

## Verificação

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

## Banco

As migrações ficam em `supabase/migrations/`, em ordem cronológica pelo nome do
arquivo. Aplicar em ordem.
