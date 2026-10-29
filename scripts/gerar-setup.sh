#!/usr/bin/env bash
# Gera supabase/setup.sql juntando as migrações em ordem. setup.sql serve para criar um banco do zero
# (homologação, restauração). Nunca edite setup.sql à mão: crie a migração e rode este script.
set -euo pipefail
cd "$(dirname "$0")/.."
{
  echo '-- ============================================================'
  echo '-- SETUP COMPLETO — cole tudo no SQL Editor do Supabase e clique em Run'
  echo '-- (equivale a aplicar os arquivos de supabase/migrations em ordem)'
  echo '-- Gerado por scripts/gerar-setup.sh — não edite à mão.'
  echo '-- ============================================================'
  for f in supabase/migrations/*.sql; do
    printf '\n-- >>> %s\n' "$(basename "$f")"
    cat "$f"
    [ -n "$(tail -c1 "$f")" ] && echo
  done
} > supabase/setup.sql
echo "setup.sql gerado com $(ls supabase/migrations/*.sql | wc -l) migrações"
