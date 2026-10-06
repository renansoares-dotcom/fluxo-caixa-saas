-- Custos de operação separados nas condições dos fundos (pedido do Renan em 06/10):
-- tarifa_operacao = TED / tarifa fixa por borderô; tarifa_titulo = boleto / cobrança por título;
-- custo_assinatura = assinatura eletrônica por borderô; custo_consulta = consulta Serasa por sacado novo no fundo.
alter table public.fidc_fundos
  add column if not exists custo_assinatura numeric(12,2) not null default 0,
  add column if not exists custo_consulta numeric(12,2) not null default 0;
comment on column public.fidc_fundos.tarifa_operacao is 'TED / tarifa fixa por borderô (R$)';
comment on column public.fidc_fundos.tarifa_titulo is 'Boleto / cobrança por título (R$)';
comment on column public.fidc_fundos.custo_assinatura is 'Assinatura eletrônica por borderô (R$)';
comment on column public.fidc_fundos.custo_consulta is 'Consulta Serasa por sacado novo no fundo (R$)';
-- Valores dos borderôs de set/2026: FS = TED 20 + assinatura 70 + boleto 4,50/título (a linha "CONSULTA SERASA 22,00"
-- de 10/09 é, segundo o Renan, assinatura do borderô — FS não cobra consulta);
-- Negocial = 15 por borderô + 2,50 por título (despesas bancárias).
update public.fidc_fundos set tarifa_operacao = 20, custo_assinatura = 70, tarifa_titulo = 4.50, custo_consulta = 0 where nome = 'FS';
update public.fidc_fundos set tarifa_operacao = 15, tarifa_titulo = 2.50 where nome = 'Negocial';
