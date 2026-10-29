#!/usr/bin/env bash
# Backup: copia o banco do Supabase (esquemas public e arquivo + usuários do login) e as contagens de linhas.
# Uso: DB_URL="postgresql://..." scripts/backup/copiar.sh <pasta de saída>
set -euo pipefail
[ -n "${DB_URL:-}" ] || { echo "::error::Falta o secret SUPABASE_DB_URL (string de conexão do banco)"; exit 1; }
S="${1:-saida}"; mkdir -p "$S"
pg_dump "$DB_URL" --format=custom --schema=public --schema=arquivo --file="$S/banco.dump"
pg_dump "$DB_URL" --format=custom --table=auth.users --table=auth.identities --file="$S/usuarios.dump"
psql "$DB_URL" -X -At -v ON_ERROR_STOP=1 -f "$(dirname "$0")/contagens.sql" > "$S/contagens.txt"
echo "Copiado: $(wc -l < "$S/contagens.txt") tabelas, $(du -h "$S/banco.dump" | cut -f1)"
