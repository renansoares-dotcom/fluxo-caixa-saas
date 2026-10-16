-- =====================================================================
-- Etapa 3 — Estoque e produto. Decisão de 16/10/2026: o estoque oficial continua no Iniflex e a plataforma
-- ESPELHA o saldo por importação periódica (posição numa data). A plataforma guarda o cadastro de produto
-- (atributos de plástico flexível), o de-para com o código de cada fornecedor, a estrutura do produto
-- e o custo de compra calculado pelas NF-e de entrada (sem os impostos recuperáveis).
-- Migração ADITIVA. Únicas alterações em tabelas existentes: coluna produto_id (opcional) nos itens de
-- requisição e de pedido do módulo Compras (criado na 040).
-- =====================================================================

-- ---------- parâmetros de custo ----------
create table if not exists public.estoque_parametros (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  icms_recupera boolean not null default true,        -- ICMS destacado sai do custo
  pis_cofins_recupera boolean not null default true,  -- PIS/COFINS destacados saem do custo
  ipi_recupera boolean not null default true,         -- IPI destacado sai do custo (indústria que credita IPI)
  atualizado_em timestamptz not null default now()
);

-- ---------- produtos ----------
create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,                                 -- código do Iniflex (o mesmo da NF-e de saída)
  descricao text not null,
  tipo text not null default 'materia_prima' check (tipo in ('materia_prima', 'aditivo', 'tinta_solvente', 'embalagem', 'semiacabado',
                                                                'produto_acabado', 'uso_consumo', 'peca_manutencao', 'servico', 'outro')),
  unidade text not null default 'KG',
  ncm text,
  grupo text, subgrupo text,
  -- plástico flexível
  material text,                                        -- PEBD, PEAD, PELBD, PP, BOPP, PET, ...
  largura_mm numeric(10,2), espessura_um numeric(10,2), comprimento_m numeric(12,3),
  camadas smallint check (camadas in (1, 2)),           -- 2 = tubular / saco (duas faces)
  densidade numeric(6,4),                               -- g/cm³ (PEBD ≈ 0,92; PEAD ≈ 0,95; PP ≈ 0,90)
  cor text, cores_impressao smallint, corona boolean, sanfona boolean,
  formato text check (formato in ('bobina', 'saco', 'sacola', 'folha', 'outro')),
  solda text,
  -- estoque e compra
  estoque_minimo numeric(16,3), estoque_maximo numeric(16,3), ponto_pedido numeric(16,3), lote_economico numeric(16,3),
  localizacao text,
  unidade_compra text, fator_compra numeric(16,6),      -- ex.: SC de 25 KG → fator 25
  plano_id uuid references public.plano_contas(id) on delete set null,   -- classificação padrão da compra
  ativo boolean not null default true,
  origem text not null default 'manual' check (origem in ('manual', 'nfe_saida', 'nfe_entrada', 'iniflex')),
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists produtos_emp_tipo on public.produtos(empresa_id, tipo);
create index if not exists produtos_emp_ncm on public.produtos(empresa_id, ncm);

-- ---------- produto × fornecedor (código do item na nota do fornecedor) ----------
create table if not exists public.produto_fornecedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  emit_doc text not null,                               -- CNPJ do fornecedor (só dígitos, como na NF-e)
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  codigo_fornecedor text not null,                      -- cProd da nota do fornecedor
  descricao_fornecedor text,
  unidade_fornecedor text,
  fator numeric(16,6) not null default 1 check (fator > 0),   -- 1 unidade do fornecedor = fator unidades do produto
  ultimo_preco numeric(20,10),                          -- custo unitário líquido na unidade do produto
  ultima_compra date,
  criado_em timestamptz not null default now(),
  unique (empresa_id, emit_doc, codigo_fornecedor)
);
create index if not exists produto_forn_prod on public.produto_fornecedores(produto_id);

-- ---------- estrutura do produto ----------
create table if not exists public.produto_estrutura (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,     -- o que se fabrica
  componente_id uuid not null references public.produtos(id),                    -- o que se consome
  quantidade numeric(16,6) not null check (quantidade > 0),                      -- por "base" unidades do produto
  base numeric(16,3) not null default 1 check (base > 0),                         -- ex.: 1000 (por milheiro) ou 1 (por kg)
  perda_pct numeric(6,2) not null default 0 check (perda_pct >= 0 and perda_pct < 100),
  observacao text,
  unique (produto_id, componente_id),
  check (produto_id <> componente_id)
);
create index if not exists produto_estr_prod on public.produto_estrutura(produto_id);

-- ---------- espelho do estoque do Iniflex ----------
create table if not exists public.estoque_espelhos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data_ref date not null,                               -- posição do Iniflex nesta data
  arquivo text,
  linhas int not null default 0,
  valor_total numeric(18,2),
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists estoque_espelhos_emp on public.estoque_espelhos(empresa_id, data_ref);
create table if not exists public.estoque_espelho_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  espelho_id uuid not null references public.estoque_espelhos(id) on delete cascade,
  produto_id uuid references public.produtos(id) on delete set null,
  codigo text not null,
  descricao text,
  deposito text not null default 'GERAL',
  unidade text,
  quantidade numeric(18,4) not null,
  custo_unitario numeric(20,10),                        -- custo informado pelo Iniflex (se o relatório trouxer)
  valor numeric(18,2)
);
create index if not exists estoque_esp_itens_esp on public.estoque_espelho_itens(espelho_id);
create index if not exists estoque_esp_itens_prod on public.estoque_espelho_itens(produto_id);

-- ---------- Compras passa a apontar para o produto (opcional; o texto livre continua) ----------
alter table public.compras_requisicao_itens add column if not exists produto_id uuid references public.produtos(id) on delete set null;
alter table public.compras_pedido_itens add column if not exists produto_id uuid references public.produtos(id) on delete set null;

-- ---------- custo líquido de um item de NF-e de entrada ----------
create or replace function public.custo_item_nfe(i public.nfe_itens, p public.estoque_parametros)
returns numeric language sql immutable as $$
  select coalesce(i.vprod, 0) + coalesce(i.vfrete, 0) + coalesce(i.voutro, 0) - coalesce(i.vdesc, 0) + coalesce(i.v_st, 0)
       + case when coalesce(p.ipi_recupera, true) then 0 else coalesce(i.v_ipi, 0) end
       - case when coalesce(p.icms_recupera, true) then coalesce(i.v_icms, 0) else 0 end
       - case when coalesce(p.pis_cofins_recupera, true) then coalesce(i.v_pis, 0) + coalesce(i.v_cofins, 0) else 0 end;
$$;

-- compras por produto (pelas NF-e de entrada mapeadas no de-para): quantidade na unidade do produto e custo líquido
create or replace function public.produto_compras(p_empresa uuid, p_de date, p_ate date)
returns table(produto_id uuid, nota_id uuid, numero int, emissao date, emit_nome text, emit_doc text, codigo_fornecedor text,
              quantidade numeric, custo_total numeric, custo_unitario numeric)
language sql stable security definer set search_path = public as $$
  select pf.produto_id, n.id, n.numero, n.emissao, n.emit_nome, n.emit_doc, i.cprod,
         i.qcom * pf.fator, custo_item_nfe(i, ep), case when i.qcom * pf.fator > 0 then custo_item_nfe(i, ep) / (i.qcom * pf.fator) end
  from nfe_notas n
  join nfe_itens i on i.nota_id = n.id
  join produto_fornecedores pf on pf.empresa_id = n.empresa_id and pf.emit_doc = n.emit_doc and pf.codigo_fornecedor = i.cprod
  left join estoque_parametros ep on ep.empresa_id = n.empresa_id
  where n.empresa_id = p_empresa and is_membro(p_empresa)
    and n.tipo = 'entrada' and not n.emissao_propria and n.situacao = 'autorizada'
    and n.emissao between p_de and p_ate and coalesce(n.finalidade, '1') = '1';
$$;

-- itens de fornecedor ainda sem de-para (para a tela de de-para), agrupados por fornecedor + código
create or replace function public.produto_depara_pendente(p_empresa uuid, p_de date)
returns table(emit_doc text, emit_nome text, codigo_fornecedor text, descricao text, unidade text, ncm text,
              notas bigint, quantidade numeric, valor numeric, ultima date)
language sql stable security definer set search_path = public as $$
  select n.emit_doc, max(n.emit_nome), i.cprod, max(i.xprod), max(i.ucom), max(i.ncm), count(distinct n.id), sum(i.qcom), sum(i.vprod), max(n.emissao)
  from nfe_notas n join nfe_itens i on i.nota_id = n.id
  where n.empresa_id = p_empresa and is_membro(p_empresa)
    and n.tipo = 'entrada' and not n.emissao_propria and n.situacao = 'autorizada' and n.emissao >= p_de
    and coalesce(n.finalidade, '1') = '1' and i.cprod is not null
    and not exists (select 1 from produto_fornecedores pf where pf.empresa_id = n.empresa_id and pf.emit_doc = n.emit_doc and pf.codigo_fornecedor = i.cprod)
  group by n.emit_doc, i.cprod;
$$;

-- produtos vendidos (NF-e de saída própria) ainda não cadastrados: base do cadastro inicial de produto acabado
create or replace function public.produto_saida_pendente(p_empresa uuid, p_de date)
returns table(codigo text, descricao text, unidade text, ncm text, notas bigint, quantidade numeric, valor numeric, ultima date)
language sql stable security definer set search_path = public as $$
  select i.cprod, max(i.xprod), max(i.ucom), max(i.ncm), count(distinct n.id), sum(i.qcom), sum(i.vprod), max(n.emissao)
  from nfe_notas n join nfe_itens i on i.nota_id = n.id
  where n.empresa_id = p_empresa and is_membro(p_empresa)
    and n.tipo = 'saida' and n.emissao_propria and n.situacao = 'autorizada' and n.emissao >= p_de and i.cprod is not null
    and not exists (select 1 from produtos pr where pr.empresa_id = n.empresa_id and pr.codigo = i.cprod)
  group by i.cprod;
$$;

-- recebimento de Compras com nota: guarda o último preço no de-para do fornecedor (quando o item do pedido tem produto)
create or replace function public._estoque_preco_recebimento() returns trigger
language plpgsql security definer set search_path = public as $$
declare pi compras_pedido_itens; it nfe_itens; n nfe_notas; ep estoque_parametros; f uuid;
begin
  if new.nfe_item_id is null then return new; end if;
  select * into pi from compras_pedido_itens where id = new.pedido_item_id;
  if pi.produto_id is null then return new; end if;
  select * into it from nfe_itens where id = new.nfe_item_id;
  select * into n from nfe_notas where id = it.nota_id;
  select * into ep from estoque_parametros where empresa_id = new.empresa_id;
  select favorecido_id into f from compras_pedidos where id = pi.pedido_id;
  if it.cprod is null or n.emit_doc is null then return new; end if;
  insert into produto_fornecedores (empresa_id, produto_id, emit_doc, favorecido_id, codigo_fornecedor, descricao_fornecedor, unidade_fornecedor, fator, ultimo_preco, ultima_compra)
  values (new.empresa_id, pi.produto_id, n.emit_doc, f, it.cprod, it.xprod, it.ucom, 1,
          case when it.qcom > 0 then custo_item_nfe(it, ep) / it.qcom end, n.emissao)
  on conflict (empresa_id, emit_doc, codigo_fornecedor) do update
    set ultimo_preco = case when it.qcom > 0 then custo_item_nfe(it, ep) / (it.qcom * produto_fornecedores.fator) else produto_fornecedores.ultimo_preco end,
        ultima_compra = greatest(coalesce(produto_fornecedores.ultima_compra, n.emissao), n.emissao),
        favorecido_id = coalesce(produto_fornecedores.favorecido_id, excluded.favorecido_id);
  return new;
end $$;
drop trigger if exists estoque_preco_recebimento on public.compras_recebimento_itens;
create trigger estoque_preco_recebimento after insert on public.compras_recebimento_itens for each row execute function public._estoque_preco_recebimento();

-- importa um espelho do Iniflex de uma vez (cabeçalho + itens); liga cada linha ao produto pelo código
-- p_itens: [{codigo, descricao, deposito, unidade, quantidade, custo_unitario, valor}]
create or replace function public.estoque_importar_espelho(p_empresa uuid, p_data date, p_arquivo text, p_itens jsonb, p_observacao text)
returns uuid language plpgsql security definer set search_path = public as $$
declare eid uuid; n int;
begin
  if not pode_editar(p_empresa) and not pode_aprovar_compra(p_empresa) then raise exception 'Só admin, financeiro ou diretor importa o estoque.'; end if;
  if p_data is null then raise exception 'Informe a data da posição.'; end if;
  insert into estoque_espelhos (empresa_id, data_ref, arquivo, observacao) values (p_empresa, p_data, p_arquivo, p_observacao) returning id into eid;
  insert into estoque_espelho_itens (empresa_id, espelho_id, produto_id, codigo, descricao, deposito, unidade, quantidade, custo_unitario, valor)
  select p_empresa, eid, pr.id, x.codigo, x.descricao, coalesce(nullif(trim(x.deposito), ''), 'GERAL'), x.unidade, x.quantidade, x.custo_unitario,
         coalesce(x.valor, case when x.custo_unitario is not null then round(x.quantidade * x.custo_unitario, 2) end)
  from jsonb_to_recordset(p_itens) as x(codigo text, descricao text, deposito text, unidade text, quantidade numeric, custo_unitario numeric, valor numeric)
  left join produtos pr on pr.empresa_id = p_empresa and pr.codigo = x.codigo
  where nullif(trim(x.codigo), '') is not null and x.quantidade is not null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Nenhuma linha válida (código e quantidade) no arquivo.'; end if;
  update estoque_espelhos set linhas = n, valor_total = (select sum(valor) from estoque_espelho_itens where espelho_id = eid) where id = eid;
  return eid;
end $$;

-- liga as linhas de espelhos ao produto depois que o produto é cadastrado
create or replace function public._estoque_ligar_espelho() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update estoque_espelho_itens set produto_id = new.id where empresa_id = new.empresa_id and codigo = new.codigo and produto_id is null;
  return null;
end $$;
drop trigger if exists estoque_ligar_espelho on public.produtos;
create trigger estoque_ligar_espelho after insert on public.produtos for each row execute function public._estoque_ligar_espelho();

-- notas candidatas ao recebimento passam a trazer o CNPJ do emitente e o código do item (casamento pelo de-para)
create or replace function public.compras_notas_candidatas(p_pedido uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p compras_pedidos; doc text;
begin
  select * into p from compras_pedidos where id = p_pedido;
  if p.id is null or not pode_comprar(p.empresa_id) then raise exception 'Sem acesso a este pedido.'; end if;
  select regexp_replace(coalesce(documento, ''), '\D', '', 'g') into doc from favorecidos where id = p.favorecido_id;
  return coalesce((select jsonb_agg(x order by x->>'emissao' desc) from (
    select jsonb_build_object('id', n.id, 'emit_doc', n.emit_doc, 'numero', n.numero, 'serie', n.serie, 'emissao', n.emissao, 'emit_nome', n.emit_nome, 'v_nf', n.v_nf,
      'mesmo_fornecedor', (n.favorecido_id = p.favorecido_id or (doc <> '' and n.emit_doc = doc)),
      'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'cprod', i.cprod, 'n_item', i.n_item, 'xprod', i.xprod, 'ucom', i.ucom, 'qcom', i.qcom, 'vuncom', i.vuncom, 'vprod', i.vprod, 'ncm', i.ncm) order by i.n_item)
                         from nfe_itens i where i.nota_id = n.id), '[]'::jsonb),
      'parcelas', coalesce((select jsonb_agg(jsonb_build_object('id', pa.id, 'numero', pa.numero, 'vencimento', pa.vencimento, 'valor', pa.valor,
                         'vinculada', exists(select 1 from nfe_vinculos v where v.parcela_id = pa.id or (v.nota_id = n.id and v.parcela_id is null))) order by pa.numero)
                         from nfe_parcelas pa where pa.nota_id = n.id), '[]'::jsonb),
      'ja_recebida', exists(select 1 from compras_recebimentos r where r.nfe_nota_id = n.id)) x
    from nfe_notas n
    where n.empresa_id = p.empresa_id and n.tipo = 'entrada' and not n.emissao_propria and n.situacao = 'autorizada'
      and n.emissao >= p.data_pedido - 30
      and (n.favorecido_id = p.favorecido_id or (doc <> '' and n.emit_doc = doc))
  ) s), '[]'::jsonb);
end $$;

revoke all on function public.produto_compras(uuid, date, date), public.produto_depara_pendente(uuid, date), public.produto_saida_pendente(uuid, date),
  public.estoque_importar_espelho(uuid, date, text, jsonb, text) from public, anon;
grant execute on function public.produto_compras(uuid, date, date), public.produto_depara_pendente(uuid, date), public.produto_saida_pendente(uuid, date),
  public.estoque_importar_espelho(uuid, date, text, jsonb, text), public.custo_item_nfe(public.nfe_itens, public.estoque_parametros) to authenticated;

-- ---------- acesso ----------
do $$
declare t text;
begin
  foreach t in array array['estoque_parametros', 'produtos', 'produto_fornecedores', 'produto_estrutura', 'estoque_espelhos', 'estoque_espelho_itens'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
-- leitura: todos os membros da empresa, inclusive o perfil Compras (precisa escolher o produto na requisição)
drop policy if exists produtos_sel on public.produtos;
create policy produtos_sel on public.produtos for select to authenticated using (public.is_participante(empresa_id));
drop policy if exists produto_fornecedores_sel on public.produto_fornecedores;
create policy produto_fornecedores_sel on public.produto_fornecedores for select to authenticated using (public.is_participante(empresa_id));
drop policy if exists produto_estrutura_sel on public.produto_estrutura;
create policy produto_estrutura_sel on public.produto_estrutura for select to authenticated using (public.is_participante(empresa_id));
drop policy if exists estoque_espelhos_sel on public.estoque_espelhos;
create policy estoque_espelhos_sel on public.estoque_espelhos for select to authenticated using (public.is_participante(empresa_id));
drop policy if exists estoque_espelho_itens_sel on public.estoque_espelho_itens;
create policy estoque_espelho_itens_sel on public.estoque_espelho_itens for select to authenticated using (public.is_participante(empresa_id));
drop policy if exists estoque_parametros_sel on public.estoque_parametros;
create policy estoque_parametros_sel on public.estoque_parametros for select to authenticated using (public.is_participante(empresa_id));
-- escrita do cadastro: quem opera Compras (admin, financeiro, diretor, compras)
do $$
declare t text;
begin
  foreach t in array array['produtos', 'produto_fornecedores', 'produto_estrutura'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_comprar(empresa_id))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_comprar(empresa_id)) with check (public.pode_comprar(empresa_id))', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.pode_comprar(empresa_id))', t || '_del', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- espelhos: entram pela função; excluir um espelho errado: admin, financeiro ou diretor
drop policy if exists estoque_espelhos_del on public.estoque_espelhos;
create policy estoque_espelhos_del on public.estoque_espelhos for delete to authenticated using (public.pode_editar(empresa_id) or public.pode_aprovar_compra(empresa_id));
grant select, delete on public.estoque_espelhos to authenticated;
grant select on public.estoque_espelho_itens, public.estoque_parametros to authenticated;
-- parâmetros de custo: admin/diretor/financeiro
drop policy if exists estoque_parametros_ins on public.estoque_parametros;
drop policy if exists estoque_parametros_upd on public.estoque_parametros;
create policy estoque_parametros_ins on public.estoque_parametros for insert to authenticated with check (public.pode_editar(empresa_id) or public.pode_aprovar_compra(empresa_id));
create policy estoque_parametros_upd on public.estoque_parametros for update to authenticated using (public.pode_editar(empresa_id) or public.pode_aprovar_compra(empresa_id)) with check (public.pode_editar(empresa_id) or public.pode_aprovar_compra(empresa_id));
grant insert, update on public.estoque_parametros to authenticated;

-- ---------- auditoria (migração 038) ----------
do $$
declare t text;
begin
  foreach t in array array['estoque_parametros', 'produtos', 'produto_fornecedores', 'produto_estrutura', 'estoque_espelhos'] loop
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;
