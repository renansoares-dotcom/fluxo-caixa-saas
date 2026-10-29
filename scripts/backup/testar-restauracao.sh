#!/usr/bin/env bash
# Teste de restauração: restaura o backup num PostgreSQL vazio e confere, tabela por tabela, o número de linhas.
# Uso: ALVO="postgresql://postgres:senha@localhost:5432" scripts/backup/testar-restauracao.sh <pasta do backup>
set -euo pipefail
S="${1:-saida}"; D="$(dirname "$0")"; B="restauracao_$$"
psql "$ALVO/postgres" -X -q -c "create database $B"
trap 'psql "$ALVO/postgres" -X -q -c "drop database if exists $B" >/dev/null 2>&1 || true' EXIT
psql "$ALVO/$B" -X -q -v ON_ERROR_STOP=1 -f "$D/ambiente-supabase.sql" 2>&1 | grep -v -E 'wal_level|logical' || true
# usuários do login (a tabela real substitui a simulada)
psql "$ALVO/$B" -X -q -c "drop table auth.users cascade" >/dev/null
pg_restore --dbname="$ALVO/$B" --no-owner --no-privileges --exit-on-error "$S/usuarios.dump"
# o backup traz o próprio esquema public
psql "$ALVO/$B" -X -q -c "drop schema public cascade" >/dev/null
pg_restore --dbname="$ALVO/$B" --no-owner --no-privileges --exit-on-error "$S/banco.dump"
psql "$ALVO/$B" -X -At -v ON_ERROR_STOP=1 -f "$D/contagens.sql" > "$S/contagens_restauradas.txt"
if diff -u "$S/contagens.txt" "$S/contagens_restauradas.txt" > "$S/diferencas.txt"; then
  echo "Restauração conferida: $(wc -l < "$S/contagens.txt") tabelas, $(awk -F';' '{s+=$2} END {print s}' "$S/contagens.txt") linhas, todas iguais."
else
  echo "::error::A restauração não bateu com o banco:"; cat "$S/diferencas.txt"; exit 1
fi
