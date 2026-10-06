-- Método de cálculo do deságio por fundo (conferido com o borderô FS 001226 de 06/10/2026):
--   'fator'   = por dentro: v·k/(1+k), k = taxa × prazo cobrado / 30 (padrão; usado com a taxa média histórica)
--   'simples' = juros simples sobre a face: v × taxa × prazo cobrado / 30 (é como a FS calcula)
-- FS: 2,46% a.m., juros simples, prazo + 3 dias.
alter table public.fidc_fundos add column if not exists metodo_desagio text not null default 'fator'
  check (metodo_desagio in ('fator', 'simples'));
comment on column public.fidc_fundos.metodo_desagio is 'fator = v·k/(1+k); simples = v × taxa × dias/30 sobre a face';
update public.fidc_fundos set taxa_am = 2.46, dias_compensacao = 3, metodo_desagio = 'simples' where nome = 'FS';
