-- Pagamento a maior ao fornecedor (21/10/2026).
-- 1) creditos.tipo ganha 'pago_maior': quando o pagamento ligado à nota passa do valor dela, a diferença vira
--    crédito com o fornecedor (ligado ao pagamento e à nota de origem) e abate as próximas notas.
-- 2) creditos_usos pode ser uma DEVOLUÇÃO EM DINHEIRO: o fornecedor (ou o cliente) devolve o valor e o uso fica
--    ligado ao lançamento de entrada/saída (lancamento_id) em vez de a uma nota.
-- Aditivo: não altera nem apaga dados. Pode rodar mais de uma vez.

alter table public.creditos drop constraint if exists creditos_tipo_check;
alter table public.creditos add constraint creditos_tipo_check
  check (tipo in ('adiantamento', 'devolucao', 'desconto', 'acordo', 'outro', 'pago_maior'));

alter table public.creditos_usos alter column nota_id drop not null;
alter table public.creditos_usos add column if not exists lancamento_id uuid references public.lancamentos(id) on delete cascade;
alter table public.creditos_usos drop constraint if exists creditos_usos_destino_check;
alter table public.creditos_usos add constraint creditos_usos_destino_check check (nota_id is not null or lancamento_id is not null);
create index if not exists creditos_usos_lanc on public.creditos_usos(lancamento_id) where lancamento_id is not null;

-- conferência
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid in ('public.creditos'::regclass, 'public.creditos_usos'::regclass) and contype = 'c' order by 1;
