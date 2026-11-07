-- =====================================================================
-- Contabilidade › Ativo Imobilizado (07/11/2026) — referência: ERP "Consultoria" (021_ativo_fixo), refeito do zero.
-- O ERP antigo só tinha cadastro e uma depreciação calculada "hoje", sem histórico e sem contabilidade.
-- Aqui:
--  - classes com taxa fiscal (IN RFB 1.700/2017, Anexo III), vida útil contábil (CPC 27), contas contábeis e créditos;
--  - bens com plaqueta, origem (NF-e, lançamento, máquina, veículo), centro de custo, local, responsável e anexos;
--  - depreciação mês a mês gravada (af_depreciacoes), com lançamento contábil automático (origem 'depreciacao'),
--    revisão de vida útil prospectiva, implantação de bens antigos (depreciação acumulada até a data de corte),
--    fechamento do mês (trava) e baixa (venda, sucata, perda, doação) com o lançamento da baixa;
--  - histórico automático de transferências e revisões; inventário com conferência pela plaqueta (QR);
--  - candidatos a imobilizar a partir das NF-e de entrada, dos lançamentos, das máquinas e dos veículos.
-- Só cria objetos novos. Não altera lançamentos, notas, máquinas nem veículos.
-- =====================================================================

-- 1) parâmetros por empresa (tudo configurável pela tela "Parâmetros do Imobilizado")
create table if not exists public.af_parametros (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  prefixo text not null default 'PAT',
  regra_inicio text not null default 'mes_seguinte' check (regra_inicio in ('mes_seguinte', 'mes_aquisicao', 'pro_rata_dia')),
  gerar_contabil boolean not null default true,
  conta_custo_baixa_id uuid references public.contab_contas(id) on delete set null,   -- custo do bem baixado (resultado não operacional)
  valor_minimo numeric(16,2) not null default 1200,      -- RIR/2018 art. 313: abaixo disso pode ir direto para despesa
  ncm_imobilizado text[] not null default array['8401','8402','8403','8404','8405','8406','8407','8408','8410','8411','8412','8413','8414','8415','8416','8417','8418','8419','8420','8421','8422','8423','8424','8425','8426','8427','8428','8429','8430','8432','8433','8434','8435','8436','8437','8438','8439','8440','8441','8442','8443','8444','8445','8446','8447','8448','8449','8450','8451','8452','8453','8454','8455','8456','8457','8458','8459','8460','8461','8462','8463','8464','8465','8468','8470','8471','8472','8474','8475','8477','8478','8479','8501','8502','8504','8514','8515','8516','8517','8521','8525','8528','8531','8543','8701','8702','8703','8704','8705','8709','8716','9006','9016','9017','9024','9025','9026','9027','9030','9031','9032','9401','9403','9405','9406'],
  planos_imobilizado uuid[] not null default '{}',       -- classificações do nosso plano usadas na compra de bens
  pis_cofins_ate date not null default '2026-12-31',     -- LC 214/2025: PIS/COFINS dão lugar à CBS em 2027
  ciap_fatores jsonb not null default '{}'::jsonb,       -- {"2026-11": 0.9731} fator de saídas tributadas informado
  atualizado_por text default (auth.jwt() ->> 'email'),
  atualizado_em timestamptz not null default now()
);

-- 2) classes (grupos) de bens
create table if not exists public.af_classes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  nome text not null,
  deprecia boolean not null default true,                -- terreno: não deprecia
  taxa_fiscal numeric(7,3) not null default 10 check (taxa_fiscal >= 0 and taxa_fiscal <= 100),   -- % ao ano (Anexo III)
  vida_util_meses int not null default 120 check (vida_util_meses > 0),                           -- contábil (CPC 27)
  residual_pct numeric(6,3) not null default 0 check (residual_pct >= 0 and residual_pct < 100),
  conta_ativo_id uuid references public.contab_contas(id) on delete set null,     -- custo do bem
  conta_deprec_id uuid references public.contab_contas(id) on delete set null,    -- depreciação acumulada (redutora)
  conta_despesa_id uuid references public.contab_contas(id) on delete set null,   -- despesa / custo de depreciação
  credito_pis_cofins text not null default 'nenhum' check (credito_pis_cofins in ('nenhum', 'depreciacao', '48', 'imediato')),
  ciap boolean not null default false,                   -- ICMS em 1/48 (LC 87/1996, art. 20, § 5º)
  ativo boolean not null default true,
  observacao text,
  unique (empresa_id, codigo)
);

-- 3) bens
create table if not exists public.af_bens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  plaqueta text not null,
  descricao text not null,
  classe_id uuid not null references public.af_classes(id) on delete restrict,
  pai_id uuid references public.af_bens(id) on delete set null,          -- componente / melhoria de outro bem
  marca text, modelo text, serie text, ncm text,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  local text, responsavel text,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  nfe_nota_id uuid references public.nfe_notas(id) on delete set null,
  nfe_item_id uuid references public.nfe_itens(id) on delete set null,
  nf_numero text,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  maquina_id uuid references public.prod_maquinas(id) on delete set null,
  veiculo_id uuid references public.log_veiculos(id) on delete set null,
  data_aquisicao date not null,
  data_inicio_uso date,                                   -- início da depreciação (disponível para uso); vazio = aquisição
  valor_aquisicao numeric(16,2) not null check (valor_aquisicao >= 0),
  valor_residual numeric(16,2) not null default 0 check (valor_residual >= 0),
  vida_util_meses int not null check (vida_util_meses > 0),
  taxa_fiscal numeric(7,3) not null default 10,
  -- implantação de bem que já vinha sendo depreciado fora da plataforma
  data_corte date,                                        -- último dia do mês até o qual a depreciação já está feita
  deprec_inicial numeric(16,2) not null default 0 check (deprec_inicial >= 0),
  meses_iniciais numeric(8,3) not null default 0 check (meses_iniciais >= 0),
  -- créditos fiscais
  icms_credito numeric(16,2) not null default 0,          -- ICMS destacado aproveitado pelo CIAP
  pis_cofins_base numeric(16,2),                          -- base do crédito (vazio = valor de aquisição)
  credito_pis_cofins text check (credito_pis_cofins in ('nenhum', 'depreciacao', '48', 'imediato')),   -- vazio = o da classe
  ciap boolean,                                           -- vazio = o da classe
  situacao text not null default 'em_uso' check (situacao in ('em_uso', 'ocioso', 'em_manutencao', 'baixado')),
  baixa_data date, baixa_tipo text check (baixa_tipo in ('venda', 'sucata', 'perda', 'doacao', 'outro')),
  baixa_valor numeric(16,2), baixa_motivo text,
  observacao text,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  unique (empresa_id, numero),
  unique (empresa_id, plaqueta),
  check (valor_residual <= valor_aquisicao),
  check (deprec_inicial <= valor_aquisicao),
  check ((situacao = 'baixado') = (baixa_data is not null))
);
create index if not exists af_bens_emp on public.af_bens(empresa_id, situacao);
create index if not exists af_bens_classe on public.af_bens(classe_id);
create index if not exists af_bens_nfe_item on public.af_bens(nfe_item_id);
create index if not exists af_bens_lanc on public.af_bens(lancamento_id);
create index if not exists af_bens_maq on public.af_bens(maquina_id);
create index if not exists af_bens_veic on public.af_bens(veiculo_id);
create index if not exists af_bens_cc on public.af_bens(centro_custo_id);

-- 4) cálculo de cada mês (cabeçalho) e depreciação de cada bem no mês
create table if not exists public.af_calculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null check (competencia = date_trunc('month', competencia)::date),
  situacao text not null default 'calculado' check (situacao in ('calculado', 'fechado')),
  qtd int not null default 0, total numeric(16,2) not null default 0, total_fiscal numeric(16,2) not null default 0,
  baixas int not null default 0,
  pendencias jsonb not null default '[]'::jsonb,
  calculado_por text default (auth.jwt() ->> 'email'), calculado_em timestamptz not null default now(),
  fechado_por text, fechado_em timestamptz,
  unique (empresa_id, competencia)
);
create table if not exists public.af_depreciacoes (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  calculo_id uuid not null references public.af_calculos(id) on delete cascade,
  bem_id uuid not null references public.af_bens(id) on delete cascade,
  competencia date not null,
  meses numeric(6,4) not null,              -- fração do mês depreciada (1 = mês cheio)
  valor numeric(16,2) not null,             -- quota contábil
  acumulada numeric(16,2) not null,         -- acumulada contábil depois do mês
  valor_fiscal numeric(16,2) not null default 0,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  unique (bem_id, competencia)
);
create index if not exists af_deprec_emp on public.af_depreciacoes(empresa_id, competencia);
create index if not exists af_deprec_calc on public.af_depreciacoes(calculo_id);

-- 5) histórico do bem (gravado pelo gatilho: transferência, revisão, situação, baixa)
create table if not exists public.af_movimentos (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  bem_id uuid not null references public.af_bens(id) on delete cascade,
  tipo text not null check (tipo in ('aquisicao', 'transferencia', 'revisao', 'situacao', 'baixa', 'reativacao', 'inventario')),
  data date not null default current_date,
  de jsonb, para jsonb, observacao text,
  usuario text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now()
);
create index if not exists af_mov_bem on public.af_movimentos(bem_id, criado_em);

-- 6) inventário físico
create table if not exists public.af_inventarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  descricao text not null,
  data_inicio date not null default current_date,
  filtro jsonb not null default '{}'::jsonb,      -- {centro_custo_id, local, classe_id}
  situacao text not null default 'aberto' check (situacao in ('aberto', 'concluido')),
  resumo jsonb, concluido_em timestamptz, concluido_por text,
  criado_por text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create table if not exists public.af_inventario_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  inventario_id uuid not null references public.af_inventarios(id) on delete cascade,
  bem_id uuid references public.af_bens(id) on delete cascade,       -- vazio = achado sem cadastro
  descricao text,
  encontrado boolean not null default true,
  local_encontrado text,
  estado text check (estado in ('bom', 'regular', 'ruim', 'inservivel')),
  observacao text,
  conferido_por text default (auth.jwt() ->> 'email'), conferido_em timestamptz not null default now()
);
create unique index if not exists af_inv_item_bem on public.af_inventario_itens(inventario_id, bem_id) where bem_id is not null;

-- 7) anexos (NF, laudo, foto) e candidatos descartados
create table if not exists public.af_anexos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  bem_id uuid not null references public.af_bens(id) on delete cascade,
  caminho text not null, nome text not null, tipo text not null default 'documento' check (tipo in ('foto', 'nota', 'laudo', 'documento')),
  criado_por text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now()
);
create table if not exists public.af_ignorados (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  origem text not null check (origem in ('nfe', 'lancamento', 'maquina', 'veiculo')),
  ref_id uuid not null,
  motivo text,
  usuario text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now(),
  primary key (empresa_id, origem, ref_id)
);

-- 8) acesso: lê quem é membro (como a contabilidade); grava quem edita
do $$ declare t text; begin
  foreach t in array array['af_parametros', 'af_classes', 'af_bens', 'af_calculos', 'af_depreciacoes', 'af_movimentos', 'af_inventarios', 'af_inventario_itens', 'af_anexos', 'af_ignorados'] loop
    execute format('alter table public.%s enable row level security', t);
    execute format('drop policy if exists %1$s_sel on public.%1$s; drop policy if exists %1$s_ins on public.%1$s; drop policy if exists %1$s_upd on public.%1$s; drop policy if exists %1$s_del on public.%1$s;', t);
    execute format('create policy %1$s_sel on public.%1$s for select to authenticated using (public.is_membro(empresa_id))', t);
  end loop;
  -- escrita direta: cadastros e inventário. Cálculo, depreciações e baixas só pelas funções.
  foreach t in array array['af_parametros', 'af_classes', 'af_bens', 'af_inventarios', 'af_inventario_itens', 'af_anexos', 'af_ignorados'] loop
    execute format('create policy %1$s_ins on public.%1$s for insert to authenticated with check (public.pode_editar(empresa_id))', t);
    execute format('create policy %1$s_upd on public.%1$s for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id))', t);
    execute format('create policy %1$s_del on public.%1$s for delete to authenticated using (public.pode_editar(empresa_id))', t);
    execute format('grant select, insert, update, delete on public.%s to authenticated', t);
  end loop;
  foreach t in array array['af_calculos', 'af_depreciacoes', 'af_movimentos'] loop
    execute format('grant select on public.%s to authenticated', t);
  end loop;
end $$;
grant usage, select on sequence public.af_depreciacoes_id_seq, public.af_movimentos_id_seq to authenticated;

-- 9) regras do bem: numeração, plaqueta, mesma empresa, travas e histórico
create or replace function public._af_bem_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pref text; v_fech date;
begin
  if not exists (select 1 from af_classes where id = new.classe_id and empresa_id = new.empresa_id) then raise exception 'Classe de outra empresa.'; end if;
  if new.centro_custo_id is not null and not exists (select 1 from centros_custo where id = new.centro_custo_id and empresa_id = new.empresa_id) then raise exception 'Centro de custo de outra empresa.'; end if;
  if new.pai_id is not null and (new.pai_id = new.id or not exists (select 1 from af_bens where id = new.pai_id and empresa_id = new.empresa_id)) then raise exception 'Bem principal inválido.'; end if;
  if new.data_corte is not null and new.data_corte <> (date_trunc('month', new.data_corte) + interval '1 month - 1 day')::date then
    raise exception 'A data de corte da implantação tem de ser o último dia de um mês.'; end if;
  if new.data_inicio_uso is not null and new.data_inicio_uso < new.data_aquisicao then raise exception 'O início de uso não pode ser antes da aquisição.'; end if;
  new.atualizado_em := now();
  if tg_op = 'INSERT' then
    if new.numero is null or new.numero <= 0 then
      perform pg_advisory_xact_lock(hashtext('af_bens:' || new.empresa_id::text));
      select coalesce(max(numero), 0) + 1 into new.numero from af_bens where empresa_id = new.empresa_id;
    end if;
    if coalesce(trim(new.plaqueta), '') = '' then
      select coalesce(nullif(trim(prefixo), ''), 'PAT') into v_pref from af_parametros where empresa_id = new.empresa_id;
      new.plaqueta := coalesce(v_pref, 'PAT') || '-' || lpad(new.numero::text, 6, '0');
    end if;
    return new;
  end if;
  if new.empresa_id <> old.empresa_id then raise exception 'Não é possível mudar a empresa do bem.'; end if;
  -- o que muda o valor já contabilizado não pode mudar depois de um mês fechado
  select max(c.competencia) into v_fech from af_depreciacoes dp join af_calculos c on c.id = dp.calculo_id
   where dp.bem_id = old.id and c.situacao = 'fechado';
  if v_fech is not null and (new.valor_aquisicao, new.valor_residual, coalesce(new.data_inicio_uso, new.data_aquisicao), new.classe_id, new.deprec_inicial, new.meses_iniciais, new.data_corte)
       is distinct from (old.valor_aquisicao, old.valor_residual, coalesce(old.data_inicio_uso, old.data_aquisicao), old.classe_id, old.deprec_inicial, old.meses_iniciais, old.data_corte) then
    raise exception 'O bem % já tem depreciação em mês fechado (%). Valor, classe, residual, início de uso e implantação não mudam; use a revisão de vida útil ou reabra o mês.', old.plaqueta, to_char(v_fech, 'MM/YYYY');
  end if;
  if new.situacao = 'baixado' and old.situacao <> 'baixado' and current_setting('af.baixa', true) is distinct from 'on' then raise exception 'Use "Baixar bem" para registrar a baixa.'; end if;
  if old.situacao = 'baixado' and new.situacao <> 'baixado' and current_setting('af.baixa', true) is distinct from 'on' then raise exception 'Use "Desfazer baixa".'; end if;
  -- histórico
  if (new.centro_custo_id, new.local, new.responsavel) is distinct from (old.centro_custo_id, old.local, old.responsavel) then
    insert into af_movimentos(empresa_id, bem_id, tipo, de, para)
    values (new.empresa_id, new.id, 'transferencia', jsonb_build_object('centro_custo_id', old.centro_custo_id, 'local', old.local, 'responsavel', old.responsavel),
            jsonb_build_object('centro_custo_id', new.centro_custo_id, 'local', new.local, 'responsavel', new.responsavel));
  end if;
  if (new.vida_util_meses, new.valor_residual, new.taxa_fiscal) is distinct from (old.vida_util_meses, old.valor_residual, old.taxa_fiscal) then
    insert into af_movimentos(empresa_id, bem_id, tipo, de, para)
    values (new.empresa_id, new.id, 'revisao', jsonb_build_object('vida_util_meses', old.vida_util_meses, 'valor_residual', old.valor_residual, 'taxa_fiscal', old.taxa_fiscal),
            jsonb_build_object('vida_util_meses', new.vida_util_meses, 'valor_residual', new.valor_residual, 'taxa_fiscal', new.taxa_fiscal));
  end if;
  if new.situacao <> old.situacao and 'baixado' not in (new.situacao, old.situacao) then
    insert into af_movimentos(empresa_id, bem_id, tipo, de, para) values (new.empresa_id, new.id, 'situacao', jsonb_build_object('situacao', old.situacao), jsonb_build_object('situacao', new.situacao));
  end if;
  return new;
end $$;
drop trigger if exists af_bens_regras on public.af_bens;
create trigger af_bens_regras before insert or update on public.af_bens for each row execute function public._af_bem_regras();

create or replace function public._af_bem_aquisicao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into af_movimentos(empresa_id, bem_id, tipo, data, para)
  values (new.empresa_id, new.id, 'aquisicao', new.data_aquisicao, jsonb_build_object('valor', new.valor_aquisicao, 'classe_id', new.classe_id, 'centro_custo_id', new.centro_custo_id, 'local', new.local));
  return null;
end $$;
drop trigger if exists af_bens_aquisicao on public.af_bens;
create trigger af_bens_aquisicao after insert on public.af_bens for each row execute function public._af_bem_aquisicao();

-- a conta contábil da classe e a da baixa têm de ser da mesma empresa
create or replace function public._af_contas_empresa() returns trigger
language plpgsql set search_path = public as $$
declare c uuid; j jsonb := to_jsonb(new);
begin
  foreach c in array array[(j ->> 'conta_ativo_id')::uuid, (j ->> 'conta_deprec_id')::uuid, (j ->> 'conta_despesa_id')::uuid, (j ->> 'conta_custo_baixa_id')::uuid] loop
    if c is not null and not exists (select 1 from contab_contas where id = c and empresa_id = new.empresa_id) then raise exception 'Conta contábil de outra empresa.'; end if;
  end loop;
  if tg_table_name = 'af_parametros' then new.atualizado_por := auth.jwt() ->> 'email'; new.atualizado_em := now(); end if;
  return new;
end $$;
drop trigger if exists af_classes_contas on public.af_classes;
create trigger af_classes_contas before insert or update on public.af_classes for each row execute function public._af_contas_empresa();
drop trigger if exists af_parametros_contas on public.af_parametros;
create trigger af_parametros_contas before insert or update on public.af_parametros for each row execute function public._af_contas_empresa();

-- numeração do inventário; item do inventário é do mesmo inventário/empresa e só entra com inventário aberto
create or replace function public._af_inventario_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'af_inventarios' then
    if tg_op = 'INSERT' and (new.numero is null or new.numero <= 0) then
      perform pg_advisory_xact_lock(hashtext('af_inv:' || new.empresa_id::text));
      select coalesce(max(numero), 0) + 1 into new.numero from af_inventarios where empresa_id = new.empresa_id;
    end if;
    return new;
  end if;
  if not exists (select 1 from af_inventarios where id = new.inventario_id and empresa_id = new.empresa_id and situacao = 'aberto') then
    raise exception 'Inventário concluído ou de outra empresa.'; end if;
  if new.bem_id is not null and not exists (select 1 from af_bens where id = new.bem_id and empresa_id = new.empresa_id) then raise exception 'Bem de outra empresa.'; end if;
  new.conferido_por := auth.jwt() ->> 'email'; new.conferido_em := now();
  return new;
end $$;
drop trigger if exists af_inventarios_regras on public.af_inventarios;
create trigger af_inventarios_regras before insert on public.af_inventarios for each row execute function public._af_inventario_regras();
drop trigger if exists af_inv_itens_regras on public.af_inventario_itens;
create trigger af_inv_itens_regras before insert or update on public.af_inventario_itens for each row execute function public._af_inventario_regras();

-- 10) classes padrão (taxas fiscais do Anexo III da IN RFB 1.700/2017; vida útil contábil inicial = vida fiscal)
create or replace function public.af_classes_padrao(p_empresa uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.pode_editar(p_empresa) then raise exception 'Sem permissão.'; end if;
  insert into af_parametros(empresa_id) values (p_empresa) on conflict do nothing;
  insert into af_classes(empresa_id, codigo, nome, deprecia, taxa_fiscal, vida_util_meses, credito_pis_cofins, ciap, observacao)
  select p_empresa, x.c, x.n, x.d, x.t, x.v, x.pc, x.ci, x.o from (values
    ('TER',  'Terrenos',                                   false, 0,   1,   'nenhum',      false, 'Terreno não deprecia (IN RFB 1.700/2017, art. 124).'),
    ('EDI',  'Edificações e construções',                  true,  4,   300, 'depreciacao', false, 'Anexo III: 25 anos, 4% a.a.'),
    ('INS',  'Instalações',                                true,  10,  120, 'depreciacao', false, 'Anexo III: 10 anos, 10% a.a.'),
    ('MAQ',  'Máquinas e equipamentos industriais',        true,  10,  120, 'imediato',    true,  'Anexo III: 10% a.a. Crédito imediato de PIS/COFINS para máquinas da produção adquiridas desde 07/2012 (Lei 11.774/2008, art. 1º, XII).'),
    ('EMP',  'Empilhadeiras e movimentação',               true,  10,  120, 'nenhum',      false, 'Anexo III (NCM 8427): 10% a.a.'),
    ('VCG',  'Caminhões e veículos de carga',              true,  25,  48,  'nenhum',      false, 'Anexo III (NCM 8704): 25% a.a. Veículos não têm crédito imediato (SC Cosit 215/2017).'),
    ('VPS',  'Automóveis de passageiros',                  true,  20,  60,  'nenhum',      false, 'Anexo III (NCM 8703): 20% a.a.'),
    ('INF',  'Computadores e periféricos',                 true,  20,  60,  'nenhum',      false, 'Anexo III (NCM 8471): 20% a.a.'),
    ('MOV',  'Móveis e utensílios',                        true,  10,  120, 'nenhum',      false, 'Anexo III (NCM 9403): 10% a.a.'),
    ('FER',  'Ferramentas, clichês e cilindros',           true,  20,  60,  'nenhum',      false, 'Anexo III (ferramentas): 20% a.a. Confirmar com a contabilidade o tratamento de clichês e cilindros.'),
    ('SOF',  'Softwares e licenças (intangível)',          true,  20,  60,  'nenhum',      false, 'Amortização, 5 anos.')
  ) as x(c, n, d, t, v, pc, ci, o)
  on conflict (empresa_id, codigo) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 11) cálculo do mês (prévia ou gravação) e lançamento contábil
--  quota = (custo − residual − acumulada) ÷ (vida útil − meses já depreciados) × fração do mês; o último mês leva o resto.
--  Assim a revisão de vida útil e a implantação de bens antigos entram sem recalcular o passado.
create or replace function public.af_calcular(p_empresa uuid, p_competencia date, p_gravar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c date := date_trunc('month', p_competencia)::date;
  fim date := (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date;
  dias numeric := extract(day from (date_trunc('month', p_competencia) + interval '1 month - 1 day'));
  pr af_parametros; v_calc uuid; v_lanc uuid; v_ant date; v_pend jsonb; r record; v_res jsonb;
begin
  if not public.pode_editar(p_empresa) then raise exception 'Sem permissão.'; end if;
  select * into pr from af_parametros where empresa_id = p_empresa;
  if pr.empresa_id is null then insert into af_parametros(empresa_id) values (p_empresa) returning * into pr; end if;
  if exists (select 1 from af_calculos where empresa_id = p_empresa and competencia = c and situacao = 'fechado') then
    raise exception 'O mês % está fechado. Reabra para calcular de novo.', to_char(c, 'MM/YYYY'); end if;
  -- meses em sequência: depois do primeiro cálculo, o mês anterior tem de estar calculado
  select max(competencia) into v_ant from af_calculos where empresa_id = p_empresa and competencia < c;
  if v_ant is not null and v_ant <> (c - interval '1 month')::date then
    raise exception 'Calcule antes %: os meses vão em sequência.', to_char(v_ant + interval '1 month', 'MM/YYYY'); end if;
  if exists (select 1 from af_calculos where empresa_id = p_empresa and competencia > c and situacao = 'fechado') then
    raise exception 'Há mês posterior fechado. Reabra-o antes de recalcular %.', to_char(c, 'MM/YYYY'); end if;

  if to_regclass('pg_temp._af') is not null then drop table pg_temp._af; end if;
  create temp table _af on commit drop as
  with b as (
    select b.*, k.deprecia, k.conta_ativo_id, k.conta_deprec_id, k.conta_despesa_id, k.codigo as classe_cod, k.nome as classe_nome,
           coalesce(b.data_inicio_uso, b.data_aquisicao) as inicio,
           date_trunc('month', coalesce(b.data_inicio_uso, b.data_aquisicao))::date as mes_ini,
           coalesce((select sum(d.valor) from af_depreciacoes d where d.bem_id = b.id and d.competencia < c), 0) + b.deprec_inicial as acum_ant,
           coalesce((select sum(d.valor_fiscal) from af_depreciacoes d where d.bem_id = b.id and d.competencia < c), 0) + b.deprec_inicial as acumf_ant,
           coalesce((select sum(d.meses) from af_depreciacoes d where d.bem_id = b.id and d.competencia < c), 0) + b.meses_iniciais as usados
      from af_bens b join af_classes k on k.id = b.classe_id
     where b.empresa_id = p_empresa
       and (b.baixa_data is null or b.baixa_data >= c)
       and (b.data_corte is null or b.data_corte < c)
  ), f as (
    select b.*,
      case
        when not b.deprecia then 0::numeric
        when pr.regra_inicio = 'mes_seguinte' and c <= b.mes_ini then 0
        when c < b.mes_ini then 0
        when b.baixa_data between c and fim and pr.regra_inicio = 'mes_seguinte' then 0
        when pr.regra_inicio = 'pro_rata_dia' then
          round((extract(day from least(coalesce(b.baixa_data, fim), fim)) - (case when c = b.mes_ini then extract(day from b.inicio) else 1 end) + 1) / dias, 4)
        else 1
      end as fr
    from b
  )
  select f.*,
    greatest(0, least(f.valor_aquisicao - f.valor_residual - f.acum_ant,
      case when f.fr <= 0 then 0
           when f.vida_util_meses - f.usados <= f.fr then f.valor_aquisicao - f.valor_residual - f.acum_ant
           else round((f.valor_aquisicao - f.valor_residual - f.acum_ant) / (f.vida_util_meses - f.usados) * f.fr, 2) end)) as quota,
    greatest(0, least(f.valor_aquisicao - f.acumf_ant, case when f.fr <= 0 then 0 else round(f.valor_aquisicao * f.taxa_fiscal / 1200 * f.fr, 2) end)) as quota_fiscal
  from f;

  select coalesce(jsonb_agg(x order by x ->> 'motivo'), '[]'::jsonb) into v_pend from (
    select jsonb_build_object('motivo', 'Classe sem contas contábeis de depreciação', 'classe', classe_cod || ' ' || classe_nome, 'qtd', count(*), 'valor', sum(quota)) x
      from _af where quota > 0 and (conta_deprec_id is null or conta_despesa_id is null) group by classe_cod, classe_nome
    union all
    select jsonb_build_object('motivo', 'Baixa sem conta do bem, da depreciação acumulada ou do custo da baixa', 'classe', classe_cod || ' ' || classe_nome, 'qtd', count(*), 'valor', sum(valor_aquisicao))
      from _af where baixa_data between c and fim and (conta_ativo_id is null or conta_deprec_id is null or pr.conta_custo_baixa_id is null) group by classe_cod, classe_nome
  ) t;

  v_res := jsonb_build_object(
    'competencia', c, 'qtd', (select count(*) from _af where quota > 0), 'total', (select coalesce(sum(quota), 0) from _af),
    'total_fiscal', (select coalesce(sum(quota_fiscal), 0) from _af), 'baixas', (select count(*) from _af where baixa_data between c and fim),
    'pendencias', v_pend,
    'classes', (select coalesce(jsonb_agg(jsonb_build_object('classe', classe_cod || ' ' || classe_nome, 'qtd', qtd, 'valor', v, 'fiscal', vf) order by classe_cod), '[]'::jsonb)
                  from (select classe_cod, classe_nome, count(*) qtd, sum(quota) v, sum(quota_fiscal) vf from _af where quota > 0 or quota_fiscal > 0 group by classe_cod, classe_nome) s),
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('bem_id', id, 'plaqueta', plaqueta, 'meses', fr, 'valor', quota, 'fiscal', quota_fiscal, 'acumulada', acum_ant + quota) order by numero), '[]'::jsonb)
                from _af where quota > 0 or quota_fiscal > 0));
  if not p_gravar then return v_res; end if;

  -- grava (refaz o mês)
  delete from contab_lancamentos where empresa_id = p_empresa and origem = 'depreciacao'
     and origem_id in (select id from af_calculos where empresa_id = p_empresa and competencia = c);
  delete from af_calculos where empresa_id = p_empresa and competencia = c;
  insert into af_calculos(empresa_id, competencia, qtd, total, total_fiscal, baixas, pendencias)
  values (p_empresa, c, (v_res ->> 'qtd')::int, (v_res ->> 'total')::numeric, (v_res ->> 'total_fiscal')::numeric, (v_res ->> 'baixas')::int, v_pend)
  returning id into v_calc;
  insert into af_depreciacoes(empresa_id, calculo_id, bem_id, competencia, meses, valor, acumulada, valor_fiscal, centro_custo_id)
  select p_empresa, v_calc, id, c, fr, quota, acum_ant + quota, quota_fiscal, centro_custo_id from _af where quota > 0 or quota_fiscal > 0;

  if pr.gerar_contabil then
    -- depreciação do mês: D despesa / C depreciação acumulada, por conta
    if exists (select 1 from _af where quota > 0 and conta_deprec_id is not null and conta_despesa_id is not null) then
      insert into contab_lancamentos(empresa_id, data, historico, origem, origem_id)
      values (p_empresa, fim, 'Depreciação do imobilizado ' || to_char(c, 'MM/YYYY'), 'depreciacao', v_calc) returning id into v_lanc;
      insert into contab_partidas(lancamento_id, conta_id, debito, credito)
      select v_lanc, conta_despesa_id, sum(quota), 0 from _af where quota > 0 and conta_deprec_id is not null and conta_despesa_id is not null group by conta_despesa_id
      union all
      select v_lanc, conta_deprec_id, 0, sum(quota) from _af where quota > 0 and conta_deprec_id is not null and conta_despesa_id is not null group by conta_deprec_id;
    end if;
    -- baixas do mês: C bem (custo) / D depreciação acumulada / D custo do bem baixado (valor contábil líquido)
    for r in select * from _af where baixa_data between c and fim and conta_ativo_id is not null and conta_deprec_id is not null and pr.conta_custo_baixa_id is not null loop
      insert into contab_lancamentos(empresa_id, data, historico, origem, origem_id)
      values (p_empresa, r.baixa_data, left('Baixa do bem ' || r.plaqueta || ' ' || r.descricao || ' (' || r.baixa_tipo || ')', 300), 'depreciacao', v_calc) returning id into v_lanc;
      insert into contab_partidas(lancamento_id, conta_id, debito, credito)
      select v_lanc, conta, d, cr from (values
        (r.conta_ativo_id, 0::numeric, r.valor_aquisicao),
        (r.conta_deprec_id, r.acum_ant + r.quota, 0::numeric),
        (pr.conta_custo_baixa_id, r.valor_aquisicao - r.acum_ant - r.quota, 0::numeric)) as x(conta, d, cr)
       where d + cr > 0;
    end loop;
  end if;
  return v_res || jsonb_build_object('calculo_id', v_calc, 'gravado', true);
end $$;

-- 12) fechar / reabrir o mês (reabrir só administrador; só o último fechado)
create or replace function public.af_fechar(p_empresa uuid, p_competencia date, p_fechar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c date := date_trunc('month', p_competencia)::date;
begin
  if not public.pode_editar(p_empresa) then raise exception 'Sem permissão.'; end if;
  if p_fechar then
    if not exists (select 1 from af_calculos where empresa_id = p_empresa and competencia = c) then raise exception 'Calcule o mês antes de fechar.'; end if;
    if exists (select 1 from af_calculos where empresa_id = p_empresa and competencia < c and situacao <> 'fechado') then raise exception 'Feche antes os meses anteriores.'; end if;
    update af_calculos set situacao = 'fechado', fechado_por = auth.jwt() ->> 'email', fechado_em = now() where empresa_id = p_empresa and competencia = c;
  else
    if not public.is_admin(p_empresa) then raise exception 'Só o administrador reabre um mês do imobilizado.'; end if;
    if exists (select 1 from af_calculos where empresa_id = p_empresa and competencia > c and situacao = 'fechado') then raise exception 'Reabra antes os meses posteriores.'; end if;
    update af_calculos set situacao = 'calculado', fechado_por = null, fechado_em = null where empresa_id = p_empresa and competencia = c;
  end if;
end $$;

-- 13) baixa e desfazer baixa
create or replace function public.af_baixar(p_bem uuid, p_data date, p_tipo text, p_valor numeric, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare b af_bens;
begin
  select * into b from af_bens where id = p_bem;
  if b.id is null or not public.pode_editar(b.empresa_id) then raise exception 'Sem permissão.'; end if;
  if b.situacao = 'baixado' then raise exception 'O bem já está baixado.'; end if;
  if p_data < coalesce(b.data_inicio_uso, b.data_aquisicao) then raise exception 'A baixa não pode ser antes da aquisição.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da baixa.'; end if;
  if exists (select 1 from af_calculos where empresa_id = b.empresa_id and competencia >= date_trunc('month', p_data)::date and situacao = 'fechado') then
    raise exception 'O mês da baixa (ou um posterior) já está fechado.'; end if;
  if exists (select 1 from af_depreciacoes where bem_id = b.id and competencia > date_trunc('month', p_data)::date) then
    raise exception 'Há depreciação calculada depois da data da baixa. Recalcule a partir do mês da baixa depois de baixar (ou escolha outra data).'; end if;
  perform set_config('af.baixa', 'on', true);
  update af_bens set situacao = 'baixado', baixa_data = p_data, baixa_tipo = p_tipo, baixa_valor = p_valor, baixa_motivo = p_motivo where id = b.id;
  perform set_config('af.baixa', 'off', true);
  insert into af_movimentos(empresa_id, bem_id, tipo, data, de, para, observacao)
  values (b.empresa_id, b.id, 'baixa', p_data, jsonb_build_object('situacao', b.situacao), jsonb_build_object('tipo', p_tipo, 'valor', p_valor), p_motivo);
end $$;

create or replace function public.af_desfazer_baixa(p_bem uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare b af_bens;
begin
  select * into b from af_bens where id = p_bem;
  if b.id is null or not public.pode_editar(b.empresa_id) then raise exception 'Sem permissão.'; end if;
  if b.situacao <> 'baixado' then raise exception 'O bem não está baixado.'; end if;
  if exists (select 1 from af_calculos where empresa_id = b.empresa_id and competencia >= date_trunc('month', b.baixa_data)::date and situacao = 'fechado') then
    raise exception 'O mês da baixa já está fechado. Reabra-o antes.'; end if;
  perform set_config('af.baixa', 'on', true);
  update af_bens set situacao = 'em_uso', baixa_data = null, baixa_tipo = null, baixa_valor = null, baixa_motivo = null where id = b.id;
  perform set_config('af.baixa', 'off', true);
  insert into af_movimentos(empresa_id, bem_id, tipo, data, de, observacao)
  values (b.empresa_id, b.id, 'reativacao', current_date, jsonb_build_object('baixa_data', b.baixa_data, 'tipo', b.baixa_tipo), p_motivo);
end $$;

-- 14) candidatos a imobilizar: NF-e de entrada (NCM de bem durável e valor unitário ≥ mínimo, ou produto do tipo 08),
--     lançamentos pagos nas classificações de compra de bens, máquinas e veículos próprios sem bem
create or replace function public.af_candidatos(p_empresa uuid, p_ini date, p_fim date)
returns table(origem text, ref_id uuid, data date, documento text, fornecedor text, favorecido_id uuid, descricao text, ncm text,
              quantidade numeric, valor numeric, icms numeric, ipi numeric, nota_id uuid, motivo text)
language plpgsql security definer set search_path = public as $$
declare v_ncm text[]; v_min numeric; v_planos uuid[];
begin
  if not public.pode_editar(p_empresa) then raise exception 'Sem permissão.'; end if;
  insert into af_parametros(empresa_id) values (p_empresa) on conflict do nothing;   -- sem parâmetros gravados: os padrões
  select ncm_imobilizado, valor_minimo, planos_imobilizado into v_ncm, v_min, v_planos from af_parametros where empresa_id = p_empresa;
  return query
  select 'nfe'::text, i.id, n.emissao, 'NF ' || n.numero, n.emit_nome, n.favorecido_id, i.xprod, i.ncm, i.qcom,
         coalesce(i.vprod, 0) - coalesce(i.vdesc, 0) + coalesce(i.vfrete, 0) + coalesce(i.voutro, 0) + coalesce(i.v_ipi, 0) + coalesce(i.v_st, 0),
         coalesce(i.v_icms, 0), coalesce(i.v_ipi, 0), n.id,
         case when t08.ok then 'Produto do tipo 08 (ativo imobilizado)' else 'NCM de bem durável e valor unitário a partir do mínimo' end
    from nfe_notas n join nfe_itens i on i.nota_id = n.id
    cross join lateral (select exists (select 1 from produto_fornecedores pf join produtos pd on pd.id = pf.produto_id
                         where pf.empresa_id = p_empresa and pf.emit_doc = n.emit_doc and pf.codigo_fornecedor = i.cprod and pd.tipo_sped = '08') as ok) t08
   where n.empresa_id = p_empresa
     and n.situacao = 'autorizada' and (n.tipo = 'entrada' or not n.emissao_propria) and coalesce(n.finalidade, '1') = '1'
     and n.emissao between p_ini and p_fim
     and (t08.ok or (left(coalesce(i.ncm, ''), 4) = any (coalesce(v_ncm, '{}'))
                     and (coalesce(i.vprod, 0) - coalesce(i.vdesc, 0)) / nullif(i.qcom, 0) >= coalesce(v_min, 1200)))
     and not exists (select 1 from af_bens b where b.nfe_item_id = i.id)
     and not exists (select 1 from af_ignorados g where g.empresa_id = p_empresa and g.origem = 'nfe' and g.ref_id = i.id)
  union all
  select 'lancamento'::text, l.id, l.data, coalesce(l.documento, ''), f.nome, l.favorecido_id, coalesce(l.descricao, p.nome), null::text, 1::numeric, abs(l.valor), 0::numeric, 0::numeric, null::uuid,
         'Classificação de compra de bens: ' || p.codigo || ' ' || p.nome
    from lancamentos l join plano_contas p on p.id = l.plano_id left join favorecidos f on f.id = l.favorecido_id
   where l.empresa_id = p_empresa and l.status = 'Pago' and l.data between p_ini and p_fim
     and l.plano_id = any (coalesce(v_planos, '{}'))
     and not exists (select 1 from af_bens b where b.lancamento_id = l.id)
     and not exists (select 1 from af_ignorados g where g.empresa_id = p_empresa and g.origem = 'lancamento' and g.ref_id = l.id)
  union all
  select 'maquina'::text, m.id, null::date, m.codigo, null::text, null::uuid, m.nome, null::text, 1::numeric, null::numeric, null::numeric, null::numeric, null::uuid,
         'Máquina da produção sem bem no imobilizado'
    from prod_maquinas m
   where m.empresa_id = p_empresa and m.ativo
     and not exists (select 1 from af_bens b where b.maquina_id = m.id)
     and not exists (select 1 from af_ignorados g where g.empresa_id = p_empresa and g.origem = 'maquina' and g.ref_id = m.id)
  union all
  select 'veiculo'::text, v.id, null::date, coalesce(v.placa, v.codigo), null::text, null::uuid, coalesce(v.marca_modelo, v.codigo), null::text, 1::numeric, null::numeric, null::numeric, null::numeric, null::uuid,
         'Veículo próprio sem bem no imobilizado'
    from log_veiculos v
   where v.empresa_id = p_empresa and coalesce(v.propriedade, 'proprio') = 'proprio'
     and not exists (select 1 from af_bens b where b.veiculo_id = v.id)
     and not exists (select 1 from af_ignorados g where g.empresa_id = p_empresa and g.origem = 'veiculo' and g.ref_id = v.id);
end $$;

-- 15) concluir inventário: grava o resumo e registra no histórico dos bens o local e o estado encontrados
create or replace function public.af_concluir_inventario(p_inventario uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare iv af_inventarios; v jsonb;
begin
  select * into iv from af_inventarios where id = p_inventario;
  if iv.id is null or not public.pode_editar(iv.empresa_id) then raise exception 'Sem permissão.'; end if;
  if iv.situacao <> 'aberto' then raise exception 'Inventário já concluído.'; end if;
  with alvo as (
    select b.* from af_bens b where b.empresa_id = iv.empresa_id and b.situacao <> 'baixado' and b.data_aquisicao <= iv.data_inicio
      and (iv.filtro ->> 'centro_custo_id' is null or b.centro_custo_id = (iv.filtro ->> 'centro_custo_id')::uuid)
      and (iv.filtro ->> 'classe_id' is null or b.classe_id = (iv.filtro ->> 'classe_id')::uuid)
      and (coalesce(iv.filtro ->> 'local', '') = '' or b.local = iv.filtro ->> 'local')
  )
  select jsonb_build_object(
    'esperados', (select count(*) from alvo),
    'encontrados', (select count(*) from alvo a join af_inventario_itens i on i.bem_id = a.id and i.inventario_id = iv.id and i.encontrado),
    'nao_encontrados', (select count(*) from alvo a where not exists (select 1 from af_inventario_itens i where i.bem_id = a.id and i.inventario_id = iv.id and i.encontrado)),
    'valor_nao_encontrado', (select coalesce(sum(a.valor_aquisicao), 0) from alvo a where not exists (select 1 from af_inventario_itens i where i.bem_id = a.id and i.inventario_id = iv.id and i.encontrado)),
    'local_divergente', (select count(*) from alvo a join af_inventario_itens i on i.bem_id = a.id and i.inventario_id = iv.id
                          where i.encontrado and coalesce(i.local_encontrado, '') <> '' and coalesce(a.local, '') <> i.local_encontrado),
    'fora_do_escopo', (select count(*) from af_inventario_itens i where i.inventario_id = iv.id and i.bem_id is not null and not exists (select 1 from alvo a where a.id = i.bem_id)),
    'sem_cadastro', (select count(*) from af_inventario_itens i where i.inventario_id = iv.id and i.bem_id is null),
    'estado_ruim', (select count(*) from af_inventario_itens i where i.inventario_id = iv.id and i.estado in ('ruim', 'inservivel'))) into v;
  insert into af_movimentos(empresa_id, bem_id, tipo, data, para, observacao)
  select iv.empresa_id, i.bem_id, 'inventario', iv.data_inicio, jsonb_build_object('inventario', iv.numero, 'local', i.local_encontrado, 'estado', i.estado), i.observacao
    from af_inventario_itens i where i.inventario_id = iv.id and i.bem_id is not null and i.encontrado;
  update af_inventarios set situacao = 'concluido', resumo = v, concluido_em = now(), concluido_por = auth.jwt() ->> 'email' where id = iv.id;
  return v;
end $$;

revoke all on function public.af_classes_padrao(uuid), public.af_calcular(uuid, date, boolean), public.af_fechar(uuid, date, boolean),
  public.af_baixar(uuid, date, text, numeric, text), public.af_desfazer_baixa(uuid, text), public.af_candidatos(uuid, date, date),
  public.af_concluir_inventario(uuid) from public, anon;
grant execute on function public.af_classes_padrao(uuid), public.af_calcular(uuid, date, boolean), public.af_fechar(uuid, date, boolean),
  public.af_baixar(uuid, date, text, numeric, text), public.af_desfazer_baixa(uuid, text), public.af_candidatos(uuid, date, date),
  public.af_concluir_inventario(uuid) to authenticated;
revoke all on function public._af_bem_regras(), public._af_bem_aquisicao(), public._af_contas_empresa(), public._af_inventario_regras() from public, anon, authenticated;

-- 16) arquivos: patrimonio/<empresa>/<bem>/<arquivo>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patrimonio', 'patrimonio', false, 15728640, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists patrimonio_arq_sel on storage.objects;
drop policy if exists patrimonio_arq_ins on storage.objects;
drop policy if exists patrimonio_arq_upd on storage.objects;
drop policy if exists patrimonio_arq_del on storage.objects;
create policy patrimonio_arq_sel on storage.objects for select to authenticated using (bucket_id = 'patrimonio' and public.is_membro(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy patrimonio_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'patrimonio' and public.pode_editar(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy patrimonio_arq_upd on storage.objects for update to authenticated using (bucket_id = 'patrimonio' and public.pode_editar(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy patrimonio_arq_del on storage.objects for delete to authenticated using (bucket_id = 'patrimonio' and public.pode_editar(public._uuid_ou_nulo((storage.foldername(name))[1])));

-- 17) auditoria
do $$ declare t text; begin
  if to_regprocedure('public._auditar()') is not null then
    foreach t in array array['af_parametros', 'af_classes', 'af_bens', 'af_calculos', 'af_inventarios', 'af_anexos', 'af_ignorados'] loop
      execute format('drop trigger if exists zz_auditoria on public.%s', t);
      execute format('create trigger zz_auditoria after insert or update or delete on public.%s for each row execute function public._auditar()', t);
    end loop;
  end if;
end $$;

-- conferência: tabelas = 10, funções = 7, bucket = 1
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'af\_%') as tabelas,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
         ('af_classes_padrao', 'af_calcular', 'af_fechar', 'af_baixar', 'af_desfazer_baixa', 'af_candidatos', 'af_concluir_inventario')) as funcoes,
       (select count(*) from storage.buckets where id = 'patrimonio') as bucket;
