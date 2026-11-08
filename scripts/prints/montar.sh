#!/usr/bin/env bash
# Monta uma cópia da plataforma com o Supabase simulado (dados FICTÍCIOS de scripts/prints/seed.js) e sobe em http://localhost:8840.
set -euo pipefail
R="$(cd "$(dirname "$0")/../.." && pwd)"; A="${1:-/tmp/prints-app}"
rm -rf "$A"; mkdir -p "$A"; cp -r "$R"/{index.html,css,js,vendor,assets,data,tutoriais} "$A"/
cp "$R"/scripts/prints/{mock-sb.js,seed.js} "$A"/js/lib/; cp -r "$R"/scripts/prints/artes "$A"/js/lib/
# Portal do Cliente com o mesmo Supabase simulado
cp "$R"/portal.html "$A"/
sed -i "s#import { createClient } from '../vendor/supabase-2.117.2.esm.js';#import { sbMock } from './lib/mock-sb.js';#; s#const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);#const sb = sbMock;#" "$A"/js/portal.js
# Página da cotação (fornecedor) com o mesmo Supabase simulado
cp "$R"/cotacao.html "$A"/
sed -i "s#import { createClient } from '../vendor/supabase-2.117.2.esm.js';#import { sbMock } from './lib/mock-sb.js';#; s#const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });#const sb = sbMock;#" "$A"/js/cotacao.js
sed -i "s#import { createClient } from '../../vendor/supabase-2.117.2.esm.js';#import { sbMock } from './mock-sb.js';#; s#export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);#export const sb = sbMock;#" "$A"/js/lib/data.js
# Extrato da VExpenses simulado (a figura da importação de combustível não precisa de um PDF real)
sed -i "s#^export async function lerVExpenses(buf, nome = '', pdfjs) {#export async function lerVExpenses(buf, nome = '', pdfjs) {\n  if (globalThis.MOCK_VEXPENSES) return globalThis.MOCK_VEXPENSES;#" "$A"/js/lib/vexpenses.js
cd "$A" && exec python3 -m http.server 8840
