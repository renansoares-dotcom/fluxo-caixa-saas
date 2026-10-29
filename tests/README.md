# Testes automáticos

Rodam sozinhos no GitHub a cada envio (workflow **Testes**). Para rodar no computador:

```bash
node tests/verificar-sintaxe.mjs      # sintaxe e imports de todos os módulos
node --test "tests/*.test.js"         # bibliotecas puras e regra dos manuais
```

- `tests/*.test.js` — testes com `node:test`, sem dependências.
- `tests/sql/*.sql` — testes de banco, rodados em ordem depois de aplicar todas as migrações do zero num PostgreSQL 17
  com `scripts/backup/ambiente-supabase.sql`. Só dados fictícios. Cada arquivo falha com `raise exception`.
- Ao criar uma migração, rode `scripts/gerar-setup.sh`: o teste confere se o `setup.sql` está em dia.
