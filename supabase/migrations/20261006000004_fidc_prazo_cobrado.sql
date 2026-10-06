-- Prazo cobrado pelo fundo (base da "taxa do fundo"); prazo_medio continua sendo o prazo real
alter table public.fidc_operacoes add column if not exists prazo_cobrado numeric(10,2);
comment on column public.fidc_operacoes.prazo_medio is 'Prazo médio real dos títulos (dias), ponderado pelo valor';
comment on column public.fidc_operacoes.prazo_cobrado is 'Prazo médio cobrado pelo fundo no borderô (dias); base da taxa do fundo. Nulo = igual ao prazo real';
