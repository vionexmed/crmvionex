#!/usr/bin/env bash
# Preenche os segredos do .env com valores aleatórios.
#
# Existe porque a parte que as pessoas erram não é o docker-compose: é escolher
# uma chave curta, ou reaproveitar uma que já vazou em outro lugar. Aqui elas
# saem de fonte criptográfica e ninguém precisa pensar.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || cp .env.example .env

# `openssl rand`, e NÃO `tr -dc … </dev/urandom | head -c N`.
#
# Aquele encadeamento parece idiomático e quebra em silêncio aqui: o `head`
# fecha o cano ao ter o que queria, o `tr` morre de SIGPIPE, e com
# `set -o pipefail` isso reprova o comando inteiro. Com `set -e`, o script
# termina ali -- e o .env fica com as chaves VAZIAS, que foi exatamente o que
# aconteceu na primeira versão deste arquivo.
aleatorio() { openssl rand -hex "$1"; }

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl não encontrado. Instale-o ou gere as chaves à mão no .env." >&2
  exit 1
fi

trocar() {
  local chave="$1" valor="$2"
  # -i '' é a forma do BSD sed, que é o do macOS; o GNU recusa o argumento
  # vazio. Detectar é mais curto que exigir gsed.
  if sed --version >/dev/null 2>&1; then
    sed -i "s|^${chave}=.*|${chave}=${valor}|" .env
  else
    sed -i '' "s|^${chave}=.*|${chave}=${valor}|" .env
  fi
}

CHAVE="$(aleatorio 24)"
trocar AUTHENTICATION_API_KEY "$CHAVE"
trocar POSTGRES_PASSWORD "$(aleatorio 16)"

cat <<FIM

  .env preenchido.

  Falta UMA coisa: edite o .env e troque SERVER_URL pelo endereço público
  (https) deste servidor.

  Depois, no CRM -> Integracoes -> WhatsApp por QR code:

    URL do servidor:  o mesmo SERVER_URL
    Chave da API:     $CHAVE

FIM
