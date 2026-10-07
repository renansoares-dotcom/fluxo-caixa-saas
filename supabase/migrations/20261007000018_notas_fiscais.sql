-- Notas fiscais (07/10): NF-e completas (cabeçalho, itens com impostos, parcelas) importadas dos XML,
-- e o vínculo de cada parcela/nota com os lançamentos de recebimento que já existem.
-- Nada aqui altera lançamentos: o vínculo fica em nfe_vinculos e só é gravado após aprovação.
create table if not exists public.nfe_notas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave text not null,
  modelo text, serie text, numero int not null,
  emissao date not null,
  tipo text not null check (tipo in ('saida','entrada')),      -- tpNF 1 / 0
  emissao_propria boolean not null default true,                 -- emitida pela empresa
  finalidade text,                                               -- finNFe: 1 normal, 2 complementar, 3 ajuste, 4 devolução
  natureza text, cfops text[],
  emit_doc text, emit_nome text, dest_doc text, dest_nome text, dest_uf text, dest_ind_ie text, consumidor_final boolean,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  v_prod numeric(16,2), v_desc numeric(16,2), v_frete numeric(16,2), v_seg numeric(16,2), v_outro numeric(16,2), v_nf numeric(16,2),
  v_bc_icms numeric(16,2), v_icms numeric(16,2), v_icms_deson numeric(16,2), v_fcp numeric(16,2), v_bc_st numeric(16,2), v_st numeric(16,2),
  v_ipi numeric(16,2), v_pis numeric(16,2), v_cofins numeric(16,2), v_bc_ibscbs numeric(16,2), v_ibs numeric(16,2), v_cbs numeric(16,2), v_tot_trib numeric(16,2),
  situacao text not null default 'autorizada' check (situacao in ('autorizada','cancelada','denegada','outra')),
  cstat text, protocolo text, eventos jsonb not null default '[]'::jsonb,
  inf_cpl text, arquivo text, xml text,
  importado_em timestamptz not null default now(), importado_por uuid default auth.uid(),
  unique (empresa_id, chave)
);
create index if not exists nfe_notas_emp_emissao on public.nfe_notas(empresa_id, emissao);
create index if not exists nfe_notas_emp_numero on public.nfe_notas(empresa_id, numero);
create index if not exists nfe_notas_fav on public.nfe_notas(favorecido_id);

create table if not exists public.nfe_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nota_id uuid not null references public.nfe_notas(id) on delete cascade,
  n_item int not null,
  cprod text, xprod text, ncm text, cest text, cfop text, ucom text,
  qcom numeric(18,4), vuncom numeric(20,10), vprod numeric(16,2), vdesc numeric(16,2), vfrete numeric(16,2), voutro numeric(16,2),
  orig text, cst_icms text, v_bc_icms numeric(16,2), p_icms numeric(8,4), v_icms numeric(16,2), v_bc_st numeric(16,2), v_st numeric(16,2),
  cst_ipi text, v_ipi numeric(16,2), cst_pis text, v_pis numeric(16,2), cst_cofins text, v_cofins numeric(16,2),
  cst_ibscbs text, cclass_trib text, v_ibs numeric(16,2), v_cbs numeric(16,2), v_tot_trib numeric(16,2)
);
create index if not exists nfe_itens_nota on public.nfe_itens(nota_id);
create index if not exists nfe_itens_emp_ncm on public.nfe_itens(empresa_id, ncm);

create table if not exists public.nfe_parcelas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nota_id uuid not null references public.nfe_notas(id) on delete cascade,
  numero int not null, vencimento date, valor numeric(16,2) not null,
  a_vista boolean not null default false   -- nota sem duplicatas: uma parcela com o valor da nota na emissão
);
create index if not exists nfe_parcelas_nota on public.nfe_parcelas(nota_id);

create table if not exists public.nfe_vinculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nota_id uuid not null references public.nfe_notas(id) on delete cascade,
  parcela_id uuid references public.nfe_parcelas(id) on delete cascade,
  lancamento_id uuid not null references public.lancamentos(id) on delete cascade,
  tipo text not null check (tipo in ('exata','soma','nota','parcial','valor_diferente','manual')),
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(),
  unique (lancamento_id)
);
create index if not exists nfe_vinculos_nota on public.nfe_vinculos(nota_id);
create index if not exists nfe_vinculos_parcela on public.nfe_vinculos(parcela_id);

alter table public.nfe_notas enable row level security;
alter table public.nfe_itens enable row level security;
alter table public.nfe_parcelas enable row level security;
alter table public.nfe_vinculos enable row level security;
create policy nfe_notas_sel on public.nfe_notas for select to authenticated using (public.is_membro(empresa_id));
create policy nfe_notas_ins on public.nfe_notas for insert to authenticated with check (public.pode_editar(empresa_id));
create policy nfe_notas_upd on public.nfe_notas for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy nfe_notas_del on public.nfe_notas for delete to authenticated using (public.pode_editar(empresa_id));
create policy nfe_itens_sel on public.nfe_itens for select to authenticated using (public.is_membro(empresa_id));
create policy nfe_itens_ins on public.nfe_itens for insert to authenticated with check (public.pode_editar(empresa_id));
create policy nfe_itens_del on public.nfe_itens for delete to authenticated using (public.pode_editar(empresa_id));
create policy nfe_parcelas_sel on public.nfe_parcelas for select to authenticated using (public.is_membro(empresa_id));
create policy nfe_parcelas_ins on public.nfe_parcelas for insert to authenticated with check (public.pode_editar(empresa_id));
create policy nfe_parcelas_del on public.nfe_parcelas for delete to authenticated using (public.pode_editar(empresa_id));
create policy nfe_vinculos_sel on public.nfe_vinculos for select to authenticated using (public.is_membro(empresa_id));
create policy nfe_vinculos_ins on public.nfe_vinculos for insert to authenticated with check (public.pode_editar(empresa_id));
create policy nfe_vinculos_del on public.nfe_vinculos for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.nfe_notas to authenticated;
grant select, insert, delete on public.nfe_itens, public.nfe_parcelas, public.nfe_vinculos to authenticated;
