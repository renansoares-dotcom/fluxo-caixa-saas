# Imagens das telas para os manuais

As figuras de `tutoriais/img/` são tiradas de uma cópia da plataforma com o banco **simulado** no navegador
(`mock-sb.js`) e **dados fictícios** (`seed.js`: empresa, pessoas, valores e documentos inventados). Nada vem do banco real.

1. `scripts/prints/montar.sh` — monta a cópia e sobe em http://localhost:8840 (deixe rodando).
2. `node scripts/prints/capturar.mjs [manual,...]` — tira as telas listadas em `figuras.mjs` (JPEG 1366×820).
3. `node scripts/prints/inserir.mjs` — coloca as figuras nos manuais, logo abaixo do título indicado, e sobe a versão.
4. `node tutoriais/gerar-pdf.mjs` — gera os PDFs de novo.

No texto do manual a figura é uma linha só: `![Legenda](img/arquivo.jpg)`.
