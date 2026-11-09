# Ponte SEFAZ (Vercel) — NF-e de entrada automática

Função Node.js que fala com o **Ambiente Nacional da NF-e** usando o **certificado A1** da empresa, para a função
`sefaz-dfe` do Supabase:

- **distribuicao**: NFeDistribuicaoDFe (por último NSU ou por chave). Devolve os documentos já descompactados (resumo da NF-e,
  XML completo, eventos);
- **manifestar**: RecepcaoEvento 4.00. Ciência (210210), Confirmação (210200), Desconhecimento (210220) e Operação não
  realizada (210240, com justificativa), com o evento assinado (XMLDSig RSA-SHA1);
- **certificado**: devolve a validade do certificado.

**Por que existe:** a SEFAZ exige TLS mútuo com o certificado do CNPJ consultado, e o evento precisa ser assinado. O runtime
das Edge Functions do Supabase não carrega o certificado de cliente; o Node.js carrega.

## Implantação (uma vez)
1. Vercel › Add New › Project › importar o repositório `fluxo-caixa-saas`.
2. **Root Directory:** `ponte-sefaz` · Framework: Other · sem build.
3. Environment Variables:
   - `PONTE_CHAVE`: uma senha longa aleatória. A mesma vai no Supabase como `SEFAZ_PONTE_CHAVE`;
   - `SEFAZ_PFX_B64`: o arquivo .pfx do certificado A1 em base64 (`base64 -w0 certificado.pfx`);
   - `SEFAZ_PFX_SENHA`: a senha do certificado.
4. Deploy. O endereço fica `https://<projeto>.vercel.app/api/dfe`. No Supabase, cadastre-o no segredo `SEFAZ_PONTE_URL`.
5. Desligue a "Vercel Authentication" (Settings › Deployment Protection) para a produção.

## Segurança
- Só atende `POST` com o cabeçalho `x-ponte-chave` igual a `PONTE_CHAVE`.
- Só fala com os endereços da SEFAZ do Ambiente Nacional (www1/hom1 DistribuicaoDFe e www/hom1 RecepcaoEvento4).
- Não guarda nada. O certificado fica só nas variáveis da Vercel.
