#!/usr/bin/env bash
# Backup dos arquivos do Storage (comprovantes, anexos dos fretes, áudios e anexos do chat).
# Lista os objetos pelo banco (storage.objects), baixa cada um pela API do Storage com a chave service_role e confere
# quantidade e tamanho de cada arquivo contra o que o banco registra. Qualquer diferença falha o backup.
# Uso: DB_URL=... SERVICE_KEY=... SUPABASE_URL=https://<projeto>.supabase.co scripts/backup/copiar-arquivos.sh <pasta de saída>
set -euo pipefail
[ -n "${DB_URL:-}" ] && [ -n "${SERVICE_KEY:-}" ] && [ -n "${SUPABASE_URL:-}" ] || { echo "::error::Faltam DB_URL, SERVICE_KEY ou SUPABASE_URL"; exit 1; }
S="${1:-saida}/arquivos"; mkdir -p "$S"
psql "$DB_URL" -X -At -F $'\t' -v ON_ERROR_STOP=1 -c \
  "select bucket_id, name, coalesce(metadata->>'size','') from storage.objects where name not like '%/.emptyFolderPlaceholder' order by 1, 2" > "$S/lista.tsv"
n=0; erro=0
while IFS=$'\t' read -r bucket nome tam; do
  [ -n "$bucket" ] || continue
  dest="$S/$bucket/$nome"; mkdir -p "$(dirname "$dest")"
  url="$SUPABASE_URL/storage/v1/object/authenticated/$bucket/$(jq -rn --arg s "$nome" '$s|@uri' | sed 's/%2F/\//g')"
  if ! curl -fsS --retry 3 -H "Authorization: Bearer $SERVICE_KEY" -H "apikey: $SERVICE_KEY" -o "$dest" "$url"; then
    echo "::error::não baixou $bucket/$nome"; erro=1; continue; fi
  real=$(stat -c %s "$dest")
  if [ -n "$tam" ] && [ "$real" != "$tam" ]; then echo "::error::tamanho diferente em $bucket/$nome ($real × $tam)"; erro=1; fi
  n=$((n + 1))
done < "$S/lista.tsv"
total=$(grep -c . "$S/lista.tsv" || true)
[ "$erro" = 0 ] && [ "$n" = "$total" ] || { echo "::error::arquivos copiados $n de $total"; exit 1; }
echo "Arquivos copiados e conferidos: $n ($(du -sh "$S" | cut -f1))"
