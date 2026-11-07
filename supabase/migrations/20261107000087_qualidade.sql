-- =====================================================================
-- Produção › Qualidade: inspeção com bloqueio de estoque (07/11/2026). Referência: ERP "Consultoria" (026_qualidade_bloqueio_estoque:
-- saldo_bloqueado no produto + inspeção aprova/reprova). Refeita e ligada ao estoque oficial, à produção e às notas:
--  - planos de inspeção por etapa (recebimento, processo, final) para o produto ou a família, com as características
--    (medida com nominal, mínimo e máximo; ou atributo), a amostragem (tabela por tamanho do lote, fixa ou 100%) e a
--    liberação do primeiro material (setup) na produção;
--  - RECEBIMENTO: a entrada da NF-e de um produto com plano vai para o local Quarentena (QUA) e abre a inspeção; nada sai
--    da quarentena sem a decisão. Aprovado → transferido para o local de destino; reprovado → local Reprovado (REP) + RNC.
--    Antes da implantação do estoque, "Buscar notas de entrada" abre as inspeções pelas notas, sem movimentar o estoque;
--  - PRODUÇÃO: bobina de OP com plano de liberação nasce bloqueada até a inspeção de liberação ser aprovada; OP concluída
--    com plano final abre a inspeção final; bobina bloqueada ou reprovada não é expedida nem consumida;
--  - BLOQUEIO de lote (estoque) ou de bobina a qualquer momento (reclamação de cliente, suspeita), com histórico;
--  - NÃO CONFORMIDADE (RNC): disposição executada no estoque (usar como está, retrabalho, reclassificar, sucatear,
--    devolver ao fornecedor — a NF de devolução baixa do local Reprovado), 5 porquês, ação corretiva, eficácia e custo.
-- Só cria objetos novos e colunas novas. Não altera movimentos, saldos nem bobinas que já existem.
-- =====================================================================

-- quem registra inspeção e RNC (inclui compras, que recebe, e produção, que inspeciona no processo)
create or replace function public.pode_qualidade(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao'));
$$;
revoke all on function public.pode_qualidade(uuid) from public, anon;
grant execute on function public.pode_qualidade(uuid) to authenticated;

-- 1) parâmetros (quem decide é configurável)
create table if not exists public.qual_parametros (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  inspecionar_recebimento boolean not null default true,     -- entrada de produto com plano vai para a quarentena
  local_quarentena_id uuid references public.est_locais(id) on delete set null,
  local_reprovado_id uuid references public.est_locais(id) on delete set null,
  prazo_horas int not null default 24,                       -- prazo para inspecionar
  papeis_decisao text[] not null default array['admin', 'diretor', 'financeiro'],
  meta_aprovacao_pct numeric(5,2) not null default 95,       -- meta de lotes aprovados (e do IQF do fornecedor)
  prazo_rnc_dias int not null default 15,                     -- prazo da ação corretiva
  atualizado_em timestamptz not null default now()
);

-- 2) amostragem: faixa do tamanho do lote → tamanho da amostra, aceita (Ac) e rejeita (Re) por defeitos
create table if not exists public.qual_amostragem (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  lote_min numeric(16,3) not null, lote_max numeric(16,3),
  amostra int not null check (amostra > 0),
  ac int not null default 0 check (ac >= 0), re int not null default 1,
  check (re > ac), check (lote_max is null or lote_max >= lote_min)
);
create index if not exists qual_amostragem_emp on public.qual_amostragem(empresa_id, lote_min);

-- 3) planos de inspeção
create table if not exists public.qual_planos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  etapa text not null check (etapa in ('recebimento', 'processo', 'final')),
  produto_id uuid references public.produtos(id) on delete cascade,
  familia_id uuid references public.est_familias(id) on delete cascade,
  setor_id uuid references public.prod_setores(id) on delete set null,   -- processo: o setor onde se inspeciona
  amostragem text not null default 'tabela' check (amostragem in ('tabela', 'fixa', 'cem')),
  amostra_fixa int check (amostra_fixa > 0),
  caracteristicas jsonb not null default '[]'::jsonb,   -- [{nome, tipo medida|atributo, unidade, nominal, min, max, metodo, critica}]
  exige_laudo boolean not null default false,           -- recebimento: certificado/laudo do fornecedor
  liberacao_primeira boolean not null default false,    -- processo: bobinas da OP ficam bloqueadas até a liberação
  instrucoes text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  check (produto_id is not null or familia_id is not null)
);
create index if not exists qual_planos_emp on public.qual_planos(empresa_id, etapa, ativo);

-- 4) inspeções
create table if not exists public.qual_inspecoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  etapa text not null check (etapa in ('recebimento', 'processo', 'final')),
  origem text not null default 'manual' check (origem in ('nfe', 'estoque', 'liberacao', 'op', 'manual', 'reclamacao')),
  plano_id uuid references public.qual_planos(id) on delete set null,
  produto_id uuid not null references public.produtos(id),
  lote_id uuid references public.est_lotes(id) on delete set null,
  lote_texto text,                                       -- lote do fornecedor / nº da bobina
  fornecedor_id uuid references public.favorecidos(id) on delete set null,
  nota_id uuid references public.nfe_notas(id) on delete set null,
  nfe_item_id uuid references public.nfe_itens(id) on delete set null,
  movimento_id uuid,                                     -- entrada no estoque que foi para a quarentena
  local_destino_id uuid references public.est_locais(id) on delete set null,
  ordem_id uuid references public.prod_ordens(id) on delete set null,
  etapa_op_id uuid references public.prod_ordem_etapas(id) on delete set null,
  bobina_id uuid references public.prod_bobinas(id) on delete set null,
  quantidade numeric(18,4), unidade text,
  amostra int, ac int, re int,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'em_inspecao', 'aprovada', 'aprovada_concessao', 'reprovada', 'cancelada')),
  resultados jsonb not null default '[]'::jsonb,         -- [{nome, valores[], defeitos, ok, obs}]
  defeitos int not null default 0,
  laudo_ok boolean,
  qtd_aprovada numeric(18,4), qtd_reprovada numeric(18,4),
  motivo text,                                           -- da concessão ou da reprovação
  inspetor text, inspecionada_em timestamptz,
  decidida_por text, decidida_em timestamptz,
  prazo timestamptz,
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists qual_insp_emp on public.qual_inspecoes(empresa_id, situacao);
create unique index if not exists qual_insp_mov on public.qual_inspecoes(movimento_id) where movimento_id is not null;
create unique index if not exists qual_insp_nfe on public.qual_inspecoes(nfe_item_id) where nfe_item_id is not null and situacao <> 'cancelada';

-- 5) não conformidades
create table if not exists public.qual_rnc (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  origem text not null default 'interna' check (origem in ('inspecao', 'processo', 'cliente', 'fornecedor', 'interna', 'auditoria')),
  inspecao_id uuid references public.qual_inspecoes(id) on delete set null,
  produto_id uuid references public.produtos(id) on delete set null,
  lote_id uuid references public.est_lotes(id) on delete set null,
  bobina_id uuid references public.prod_bobinas(id) on delete set null,
  ordem_id uuid references public.prod_ordens(id) on delete set null,
  favorecido_id uuid references public.favorecidos(id) on delete set null,   -- fornecedor ou cliente
  descricao text not null,
  quantidade numeric(18,4), unidade text,
  gravidade text not null default 'media' check (gravidade in ('baixa', 'media', 'alta', 'critica')),
  disposicao text not null default 'pendente' check (disposicao in ('pendente', 'usar_como_esta', 'retrabalho', 'reclassificar', 'sucatear', 'devolver_fornecedor')),
  disposicao_executada_em timestamptz, disposicao_obs text,
  porques jsonb not null default '[]'::jsonb,            -- 5 porquês: [texto, ...]
  causa text, acao_imediata text, acao_corretiva text,
  responsavel text, prazo date,
  eficacia text check (eficacia in ('eficaz', 'nao_eficaz')), eficacia_em date,
  custo numeric(14,2) not null default 0,                -- custo da não qualidade (perda, retrabalho, frete)
  situacao text not null default 'aberta' check (situacao in ('aberta', 'em_analise', 'acao', 'verificacao', 'encerrada', 'cancelada')),
  aberta_por text default (auth.jwt() ->> 'email'), aberta_em timestamptz not null default now(),
  encerrada_em timestamptz,
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists qual_rnc_emp on public.qual_rnc(empresa_id, situacao);

-- 6) bloqueios (lote do estoque ou bobina) e histórico
alter table public.est_lotes add column if not exists bloqueado boolean not null default false;
alter table public.est_lotes add column if not exists bloqueio_motivo text;
alter table public.prod_bobinas add column if not exists qualidade text not null default 'liberada';
alter table public.prod_bobinas add column if not exists qual_inspecao_id uuid references public.qual_inspecoes(id) on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'prod_bobinas_qualidade_chk') then
    alter table public.prod_bobinas add constraint prod_bobinas_qualidade_chk check (qualidade in ('liberada', 'bloqueada', 'reprovada'));
  end if;
end $$;
create table if not exists public.qual_bloqueios (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('lote', 'bobina')),
  lote_id uuid references public.est_lotes(id) on delete cascade,
  bobina_id uuid references public.prod_bobinas(id) on delete cascade,
  acao text not null check (acao in ('bloqueio', 'liberacao', 'reprovacao')),
  motivo text, inspecao_id uuid references public.qual_inspecoes(id) on delete set null, rnc_id uuid references public.qual_rnc(id) on delete set null,
  usuario text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now()
);
create index if not exists qual_bloq_emp on public.qual_bloqueios(empresa_id, criado_em desc);

create table if not exists public.qual_anexos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  inspecao_id uuid references public.qual_inspecoes(id) on delete cascade,
  rnc_id uuid references public.qual_rnc(id) on delete cascade,
  caminho text not null, nome text not null,
  tipo text not null default 'foto' check (tipo in ('foto', 'laudo', 'certificado', 'relatorio', 'documento')),
  criado_por text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now(),
  check (inspecao_id is not null or rnc_id is not null)
);

-- 7) acesso: lê quem participa da empresa; parâmetros, amostragem e planos: quem gerencia (pode_pcp);
--    inspeções, RNC e anexos: quem registra (pode_qualidade). Decisão, disposição e bloqueio só pelas funções.
do $$ declare t text; begin
  foreach t in array array['qual_parametros', 'qual_amostragem', 'qual_planos', 'qual_inspecoes', 'qual_rnc', 'qual_bloqueios', 'qual_anexos'] loop
    execute format('alter table public.%s enable row level security', t);
    execute format('drop policy if exists %1$s_sel on public.%1$s; drop policy if exists %1$s_ins on public.%1$s; drop policy if exists %1$s_upd on public.%1$s; drop policy if exists %1$s_del on public.%1$s;', t);
    execute format('create policy %1$s_sel on public.%1$s for select to authenticated using (public.is_participante(empresa_id))', t);
  end loop;
  foreach t in array array['qual_parametros', 'qual_amostragem', 'qual_planos'] loop
    execute format('create policy %1$s_ins on public.%1$s for insert to authenticated with check (public.pode_pcp(empresa_id))', t);
    execute format('create policy %1$s_upd on public.%1$s for update to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id))', t);
    execute format('create policy %1$s_del on public.%1$s for delete to authenticated using (public.pode_pcp(empresa_id))', t);
    execute format('grant select, insert, update, delete on public.%s to authenticated', t);
  end loop;
  foreach t in array array['qual_inspecoes', 'qual_rnc', 'qual_anexos'] loop
    execute format('create policy %1$s_ins on public.%1$s for insert to authenticated with check (public.pode_qualidade(empresa_id))', t);
    execute format('create policy %1$s_upd on public.%1$s for update to authenticated using (public.pode_qualidade(empresa_id)) with check (public.pode_qualidade(empresa_id))', t);
    execute format('create policy %1$s_del on public.%1$s for delete to authenticated using (public.pode_pcp(empresa_id))', t);
    execute format('grant select, insert, update, delete on public.%s to authenticated', t);
  end loop;
  execute 'grant select on public.qual_bloqueios to authenticated';
end $$;

-- 8) quem decide (pelos parâmetros)
create or replace function public.qual_pode_decidir(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros m left join qual_parametros p on p.empresa_id = m.empresa_id
                 where m.empresa_id = p_empresa and m.user_id = auth.uid()
                   and (m.papel::text = 'admin' or m.papel::text = any(coalesce(p.papeis_decisao, array['admin', 'diretor', 'financeiro']))));
$$;
revoke all on function public.qual_pode_decidir(uuid) from public, anon;
grant execute on function public.qual_pode_decidir(uuid) to authenticated;

-- plano que vale para o produto na etapa: o do produto vence o da família
create or replace function public._qual_plano(p_empresa uuid, p_produto uuid, p_etapa text)
returns uuid language sql stable security definer set search_path = public as $$
  select q.id from qual_planos q left join produtos p on p.id = p_produto
   where q.empresa_id = p_empresa and q.etapa = p_etapa and q.ativo
     and (q.produto_id = p_produto or (q.produto_id is null and q.familia_id = p.familia_id))
   order by (q.produto_id is not null) desc, q.criado_em limit 1;
$$;

-- amostra do plano para um lote: tabela (faixa), fixa ou 100%
create or replace function public.qual_amostra(p_plano uuid, p_qtd numeric)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pl qual_planos; a qual_amostragem;
begin
  select * into pl from qual_planos where id = p_plano;
  if not found then return jsonb_build_object('amostra', null, 'ac', 0, 're', 1); end if;
  if pl.amostragem = 'cem' then return jsonb_build_object('amostra', ceil(coalesce(p_qtd, 1)), 'ac', 0, 're', 1); end if;
  if pl.amostragem = 'fixa' then return jsonb_build_object('amostra', coalesce(pl.amostra_fixa, 1), 'ac', 0, 're', 1); end if;
  select * into a from qual_amostragem where empresa_id = pl.empresa_id and coalesce(p_qtd, 0) >= lote_min and (lote_max is null or coalesce(p_qtd, 0) <= lote_max)
   order by lote_min desc limit 1;
  if not found then return jsonb_build_object('amostra', coalesce(pl.amostra_fixa, 1), 'ac', 0, 're', 1); end if;
  return jsonb_build_object('amostra', least(a.amostra, greatest(1, ceil(coalesce(p_qtd, a.amostra)))::int), 'ac', a.ac, 're', a.re);
end $$;
grant execute on function public.qual_amostra(uuid, numeric) to authenticated;

-- 9) regras: mesma empresa, numeração, prazo, inspeção decidida não volta
create or replace function public._qual_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); v_h int;
begin
  if (j ->> 'produto_id') is not null and not exists (select 1 from produtos where id = (j ->> 'produto_id')::uuid and empresa_id = new.empresa_id) then
    raise exception 'Produto de outra empresa.'; end if;
  if tg_table_name = 'qual_planos' then
    if new.familia_id is not null and not exists (select 1 from est_familias where id = new.familia_id and empresa_id = new.empresa_id) then raise exception 'Família de outra empresa.'; end if;
    if jsonb_typeof(new.caracteristicas) <> 'array' then raise exception 'Características inválidas.'; end if;
    return new;
  end if;
  if tg_table_name = 'qual_inspecoes' then
    if tg_op = 'INSERT' then
      if new.numero is null or new.numero <= 0 then
        perform pg_advisory_xact_lock(hashtext('qual_insp:' || new.empresa_id::text));
        select coalesce(max(numero), 0) + 1 into new.numero from qual_inspecoes where empresa_id = new.empresa_id;
      end if;
      if new.prazo is null then
        select prazo_horas into v_h from qual_parametros where empresa_id = new.empresa_id;
        new.prazo := now() + make_interval(hours => coalesce(v_h, 24));
      end if;
      if new.plano_id is null then new.plano_id := _qual_plano(new.empresa_id, new.produto_id, new.etapa); end if;
      if new.amostra is null and new.plano_id is not null then
        j := qual_amostra(new.plano_id, new.quantidade);
        new.amostra := (j ->> 'amostra')::int; new.ac := (j ->> 'ac')::int; new.re := (j ->> 're')::int;
      end if;
    else
      if old.situacao in ('aprovada', 'aprovada_concessao', 'reprovada', 'cancelada') and current_setting('qual.decidindo', true) is distinct from 'on'
         and (new.situacao, new.qtd_aprovada, new.qtd_reprovada, new.produto_id, new.quantidade) is distinct from (old.situacao, old.qtd_aprovada, old.qtd_reprovada, old.produto_id, old.quantidade) then
        raise exception 'Inspeção % já decidida: a decisão não se altera.', old.numero; end if;
      if new.situacao in ('aprovada', 'aprovada_concessao', 'reprovada') and old.situacao not in ('aprovada', 'aprovada_concessao', 'reprovada')
         and current_setting('qual.decidindo', true) is distinct from 'on' then
        raise exception 'Use o botão de decisão (aprovar / reprovar): a decisão movimenta o estoque.'; end if;
      if new.situacao = 'cancelada' and old.situacao <> 'cancelada' and new.movimento_id is not null and current_setting('qual.decidindo', true) is distinct from 'on' then
        raise exception 'A inspeção % controla material na quarentena: decida (aprovar/reprovar) ou estorne a entrada no Kardex.', old.numero; end if;
      if new.situacao = 'em_inspecao' and new.inspecionada_em is null then new.inspecionada_em := now(); end if;
    end if;
    new.atualizado_em := now();
    return new;
  end if;
  if tg_table_name = 'qual_rnc' then
    if tg_op = 'INSERT' and (new.numero is null or new.numero <= 0) then
      perform pg_advisory_xact_lock(hashtext('qual_rnc:' || new.empresa_id::text));
      select coalesce(max(numero), 0) + 1 into new.numero from qual_rnc where empresa_id = new.empresa_id;
    end if;
    if tg_op = 'INSERT' and new.prazo is null then
      select prazo_rnc_dias into v_h from qual_parametros where empresa_id = new.empresa_id;
      new.prazo := current_date + coalesce(v_h, 15);
    end if;
    if tg_op = 'UPDATE' and new.disposicao is distinct from old.disposicao and old.disposicao_executada_em is not null then
      raise exception 'A disposição da RNC % já foi executada no estoque.', old.numero; end if;
    if new.situacao = 'encerrada' and (tg_op = 'INSERT' or old.situacao <> 'encerrada') then
      if new.disposicao = 'pendente' and new.quantidade is not null then raise exception 'Defina a disposição do material antes de encerrar.'; end if;
      new.encerrada_em := now();
    end if;
    new.atualizado_em := now();
    return new;
  end if;
  return new;
end $$;
drop trigger if exists qual_planos_regras on public.qual_planos;
create trigger qual_planos_regras before insert or update on public.qual_planos for each row execute function public._qual_regras();
drop trigger if exists qual_insp_regras on public.qual_inspecoes;
create trigger qual_insp_regras before insert or update on public.qual_inspecoes for each row execute function public._qual_regras();
drop trigger if exists qual_rnc_regras on public.qual_rnc;
create trigger qual_rnc_regras before insert or update on public.qual_rnc for each row execute function public._qual_regras();

-- 10) estoque: entrada de nota com plano vai para a quarentena; nada sai da quarentena, do reprovado nem de lote bloqueado
--     sem a qualidade. (O nome "est_movimentos_a_..." faz este gatilho rodar antes do motor do Kardex.)
create or replace function public._qual_est_mov() returns trigger
language plpgsql security definer set search_path = public as $$
declare qp qual_parametros; v_pl uuid; tm est_tipos_movimento; n nfe_notas; v_dest uuid; lt est_lotes;
begin
  select * into qp from qual_parametros where empresa_id = new.empresa_id;
  if not found then return new; end if;
  select * into tm from est_tipos_movimento where id = new.tipo_movimento_id;
  -- estorno da entrada que estava na quarentena: cancela a inspeção que ainda não foi decidida
  if new.estorno_de is not null then
    if new.quantidade < 0 then
      perform set_config('qual.decidindo', 'on', true);
      update qual_inspecoes set situacao = 'cancelada', observacao = coalesce(observacao || ' · ', '') || 'Entrada estornada no estoque'
       where movimento_id = new.estorno_de and situacao in ('pendente', 'em_inspecao');
      perform set_config('qual.decidindo', 'off', true);
    end if;
    return new;
  end if;
  -- entrada pela nota de um produto com plano de recebimento → quarentena + inspeção
  if new.quantidade > 0 and new.nfe_item_id is not null and qp.inspecionar_recebimento and qp.local_quarentena_id is not null
     and new.local_id <> qp.local_quarentena_id and tm.sentido = 'E' and tm.afeta_custo then
    v_pl := _qual_plano(new.empresa_id, new.produto_id, 'recebimento');
    if v_pl is not null then
      v_dest := new.local_id; new.local_id := qp.local_quarentena_id;
      select * into n from nfe_notas where id = new.nota_id;
      -- se a nota já tinha inspeção aberta pela busca (antes da implantação), passa a controlar o material
      update qual_inspecoes set movimento_id = new.id, local_destino_id = v_dest, lote_id = coalesce(lote_id, new.lote_id)
       where nfe_item_id = new.nfe_item_id and movimento_id is null and situacao in ('pendente', 'em_inspecao');
      if not found then
        insert into qual_inspecoes(empresa_id, etapa, origem, plano_id, produto_id, lote_id, fornecedor_id, nota_id, nfe_item_id, movimento_id, local_destino_id, quantidade, unidade, observacao)
        values (new.empresa_id, 'recebimento', 'nfe', v_pl, new.produto_id, new.lote_id, n.favorecido_id, new.nota_id, new.nfe_item_id, new.id, v_dest, new.quantidade,
                (select unidade from produtos where id = new.produto_id), new.documento)
        on conflict do nothing;
      end if;
    end if;
    return new;
  end if;
  -- devolução ao fornecedor pela nota: baixa do local Reprovado quando há material reprovado do produto lá
  if new.quantidade < 0 and new.nfe_item_id is not null and tm.codigo = 'DEVFOR' and qp.local_reprovado_id is not null
     and exists (select 1 from est_saldos where produto_id = new.produto_id and local_id = qp.local_reprovado_id and quantidade >= -new.quantidade) then
    new.local_id := qp.local_reprovado_id;
    -- o lote é o que está no Reprovado (a nota escolheu o lote mais antigo do local padrão)
    select lote_id into new.lote_id from est_saldos where produto_id = new.produto_id and local_id = qp.local_reprovado_id and quantidade >= -new.quantidade
     order by ultimo_movimento limit 1;
    update qual_rnc set disposicao_executada_em = now(), disposicao_obs = coalesce(disposicao_obs || ' · ', '') || coalesce(new.documento, 'NF de devolução')
     where empresa_id = new.empresa_id and produto_id = new.produto_id and disposicao = 'devolver_fornecedor' and disposicao_executada_em is null;
    return new;
  end if;
  -- saídas barradas
  if new.quantidade < 0 and current_setting('qual.liberando', true) is distinct from 'on' then
    if new.local_id = qp.local_quarentena_id then
      raise exception 'Material em quarentena aguardando a inspeção da qualidade: só sai pela decisão da inspeção.'; end if;
    if new.local_id = qp.local_reprovado_id then
      raise exception 'Material reprovado: só sai pela disposição da não conformidade (RNC).'; end if;
    if new.lote_id is not null then
      select * into lt from est_lotes where id = new.lote_id;
      if lt.bloqueado then raise exception 'Lote % bloqueado pela qualidade: %', lt.codigo, coalesce(lt.bloqueio_motivo, 'sem motivo informado'); end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public._qual_est_mov() from public, anon, authenticated;
drop trigger if exists est_movimentos_a_qualidade on public.est_movimentos;
create trigger est_movimentos_a_qualidade before insert on public.est_movimentos for each row execute function public._qual_est_mov();

-- 11) produção: bobina nasce bloqueada até a liberação; bobina bloqueada não sai; OP concluída abre a inspeção final
create or replace function public._qual_bobina() returns trigger
language plpgsql security definer set search_path = public as $$
declare op prod_ordens; v_pl uuid; v_setor uuid; v_insp uuid;
begin
  if tg_op = 'UPDATE' then
    if new.situacao <> old.situacao and new.situacao in ('expedida', 'consumida') and new.qualidade <> 'liberada' then
      raise exception 'Bobina % % pela qualidade: não pode ser %.', new.codigo, case new.qualidade when 'reprovada' then 'reprovada' else 'bloqueada' end, new.situacao; end if;
    if new.qualidade is distinct from old.qualidade and current_setting('qual.liberando', true) is distinct from 'on' then
      raise exception 'O bloqueio da bobina muda pela Qualidade (inspeção ou bloqueio).'; end if;
    return new;
  end if;
  select * into op from prod_ordens where id = new.ordem_id;
  if op.produto_id is null then return new; end if;
  select setor_id into v_setor from prod_ordem_etapas where id = new.etapa_id;
  select id into v_pl from qual_planos q
   where q.empresa_id = new.empresa_id and q.etapa = 'processo' and q.ativo and q.liberacao_primeira
     and (q.produto_id = op.produto_id or (q.produto_id is null and q.familia_id = (select familia_id from produtos where id = op.produto_id)))
     and (q.setor_id is null or q.setor_id = v_setor)
   order by (q.produto_id is not null) desc, (q.setor_id is not null) desc limit 1;
  if v_pl is null then return new; end if;
  -- já liberada nesta OP/etapa?
  if exists (select 1 from qual_inspecoes where ordem_id = new.ordem_id and etapa_op_id is not distinct from new.etapa_id and origem = 'liberacao'
              and situacao in ('aprovada', 'aprovada_concessao')) then return new; end if;
  select id into v_insp from qual_inspecoes where ordem_id = new.ordem_id and etapa_op_id is not distinct from new.etapa_id and origem = 'liberacao'
     and situacao in ('pendente', 'em_inspecao') limit 1;
  if v_insp is null then
    insert into qual_inspecoes(empresa_id, etapa, origem, plano_id, produto_id, ordem_id, etapa_op_id, lote_texto, quantidade, unidade, observacao, prazo)
    values (new.empresa_id, 'processo', 'liberacao', v_pl, op.produto_id, new.ordem_id, new.etapa_id, new.codigo, new.peso_kg, 'KG',
            'Liberação do primeiro material da OP ' || op.numero, now() + interval '2 hours')
    returning id into v_insp;
  end if;
  new.qualidade := 'bloqueada'; new.qual_inspecao_id := v_insp;
  return new;
end $$;
revoke all on function public._qual_bobina() from public, anon, authenticated;
drop trigger if exists prod_bobinas_qualidade on public.prod_bobinas;
create trigger prod_bobinas_qualidade before insert or update on public.prod_bobinas for each row execute function public._qual_bobina();

create or replace function public._qual_op_final() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pl uuid;
begin
  if new.status = 'concluida' and old.status <> 'concluida' and new.produto_id is not null then
    v_pl := _qual_plano(new.empresa_id, new.produto_id, 'final');
    if v_pl is not null and not exists (select 1 from qual_inspecoes where ordem_id = new.id and etapa = 'final' and situacao <> 'cancelada') then
      insert into qual_inspecoes(empresa_id, etapa, origem, plano_id, produto_id, ordem_id, quantidade, unidade, observacao)
      values (new.empresa_id, 'final', 'op', v_pl, new.produto_id, new.id, new.quantidade, new.unidade, 'Inspeção final da OP ' || new.numero);
    end if;
  end if;
  return null;
end $$;
revoke all on function public._qual_op_final() from public, anon, authenticated;
drop trigger if exists prod_ordens_qualidade on public.prod_ordens;
create trigger prod_ordens_qualidade after update of status on public.prod_ordens for each row execute function public._qual_op_final();

-- 12) decisão da inspeção: movimenta o estoque, libera ou reprova as bobinas e abre a RNC
create or replace function public.qual_decidir(p_inspecao uuid, p_decisao text, p_qtd_aprovada numeric default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i qual_inspecoes; qp qual_parametros; m est_movimentos; v_aprov numeric; v_repr numeric; v_rnc uuid; v_saldo numeric; v_mov text := 'sem_estoque';
begin
  select * into i from qual_inspecoes where id = p_inspecao for update;
  if not found then raise exception 'Inspeção não encontrada.'; end if;
  if not qual_pode_decidir(i.empresa_id) then raise exception 'Seu perfil não decide inspeções (Qualidade › Planos e Parâmetros › quem decide).'; end if;
  if i.situacao not in ('pendente', 'em_inspecao') then raise exception 'Inspeção % já decidida.', i.numero; end if;
  if p_decisao not in ('aprovada', 'aprovada_concessao', 'reprovada') then raise exception 'Decisão inválida.'; end if;
  if p_decisao in ('aprovada_concessao', 'reprovada') and nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Informe o motivo da %.', case p_decisao when 'reprovada' then 'reprovação' else 'concessão' end; end if;
  select * into qp from qual_parametros where empresa_id = i.empresa_id;
  v_aprov := case p_decisao when 'reprovada' then coalesce(p_qtd_aprovada, 0) else coalesce(p_qtd_aprovada, i.quantidade) end;
  if i.quantidade is not null then
    if v_aprov < 0 or v_aprov > i.quantidade then raise exception 'Quantidade aprovada fora do lote (0 a %).', i.quantidade; end if;
    v_repr := i.quantidade - v_aprov;
  end if;
  perform set_config('qual.liberando', 'on', true);
  perform set_config('qual.decidindo', 'on', true);
  -- estoque: sai da quarentena para o destino (aprovado) e para o reprovado
  if i.movimento_id is not null and qp.local_quarentena_id is not null then
    select * into m from est_movimentos where id = i.movimento_id;
    select coalesce(sum(quantidade), 0) into v_saldo from est_saldos where produto_id = i.produto_id and local_id = qp.local_quarentena_id and lote_id is not distinct from m.lote_id;
    if v_saldo + 0.0001 < coalesce(v_aprov, 0) + coalesce(v_repr, 0) then
      raise exception 'A quarentena tem % deste material; a inspeção é de %. Confira o Kardex.', v_saldo, i.quantidade; end if;
    if v_aprov > 0 then
      perform est_transferir(i.empresa_id, current_date, i.produto_id, qp.local_quarentena_id, coalesce(i.local_destino_id, m.local_id), v_aprov, m.lote_id, null, 'Inspeção ' || i.numero || ' aprovada');
    end if;
    if v_repr > 0 then
      if qp.local_reprovado_id is null then raise exception 'Defina o local Reprovado nos parâmetros da qualidade.'; end if;
      perform est_transferir(i.empresa_id, current_date, i.produto_id, qp.local_quarentena_id, qp.local_reprovado_id, v_repr, m.lote_id, null, 'Inspeção ' || i.numero || ' reprovada');
    end if;
    v_mov := 'movimentado';
  end if;
  -- bobinas: as bloqueadas por esta inspeção (liberação) ou a bobina inspecionada
  if p_decisao = 'reprovada' then
    update prod_bobinas set qualidade = 'reprovada' where (qual_inspecao_id = i.id or id = i.bobina_id) and qualidade <> 'reprovada';
  else
    update prod_bobinas set qualidade = 'liberada' where (qual_inspecao_id = i.id or id = i.bobina_id) and qualidade = 'bloqueada';
  end if;
  insert into qual_bloqueios(empresa_id, tipo, bobina_id, acao, motivo, inspecao_id)
  select i.empresa_id, 'bobina', id, case when p_decisao = 'reprovada' then 'reprovacao' else 'liberacao' end, 'Inspeção ' || i.numero, i.id
    from prod_bobinas where qual_inspecao_id = i.id or id = i.bobina_id;
  update qual_inspecoes set situacao = p_decisao, qtd_aprovada = v_aprov, qtd_reprovada = v_repr, motivo = nullif(trim(coalesce(p_motivo, '')), ''),
         decidida_por = auth.jwt() ->> 'email', decidida_em = now(), inspecionada_em = coalesce(inspecionada_em, now())
   where id = i.id;
  -- não conformidade
  if p_decisao = 'reprovada' or coalesce(v_repr, 0) > 0 then
    insert into qual_rnc(empresa_id, origem, inspecao_id, produto_id, lote_id, bobina_id, ordem_id, favorecido_id, descricao, quantidade, unidade, gravidade)
    values (i.empresa_id, case when i.etapa = 'recebimento' then 'fornecedor' else 'processo' end, i.id, i.produto_id, i.lote_id, i.bobina_id, i.ordem_id, i.fornecedor_id,
            'Inspeção ' || i.numero || ' reprovada: ' || coalesce(p_motivo, ''), coalesce(v_repr, i.quantidade), i.unidade, 'media')
    returning id into v_rnc;
  end if;
  perform set_config('qual.liberando', 'off', true);
  perform set_config('qual.decidindo', 'off', true);
  return jsonb_build_object('situacao', p_decisao, 'aprovada', v_aprov, 'reprovada', v_repr, 'estoque', v_mov, 'rnc_id', v_rnc);
end $$;
revoke all on function public.qual_decidir(uuid, text, numeric, text) from public, anon;
grant execute on function public.qual_decidir(uuid, text, numeric, text) to authenticated;

-- 13) disposição da RNC executada no estoque
create or replace function public.qual_dispor(p_rnc uuid, p_disposicao text, p_local uuid default null, p_obs text default null)
returns text language plpgsql security definer set search_path = public as $$
declare r qual_rnc; i qual_inspecoes; qp qual_parametros; m est_movimentos; v_q numeric; v_lote uuid; v_t uuid; v_dest uuid; v_saldo numeric;
begin
  select * into r from qual_rnc where id = p_rnc for update;
  if not found then raise exception 'RNC não encontrada.'; end if;
  if not qual_pode_decidir(r.empresa_id) then raise exception 'Seu perfil não decide a disposição do material.'; end if;
  if r.disposicao_executada_em is not null then raise exception 'Disposição já executada.'; end if;
  if p_disposicao not in ('usar_como_esta', 'retrabalho', 'reclassificar', 'sucatear', 'devolver_fornecedor') then raise exception 'Disposição inválida.'; end if;
  select * into qp from qual_parametros where empresa_id = r.empresa_id;
  select * into i from qual_inspecoes where id = r.inspecao_id;
  perform set_config('qual.liberando', 'on', true);
  -- bobinas reprovadas: usar/retrabalhar/reclassificar libera; sucatear marca refugada
  if r.bobina_id is not null or (i.id is not null and exists (select 1 from prod_bobinas where qual_inspecao_id = i.id)) then
    if p_disposicao = 'sucatear' then
      update prod_bobinas set situacao = 'refugada' where (id = r.bobina_id or qual_inspecao_id = i.id) and qualidade = 'reprovada';
    elsif p_disposicao in ('usar_como_esta', 'retrabalho', 'reclassificar') then
      update prod_bobinas set qualidade = 'liberada' where (id = r.bobina_id or qual_inspecao_id = i.id) and qualidade = 'reprovada';
    end if;
    insert into qual_bloqueios(empresa_id, tipo, bobina_id, acao, motivo, rnc_id)
    select r.empresa_id, 'bobina', id, 'liberacao', 'RNC ' || r.numero || ': ' || p_disposicao, r.id from prod_bobinas where (id = r.bobina_id or qual_inspecao_id = i.id) and p_disposicao <> 'sucatear';
  end if;
  -- estoque: material no local Reprovado
  if i.movimento_id is not null and qp.local_reprovado_id is not null and coalesce(i.qtd_reprovada, 0) > 0 then
    select * into m from est_movimentos where id = i.movimento_id;
    v_lote := m.lote_id; v_q := i.qtd_reprovada;
    select coalesce(sum(quantidade), 0) into v_saldo from est_saldos where produto_id = r.produto_id and local_id = qp.local_reprovado_id and lote_id is not distinct from v_lote;
    if v_saldo + 0.0001 < v_q then raise exception 'O local Reprovado tem % deste material; a RNC é de %.', v_saldo, v_q; end if;
    if p_disposicao in ('usar_como_esta', 'retrabalho', 'reclassificar') then
      v_dest := coalesce(p_local, i.local_destino_id, m.local_id);
      perform est_transferir(r.empresa_id, current_date, r.produto_id, qp.local_reprovado_id, v_dest, v_q, v_lote, null, 'RNC ' || r.numero || ': ' || p_disposicao);
    elsif p_disposicao = 'sucatear' then
      select id into v_t from est_tipos_movimento where empresa_id = r.empresa_id and codigo = 'PERDA';
      if v_t is null then raise exception 'Cadastre o tipo de movimento PERDA.'; end if;
      insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, documento, observacao)
      values (r.empresa_id, current_date, r.produto_id, qp.local_reprovado_id, v_lote, v_t, -v_q, 'RNC ' || r.numero, 'Sucata pela não conformidade');
    end if;
  end if;
  update qual_rnc set disposicao = p_disposicao, disposicao_obs = nullif(trim(coalesce(p_obs, '')), ''),
         disposicao_executada_em = case when p_disposicao = 'devolver_fornecedor' and i.movimento_id is not null then null else now() end,
         situacao = case when situacao = 'aberta' then 'em_analise' else situacao end
   where id = r.id;
  perform set_config('qual.liberando', 'off', true);
  return case when p_disposicao = 'devolver_fornecedor' and i.movimento_id is not null then 'aguardando_nf_devolucao' else 'executada' end;
end $$;
revoke all on function public.qual_dispor(uuid, text, uuid, text) from public, anon;
grant execute on function public.qual_dispor(uuid, text, uuid, text) to authenticated;

-- 14) bloquear / liberar lote do estoque ou bobina
create or replace function public.qual_bloquear(p_empresa uuid, p_tipo text, p_id uuid, p_bloquear boolean, p_motivo text default null)
returns text language plpgsql security definer set search_path = public as $$
begin
  if p_bloquear and not pode_qualidade(p_empresa) then raise exception 'Sem permissão para bloquear.'; end if;
  if not p_bloquear and not qual_pode_decidir(p_empresa) then raise exception 'Seu perfil não libera material bloqueado.'; end if;
  if p_bloquear and nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Informe o motivo do bloqueio.'; end if;
  perform set_config('qual.liberando', 'on', true);
  if p_tipo = 'lote' then
    update est_lotes set bloqueado = p_bloquear, bloqueio_motivo = case when p_bloquear then p_motivo end where id = p_id and empresa_id = p_empresa;
    if not found then raise exception 'Lote não encontrado.'; end if;
    insert into qual_bloqueios(empresa_id, tipo, lote_id, acao, motivo) values (p_empresa, 'lote', p_id, case when p_bloquear then 'bloqueio' else 'liberacao' end, p_motivo);
  elsif p_tipo = 'bobina' then
    update prod_bobinas set qualidade = case when p_bloquear then 'bloqueada' else 'liberada' end where id = p_id and empresa_id = p_empresa
       and (p_bloquear or qualidade = 'bloqueada');
    if not found then raise exception 'Bobina não encontrada (ou reprovada: a reprovada sai pela RNC).'; end if;
    insert into qual_bloqueios(empresa_id, tipo, bobina_id, acao, motivo) values (p_empresa, 'bobina', p_id, case when p_bloquear then 'bloqueio' else 'liberacao' end, p_motivo);
  else raise exception 'Tipo inválido.'; end if;
  perform set_config('qual.liberando', 'off', true);
  return case when p_bloquear then 'bloqueado' else 'liberado' end;
end $$;
revoke all on function public.qual_bloquear(uuid, text, uuid, boolean, text) from public, anon;
grant execute on function public.qual_bloquear(uuid, text, uuid, boolean, text) to authenticated;

-- 15) recebimento pelas notas (enquanto o estoque não estiver implantado, ou para notas antigas): abre a inspeção
--     dos itens de entrada com plano, sem movimentar o estoque. Não duplica.
create or replace function public.qual_gerar_recebimento(p_empresa uuid, p_desde date default null)
returns int language plpgsql security definer set search_path = public as $$
declare x record; n int := 0; v_pl uuid;
begin
  if not pode_qualidade(p_empresa) then raise exception 'Sem permissão.'; end if;
  for x in select i.id item_id, i.qcom, nt.id nota_id, nt.numero, nt.emit_nome, nt.favorecido_id, pf.produto_id, pf.fator, p.unidade
             from nfe_itens i join nfe_notas nt on nt.id = i.nota_id
             join produto_fornecedores pf on pf.empresa_id = nt.empresa_id and pf.emit_doc = nt.emit_doc and pf.codigo_fornecedor = i.cprod
             join produtos p on p.id = pf.produto_id
            where nt.empresa_id = p_empresa and nt.tipo = 'entrada' and not nt.emissao_propria and nt.situacao = 'autorizada'
              and coalesce(nt.finalidade, '1') not in ('2', '3', '4') and nt.emissao >= coalesce(p_desde, current_date - 30)
              and not exists (select 1 from qual_inspecoes q where q.nfe_item_id = i.id)
              and not exists (select 1 from est_movimentos m where m.nfe_item_id = i.id) loop
    v_pl := _qual_plano(p_empresa, x.produto_id, 'recebimento');
    continue when v_pl is null;
    insert into qual_inspecoes(empresa_id, etapa, origem, plano_id, produto_id, fornecedor_id, nota_id, nfe_item_id, quantidade, unidade, observacao)
    values (p_empresa, 'recebimento', 'nfe', v_pl, x.produto_id, x.favorecido_id, x.nota_id, x.item_id, round(x.qcom * coalesce(x.fator, 1), 4), x.unidade,
            'NF ' || x.numero || coalesce(' · ' || x.emit_nome, ''))
    on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.qual_gerar_recebimento(uuid, date) from public, anon;
grant execute on function public.qual_gerar_recebimento(uuid, date) to authenticated;

-- 16) configuração inicial: local Reprovado, parâmetros e a tabela de amostragem de partida
--     (tamanhos de amostra do nível geral II da ABNT NBR 5426 / ISO 2859-1; aceitação zero: Ac 0, Re 1 — ajustável na tela)
create or replace function public.qual_configurar(p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_qua uuid; v_rep uuid; v_n int := 0;
begin
  if not pode_pcp(p_empresa) then raise exception 'Só administrador, financeiro ou diretor configura a qualidade.'; end if;
  select id into v_qua from est_locais where empresa_id = p_empresa and finalidade = 'quarentena' and codigo = 'QUA';
  if v_qua is null then select id into v_qua from est_locais where empresa_id = p_empresa and finalidade = 'quarentena' order by ordem limit 1; end if;
  if v_qua is null then
    insert into est_locais(empresa_id, codigo, nome, finalidade, ordem) values (p_empresa, 'QUA', 'Quarentena (aguardando a qualidade)', 'quarentena', 120)
    on conflict (empresa_id, codigo) do update set nome = est_locais.nome returning id into v_qua;
  end if;
  insert into est_locais(empresa_id, codigo, nome, finalidade, ordem) values (p_empresa, 'REP', 'Reprovado (não conforme, aguardando disposição)', 'quarentena', 125)
  on conflict (empresa_id, codigo) do update set nome = est_locais.nome returning id into v_rep;
  insert into qual_parametros(empresa_id, local_quarentena_id, local_reprovado_id) values (p_empresa, v_qua, v_rep)
  on conflict (empresa_id) do update set local_quarentena_id = coalesce(qual_parametros.local_quarentena_id, excluded.local_quarentena_id),
                                         local_reprovado_id = coalesce(qual_parametros.local_reprovado_id, excluded.local_reprovado_id);
  if not exists (select 1 from qual_amostragem where empresa_id = p_empresa) then
    insert into qual_amostragem(empresa_id, lote_min, lote_max, amostra, ac, re)
    select p_empresa, a, b, n, 0, 1 from (values (2, 8, 2), (9, 15, 3), (16, 25, 5), (26, 50, 8), (51, 90, 13), (91, 150, 20), (151, 280, 32), (281, 500, 50),
      (501, 1200, 80), (1201, 3200, 125), (3201, 10000, 200), (10001, 35000, 315), (35001, 150000, 500), (150001, 500000, 800), (500001, null, 1250)) t(a, b, n);
    get diagnostics v_n = row_count;
  end if;
  return jsonb_build_object('quarentena', v_qua, 'reprovado', v_rep, 'faixas', v_n);
end $$;
revoke all on function public.qual_configurar(uuid) from public, anon;
grant execute on function public.qual_configurar(uuid) to authenticated;
revoke all on function public._qual_regras() from public, anon, authenticated;

-- 17) arquivos: qualidade/<empresa>/<…>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('qualidade', 'qualidade', false, 15728640, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists qualidade_arq_sel on storage.objects;
drop policy if exists qualidade_arq_ins on storage.objects;
drop policy if exists qualidade_arq_del on storage.objects;
create policy qualidade_arq_sel on storage.objects for select to authenticated using (bucket_id = 'qualidade' and public.is_participante(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy qualidade_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'qualidade' and public.pode_qualidade(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy qualidade_arq_del on storage.objects for delete to authenticated using (bucket_id = 'qualidade' and public.pode_pcp(public._uuid_ou_nulo((storage.foldername(name))[1])));

-- 18) auditoria
do $$ declare t text; begin
  if to_regprocedure('public._auditar()') is not null then
    foreach t in array array['qual_parametros', 'qual_amostragem', 'qual_planos', 'qual_inspecoes', 'qual_rnc'] loop
      execute format('drop trigger if exists zz_auditoria on public.%s', t);
      execute format('create trigger zz_auditoria after insert or update or delete on public.%s for each row execute function public._auditar()', t);
    end loop;
  end if;
end $$;

-- conferência: tabelas = 7, funções = 8, bucket = 1
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'qual\_%') as tabelas,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
         ('pode_qualidade', 'qual_pode_decidir', 'qual_amostra', 'qual_decidir', 'qual_dispor', 'qual_bloquear', 'qual_gerar_recebimento', 'qual_configurar')) as funcoes,
       (select count(*) from storage.buckets where id = 'qualidade') as bucket;
