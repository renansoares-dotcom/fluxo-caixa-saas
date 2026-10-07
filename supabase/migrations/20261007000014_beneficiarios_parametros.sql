-- Cadastro de beneficiários (favorecidos) por tipo, com parâmetros (07/10): base para conformidade,
-- cadastro a partir de NF-e de entrada/saída e, adiante, cálculo de impostos.
alter table public.favorecidos
  add column if not exists tipo_pessoa text check (tipo_pessoa in ('PJ', 'PF')),
  add column if not exists nome_fantasia text,
  add column if not exists im text,
  add column if not exists email text,
  add column if not exists telefone text,
  add column if not exists pix text,
  add column if not exists observacao text,
  -- fiscais
  add column if not exists regime_tributario text,          -- Simples Nacional, Lucro Presumido, Lucro Real, MEI, Não se aplica
  add column if not exists contribuinte_icms text,          -- 1 contribuinte, 2 isento, 9 não contribuinte (indIEDest da NF-e)
  add column if not exists consumidor_final boolean,
  -- comerciais / financeiros
  add column if not exists limite_credito numeric(16,2),
  add column if not exists prazo_padrao text,               -- ex.: 28/42/56
  add column if not exists plano_padrao_id uuid references public.plano_contas(id) on delete set null,
  add column if not exists centro_custo_padrao_id uuid references public.centros_custo(id) on delete set null,
  add column if not exists prioridade_padrao text,          -- Obrigatório / Negociável (fornecedores)
  add column if not exists representante_id uuid references public.favorecidos(id) on delete set null,
  add column if not exists retencoes jsonb,                 -- {"irrf":1.5,"csrf":4.65,"inss":11,"iss":5} (% sobre o serviço)
  add column if not exists updated_at timestamptz default now();
create index if not exists favorecidos_doc on public.favorecidos(empresa_id, documento);
