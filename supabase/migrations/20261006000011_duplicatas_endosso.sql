-- Duplicatas para endosso (06/10): beneficiários do endosso, endereço de clientes e do emitente, registro das emitidas.

-- Endereço e IE dos favorecidos (clientes = sacados das duplicatas; vem do XML da NF-e)
alter table public.favorecidos
  add column if not exists ie text,
  add column if not exists logradouro text,
  add column if not exists numero text,
  add column if not exists complemento text,
  add column if not exists bairro text,
  add column if not exists municipio text,
  add column if not exists uf text,
  add column if not exists cep text;

-- Dados do emitente (empresa) impressos na duplicata
alter table public.empresas
  add column if not exists razao_social text,
  add column if not exists ie text,
  add column if not exists logradouro text,
  add column if not exists municipio text,
  add column if not exists uf text,
  add column if not exists cep text,
  add column if not exists responsavel_nome text,
  add column if not exists responsavel_cpf text,
  add column if not exists avalista_nome text,
  add column if not exists avalista_cpf text;

-- Beneficiários do endosso (fundos, bancos, factorings) com dados completos
create table if not exists public.beneficiarios_endosso (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,                 -- nome curto (FS, Negocial…)
  razao_social text,
  cnpj text,
  logradouro text,
  municipio text,
  uf text,
  cep text,
  praca_pagamento text,               -- "SÃO PAULO/SP"
  fundo_id uuid references public.fidc_fundos(id) on delete set null,
  ativo boolean not null default true,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists beneficiarios_endosso_emp on public.beneficiarios_endosso(empresa_id);

-- Duplicatas emitidas e endossadas (o PDF é assinado fora, com certificado digital)
create table if not exists public.duplicatas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  numero text not null,               -- NF-parcela
  fatura text,
  emissao date,
  vencimento date not null,
  valor numeric(14,2) not null,
  sacado_id uuid references public.favorecidos(id) on delete set null,
  beneficiario_id uuid references public.beneficiarios_endosso(id) on delete set null,
  proposta_id uuid references public.fidc_propostas(id) on delete set null,
  lote text,                          -- identificador do PDF gerado
  dados jsonb,                        -- retrato do que foi impresso (emitente, sacado, beneficiário)
  emitida_em timestamptz not null default now(),
  emitida_por uuid default auth.uid()
);
create index if not exists duplicatas_lanc on public.duplicatas(lancamento_id);
create index if not exists duplicatas_emp on public.duplicatas(empresa_id, emitida_em);

alter table public.beneficiarios_endosso enable row level security;
alter table public.duplicatas enable row level security;
create policy benef_sel on public.beneficiarios_endosso for select to authenticated using (public.is_membro(empresa_id));
create policy benef_ins on public.beneficiarios_endosso for insert to authenticated with check (public.pode_editar(empresa_id));
create policy benef_upd on public.beneficiarios_endosso for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy benef_del on public.beneficiarios_endosso for delete to authenticated using (public.pode_editar(empresa_id));
create policy dup_sel on public.duplicatas for select to authenticated using (public.is_membro(empresa_id));
create policy dup_ins on public.duplicatas for insert to authenticated with check (public.pode_editar(empresa_id));
create policy dup_del on public.duplicatas for delete to authenticated using (public.pode_editar(empresa_id));
revoke all on public.beneficiarios_endosso, public.duplicatas from anon;
grant select, insert, update, delete on public.beneficiarios_endosso, public.duplicatas to authenticated;
