# Ponte e-frete (Vercel)

Função Node.js que repassa ao e-frete as chamadas da função `efrete` do Supabase.

**Por que existe:** o servidor do e-frete pede o certificado de cliente por renegociação TLS depois de aberta a
conexão (pasta `/Services`). O runtime das Edge Functions do Supabase não aceita renegociação e derruba a conexão
("connection reset by peer"). O Node.js (OpenSSL) aceita — e é daqui que sai o certificado A1 em produção.

## Implantação (uma vez)
1. Vercel › Add New › Project › importar o repositório `fluxo-caixa-saas`.
2. **Root Directory:** `ponte-efrete` · Framework: Other · sem build.
3. Environment Variables: `PONTE_CHAVE` = uma senha longa aleatória (a mesma vai no Supabase como `EFRETE_PONTE_CHAVE`).
4. Deploy. O endereço fica `https://<projeto>.vercel.app/api/relay` → no Supabase, segredo `EFRETE_PONTE_URL`.
5. Desligar a "Vercel Authentication" (Settings › Deployment Protection) para a produção, senão a ponte responde 401 da Vercel.

## Segurança
- Só atende `POST` com o cabeçalho `x-ponte-chave` igual a `PONTE_CHAVE`.
- Só fala com `dev.efrete.com.br` e `sistema.efrete.com.br`, e só em caminhos `/Services/…`.
- Não guarda nem registra o corpo das requisições (pode conter senha). Usuário, senha e hash ficam no Supabase.
- Certificado A1 (opcional, produção): `EFRETE_PFX_B64` (arquivo .pfx em base64) e `EFRETE_PFX_SENHA`.
