-- Recesso do fundo e vencimento ajustado na proposta de borderô (22/10/2026).
-- 1) fidc_fundos.recessos: períodos sem expediente do fundo, [{"de":"2026-12-20","ate":"2027-01-07","cobra_ate":"2027-01-07"}].
--    Quando a data cobrada (vencimento + compensação) cai dentro do período, o fundo cobra até "cobra_ate" (padrão: "ate").
--    Ex.: FS, recesso de 20/12/2026 a 07/01/2027 — título de 21/12 cobrado até 07/01 (borderôs de 21 e 22/10/2026).
-- 2) fidc_proposta_itens.vencimento_original: quando o vencimento é ajustado na proposta, "vencimento" guarda o ajustado
--    (é ele que vai para a carteira do fundo na aprovação) e este campo guarda o da nota.
-- Aditivo: não altera dados. Pode rodar mais de uma vez.

alter table public.fidc_fundos add column if not exists recessos jsonb not null default '[]'::jsonb;
alter table public.fidc_proposta_itens add column if not exists vencimento_original date;

-- conferência: deve mostrar 2
select count(*) from information_schema.columns
 where (table_name = 'fidc_fundos' and column_name = 'recessos') or (table_name = 'fidc_proposta_itens' and column_name = 'vencimento_original');
