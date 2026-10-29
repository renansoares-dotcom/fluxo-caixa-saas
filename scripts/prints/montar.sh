#!/usr/bin/env bash
# Monta uma cópia da plataforma com o Supabase simulado (dados FICTÍCIOS de scripts/prints/seed.js) e sobe em http://localhost:8840.
set -euo pipefail
R="$(cd "$(dirname "$0")/../.." && pwd)"; A="${1:-/tmp/prints-app}"
rm -rf "$A"; mkdir -p "$A"; cp -r "$R"/{index.html,css,js,vendor,assets,data,tutoriais} "$A"/
cp "$R"/scripts/prints/{mock-sb.js,seed.js} "$A"/js/lib/
sed -i "s#import { createClient } from '../../vendor/supabase-2.117.2.esm.js';#import { sbMock } from './mock-sb.js';#; s#export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);#export const sb = sbMock;#" "$A"/js/lib/data.js
cd "$A" && exec python3 -m http.server 8840
