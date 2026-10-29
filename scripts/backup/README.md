# Backup próprio do banco

Além do backup do Supabase, o GitHub copia o banco **todo dia às 03:15** (workflow `.github/workflows/backup.yml`):

1. copia os esquemas `public` e `arquivo` e os usuários do login (`auth.users`, `auth.identities`);
2. **restaura a cópia** num PostgreSQL 17 vazio e confere, tabela por tabela, o número de linhas;
3. só se bater, criptografa (AES-256, senha do secret `BACKUP_SENHA`) e guarda por 30 dias em
   **Actions › Backup diário do banco** (arquivo `backup-AAAA-MM-DD.tar.gpg`).

Se a restauração não bater ou a cópia falhar, o workflow fica vermelho e o GitHub manda e-mail.

## Configuração (uma vez)

Em **Settings › Secrets and variables › Actions › New repository secret**:

| Secret | O que colocar |
|---|---|
| `SUPABASE_DB_URL` | Supabase › **Connect** › **Session pooler** › URI, com a senha do banco no lugar de `[YOUR-PASSWORD]`. Use o *Session pooler* (o endereço direto não funciona no GitHub, que não tem IPv6). |
| `BACKUP_SENHA` | Uma senha longa (16 caracteres ou mais) só para os backups. **Guarde fora do GitHub** (gerenciador de senhas): sem ela o backup não abre. |

Depois, em **Actions › Backup diário do banco › Run workflow**, rode uma vez para conferir.

## Restaurar

1. Baixe o `backup-AAAA-MM-DD.tar.gpg` em Actions.
2. Abra: `gpg -d backup-AAAA-MM-DD.tar.gpg | tar -xf -` (pede a `BACKUP_SENHA`).
3. Num projeto Supabase **novo** (nunca por cima do banco em uso), com a URI dele em `$NOVO`:
   ```bash
   pg_restore --dbname="$NOVO" --no-owner --no-privileges --data-only usuarios.dump   # usuários do login
   psql "$NOVO" -c "drop schema public cascade"
   pg_restore --dbname="$NOVO" --no-owner banco.dump                                  # com as permissões
   ```
4. Confira com `psql "$NOVO" -At -f scripts/backup/contagens.sql | diff - contagens.txt`.

A verificação em duas etapas precisa ser ativada de novo por cada pessoa (os fatores não vão no backup).
Os arquivos do Storage (anexos) não estão neste backup.

## Teste local

```bash
ALVO="postgresql://postgres:senha@localhost:5432" scripts/backup/testar-restauracao.sh <pasta do backup>
```
