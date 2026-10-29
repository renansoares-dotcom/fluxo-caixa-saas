-- =====================================================================
-- Correção (29/10/2026): anexos voltam a subir.
-- O SQL 056 tirou de quem está logado a função _uuid_ou_nulo, mas as regras do armazenamento (anexos das Conversas,
-- dos Pagamentos Antecipados e dos Fretes) usam essa função ao conferir a pasta do arquivo. O Postgres confere a
-- permissão de todas as funções das regras, então todo envio de arquivo passou a falhar com
-- "permission denied for function _uuid_ou_nulo". A função só converte texto em uuid (sem ler dado nenhum):
-- volta a ser liberada para quem está logado. Pode rodar mais de uma vez.
-- =====================================================================
grant execute on function public._uuid_ou_nulo(text) to authenticated;

-- conferência: deve voltar liberada = true
select has_function_privilege('authenticated', 'public._uuid_ou_nulo(text)', 'execute') as liberada;
