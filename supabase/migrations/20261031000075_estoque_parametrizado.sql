-- =====================================================================
-- Estoque parametrizado — Etapa A (31/10/2026; Renan: "a plataforma ser a oficial"; custo médio ponderado móvel; controlar tudo,
-- inclusive uso e consumo; lote de resina e bobina; "o nível de profissionalismo precisa ser competitivo com os que já existem").
--  - est_locais: as partições (matéria-prima, insumos, em processo por setor, acabado, aparas, manutenção, uso e consumo,
--    em poder de terceiros, quarentena), cada um com as suas regras (controla saldo, compõe custo, saldo negativo, quem movimenta).
--  - est_familias: classificação do item (tipo do item no SPED, local padrão de entrada, controle por lote, conta do plano).
--  - est_tipos_movimento: entrada / saída / transferência, locais padrão, se mexe no custo, se gera financeiro, documento exigido.
--  - est_regras_cfop: CFOP (+ família ou tipo SPED) → tipo de movimento e local; base dos movimentos automáticos pelas NF-e (Etapa B).
--  - est_lotes, est_movimentos (kardex, imutável: corrige-se por estorno), est_saldos (produto × local × lote), est_custos (custo médio
--    ponderado móvel por produto), est_fechamentos (mês fechado não aceita movimento).
--  - est_configurar_padrao(empresa): cria a parametrização inicial (pode rodar de novo: não duplica nem sobrescreve o que foi ajustado).
--  - est_produtos_das_notas(empresa): cadastra os produtos vendidos nas NF-e de saída (tipo 04, local Produto acabado).
-- Leitura: participantes (inclui compras e produção). Parâmetros: administrador e financeiro. Movimentos: administrador, financeiro, diretor, compras e produção
-- (restringível por local). Migração ADITIVA; pode rodar mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------- permissões
create or replace function public.pode_estoque(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao'));
$$;
create or replace function public.papel_em(p_empresa uuid)
returns text language sql stable security definer set search_path = public as $$
  select papel::text from membros where empresa_id = p_empresa and user_id = auth.uid() limit 1;
$$;

-- ---------------------------------------------------------------- locais (partições)
create table if not exists public.est_locais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null, nome text not null,
  finalidade text not null check (finalidade in ('materia_prima','insumo','processo','acabado','aparas','manutencao','uso_consumo','terceiros','quarentena','outro')),
  posse text not null default 'propria' check (posse in ('propria','em_terceiros','de_terceiros')),   -- nosso aqui / nosso em terceiros / de terceiros aqui
  setor_id uuid references public.prod_setores(id) on delete set null,                                -- em processo: o setor da produção
  controla_saldo boolean not null default true,
  compoe_custo boolean not null default true,       -- entra no valor do estoque (de terceiros: não)
  permite_negativo boolean not null default false,
  papeis text[],                                    -- quem movimenta (nulo = todos que movimentam estoque)
  conta_contabil text,
  ordem int not null default 0, ativo boolean not null default true,
  unique (empresa_id, codigo)
);

-- ---------------------------------------------------------------- famílias (classificação do item)
create table if not exists public.est_familias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null, nome text not null,
  tipo_sped text not null check (tipo_sped in ('00','01','02','03','04','05','06','07','08','09','10','99')),
  local_padrao_id uuid references public.est_locais(id) on delete set null,
  controla_lote boolean not null default false,
  plano_id uuid references public.plano_contas(id) on delete set null,   -- conta do plano na compra
  ativo boolean not null default true,
  unique (empresa_id, codigo)
);

alter table public.produtos add column if not exists familia_id uuid references public.est_familias(id) on delete set null;
alter table public.produtos add column if not exists tipo_sped text check (tipo_sped in ('00','01','02','03','04','05','06','07','08','09','10','99'));
alter table public.produtos add column if not exists local_padrao_id uuid references public.est_locais(id) on delete set null;
alter table public.produtos add column if not exists controla_lote boolean not null default false;

-- ---------------------------------------------------------------- tipos de movimento
create table if not exists public.est_tipos_movimento (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null, nome text not null,
  sentido text not null check (sentido in ('E','S','T')),            -- entrada, saída, transferência
  local_origem_id uuid references public.est_locais(id) on delete set null,
  local_destino_id uuid references public.est_locais(id) on delete set null,
  afeta_custo boolean not null default false,                      -- entrada que forma o custo médio (compra, produção, saldo inicial)
  gera_financeiro boolean not null default false,
  documento text not null default 'nenhum' check (documento in ('nf','op','requisicao','inventario','nenhum')),
  sistema boolean not null default false,                          -- usado pela plataforma: não pode excluir
  ativo boolean not null default true,
  unique (empresa_id, codigo)
);

-- ---------------------------------------------------------------- regras por CFOP (movimentos automáticos pelas NF-e)
create table if not exists public.est_regras_cfop (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cfop text not null,                       -- '5101' ou só o final ('101' vale para 5101, 6101 e 7101; 1101, 2101 e 3101)
  sentido text not null check (sentido in ('entrada','saida')),
  tipo_sped text,                           -- nulo = qualquer tipo de item
  familia_id uuid references public.est_familias(id) on delete cascade,
  tipo_movimento_id uuid references public.est_tipos_movimento(id) on delete cascade,   -- nulo = não movimenta estoque
  local_id uuid references public.est_locais(id) on delete set null,                    -- nulo = local padrão do produto/família
  prioridade int not null default 100,
  observacao text, ativo boolean not null default true
);
create index if not exists est_regras_cfop_emp on public.est_regras_cfop(empresa_id, sentido, cfop);

-- ---------------------------------------------------------------- lotes, movimentos, saldos, custos, fechamento
create table if not exists public.est_lotes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  codigo text not null,                     -- nº do lote (resina) ou da bobina
  lote_fornecedor text, fornecedor_id uuid references public.favorecidos(id) on delete set null,
  fabricacao date, validade date,
  origem text not null default 'compra' check (origem in ('compra','producao','inventario','outro')),
  criado_em timestamptz not null default now(),
  unique (empresa_id, produto_id, codigo)
);

create table if not exists public.est_movimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data date not null,
  produto_id uuid not null references public.produtos(id),
  local_id uuid not null references public.est_locais(id),
  lote_id uuid references public.est_lotes(id),
  tipo_movimento_id uuid not null references public.est_tipos_movimento(id),
  quantidade numeric(18,4) not null check (quantidade <> 0),   -- + entra, − sai
  custo_unitario numeric(20,10),                                -- informado nas entradas que formam custo; calculado nas demais
  valor numeric(18,2),                                          -- quantidade × custo (com sinal)
  custo_medio_apos numeric(20,10), saldo_local_apos numeric(18,4),
  transferencia_id uuid,                                        -- par saída/entrada da transferência
  estorno_de uuid references public.est_movimentos(id),
  nota_id uuid references public.nfe_notas(id) on delete set null,
  nfe_item_id uuid references public.nfe_itens(id) on delete set null,
  documento text, observacao text,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists est_mov_prod on public.est_movimentos(empresa_id, produto_id, data);
create index if not exists est_mov_local on public.est_movimentos(local_id, data);
create unique index if not exists est_mov_nfe_item on public.est_movimentos(nfe_item_id) where nfe_item_id is not null and estorno_de is null;

create table if not exists public.est_saldos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  local_id uuid not null references public.est_locais(id) on delete cascade,
  lote_id uuid references public.est_lotes(id) on delete cascade,
  quantidade numeric(18,4) not null default 0,
  valor numeric(18,2) not null default 0,
  ultimo_movimento date
);
create unique index if not exists est_saldos_chave on public.est_saldos(produto_id, local_id, coalesce(lote_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.est_custos (
  produto_id uuid primary key references public.produtos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  quantidade numeric(18,4) not null default 0,
  valor numeric(18,2) not null default 0,
  custo_medio numeric(20,10) not null default 0,
  ultima_entrada date
);

create table if not exists public.est_fechamentos (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mes date not null,                        -- primeiro dia do mês fechado
  fechado_em timestamptz not null default now(), fechado_por uuid default auth.uid(),
  primary key (empresa_id, mes)
);

-- ---------------------------------------------------------------- motor do kardex
create or replace function public._est_mov() returns trigger
language plpgsql security definer set search_path = public as $$
declare loc est_locais; tm est_tipos_movimento; pr produtos; c est_custos; s est_saldos; v_fech date; v_cm numeric; v_papel text;
begin
  select * into loc from est_locais where id = new.local_id;
  select * into tm from est_tipos_movimento where id = new.tipo_movimento_id;
  select * into pr from produtos where id = new.produto_id;
  if loc.empresa_id <> new.empresa_id or tm.empresa_id <> new.empresa_id or pr.empresa_id <> new.empresa_id then raise exception 'Local, tipo de movimento e produto precisam ser da mesma empresa.'; end if;
  if not loc.ativo then raise exception 'O local % está inativo.', loc.nome; end if;
  if not tm.ativo then raise exception 'O tipo de movimento % está inativo.', tm.nome; end if;
  select max(mes) into v_fech from est_fechamentos where empresa_id = new.empresa_id;
  if v_fech is not null and new.data < (v_fech + interval '1 month')::date then
    raise exception 'O estoque de % está fechado: lance o movimento com data posterior ou reabra o mês.', to_char(v_fech, 'MM/YYYY');
  end if;
  if loc.papeis is not null and auth.uid() is not null then
    v_papel := papel_em(new.empresa_id);
    if v_papel is distinct from 'admin' and not (v_papel = any(loc.papeis)) then raise exception 'Seu perfil não movimenta o local %.', loc.nome; end if;
  end if;
  if pr.controla_lote and new.lote_id is null and loc.controla_saldo then raise exception 'O produto % controla lote: informe o lote.', pr.codigo; end if;
  if tm.sentido = 'E' and new.quantidade < 0 and new.estorno_de is null then raise exception 'Movimento de entrada com quantidade negativa.'; end if;
  if tm.sentido = 'S' and new.quantidade > 0 and new.estorno_de is null then raise exception 'Movimento de saída com quantidade positiva.'; end if;

  -- custo médio ponderado móvel (por produto, nos locais que compõem custo)
  select * into c from est_custos where produto_id = new.produto_id for update;
  if not found then insert into est_custos(produto_id, empresa_id) values (new.produto_id, new.empresa_id) returning * into c; end if;
  if new.quantidade > 0 and tm.afeta_custo and new.custo_unitario is not null then
    new.valor := round(new.quantidade * new.custo_unitario, 2);
  else
    v_cm := case when c.quantidade > 0 then c.valor / c.quantidade else c.custo_medio end;
    new.custo_unitario := coalesce(case when new.estorno_de is not null then new.custo_unitario end, v_cm);
    new.valor := round(new.quantidade * new.custo_unitario, 2);
  end if;
  if loc.compoe_custo then
    update est_custos set quantidade = quantidade + new.quantidade, valor = valor + new.valor,
      custo_medio = case when quantidade + new.quantidade > 0 then (valor + new.valor) / (quantidade + new.quantidade) else custo_medio end,
      ultima_entrada = case when new.quantidade > 0 and tm.afeta_custo then new.data else ultima_entrada end
     where produto_id = new.produto_id returning * into c;
  end if;
  new.custo_medio_apos := c.custo_medio;

  -- saldo do local
  if loc.controla_saldo then
    insert into est_saldos(empresa_id, produto_id, local_id, lote_id, quantidade, valor, ultimo_movimento)
    values (new.empresa_id, new.produto_id, new.local_id, new.lote_id, new.quantidade, new.valor, new.data)
    on conflict (produto_id, local_id, coalesce(lote_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set quantidade = est_saldos.quantidade + excluded.quantidade, valor = est_saldos.valor + excluded.valor,
                  ultimo_movimento = greatest(est_saldos.ultimo_movimento, excluded.ultimo_movimento)
    returning * into s;
    if s.quantidade < 0 and not loc.permite_negativo then
      raise exception 'Saldo insuficiente de % em %: ficaria %.', pr.codigo, loc.nome, s.quantidade;
    end if;
    new.saldo_local_apos := s.quantidade;
  end if;
  return new;
end $$;
revoke all on function public._est_mov() from public, anon, authenticated;
drop trigger if exists est_movimentos_motor on public.est_movimentos;
create trigger est_movimentos_motor before insert on public.est_movimentos for each row execute function public._est_mov();

-- kardex imutável: corrige-se por estorno
create or replace function public._est_mov_imutavel() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_setting('app.est_recalculo', true) = 'sim' then return coalesce(new, old); end if;
  raise exception 'Movimento de estoque não se altera nem se exclui: use o estorno.';
end $$;
drop trigger if exists est_movimentos_imutavel on public.est_movimentos;
create trigger est_movimentos_imutavel before update or delete on public.est_movimentos for each row execute function public._est_mov_imutavel();

-- estorno: movimento inverso, mesmo custo, data de hoje (ou informada)
create or replace function public.est_estornar(p_mov uuid, p_data date default current_date, p_motivo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m est_movimentos; v uuid;
begin
  select * into m from est_movimentos where id = p_mov;
  if not found then raise exception 'Movimento não encontrado'; end if;
  if not pode_estoque(m.empresa_id) then raise exception 'Sem permissão para movimentar o estoque.'; end if;
  if exists (select 1 from est_movimentos where estorno_de = p_mov) then raise exception 'Movimento já estornado.'; end if;
  insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, estorno_de, documento, observacao, centro_custo_id)
  values (m.empresa_id, p_data, m.produto_id, m.local_id, m.lote_id, m.tipo_movimento_id, -m.quantidade, m.custo_unitario, m.id, m.documento,
          'Estorno' || coalesce(': ' || p_motivo, ''), m.centro_custo_id)
  returning id into v;
  return v;
end $$;

-- transferência entre locais: saída da origem e entrada no destino, ao custo médio
create or replace function public.est_transferir(p_empresa uuid, p_data date, p_produto uuid, p_origem uuid, p_destino uuid, p_qtd numeric,
  p_lote uuid default null, p_tipo uuid default null, p_obs text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare g uuid := gen_random_uuid(); t uuid;
begin
  if not pode_estoque(p_empresa) then raise exception 'Sem permissão para movimentar o estoque.'; end if;
  if p_qtd <= 0 then raise exception 'Quantidade da transferência deve ser positiva.'; end if;
  if p_origem = p_destino then raise exception 'Origem e destino iguais.'; end if;
  t := coalesce(p_tipo, (select id from est_tipos_movimento where empresa_id = p_empresa and codigo = 'TRF'));
  if t is null then raise exception 'Cadastre o tipo de movimento TRF (transferência).'; end if;
  insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, transferencia_id, observacao)
  values (p_empresa, p_data, p_produto, p_origem, p_lote, t, -p_qtd, g, p_obs);
  insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, transferencia_id, observacao)
  values (p_empresa, p_data, p_produto, p_destino, p_lote, t, p_qtd, g, p_obs);
  return g;
end $$;

-- recalcula custo médio e saldos de um produto em ordem cronológica (depois de lançamentos com data retroativa)
create or replace function public.est_recalcular(p_empresa uuid, p_produto uuid)
returns int language plpgsql security definer set search_path = public as $$
declare m record; q numeric := 0; v numeric := 0; cm numeric := 0; n int := 0; val numeric; cu numeric;
begin
  if not pode_editar(p_empresa) then raise exception 'Só administrador ou financeiro recalcula o estoque.'; end if;
  perform set_config('app.est_recalculo', 'sim', true);
  delete from est_saldos where produto_id = p_produto;
  for m in select mv.*, l.compoe_custo, l.controla_saldo, t.afeta_custo from est_movimentos mv join est_locais l on l.id = mv.local_id join est_tipos_movimento t on t.id = mv.tipo_movimento_id
            where mv.empresa_id = p_empresa and mv.produto_id = p_produto order by mv.data, mv.criado_em, mv.quantidade desc loop
    if m.quantidade > 0 and m.afeta_custo and m.estorno_de is null then cu := m.custo_unitario;
    elsif m.estorno_de is not null then cu := m.custo_unitario;
    else cu := case when q > 0 then v / q else cm end; end if;
    val := round(m.quantidade * cu, 2);
    if m.compoe_custo then q := q + m.quantidade; v := v + val; if q > 0 then cm := v / q; end if; end if;
    if m.controla_saldo then
      insert into est_saldos(empresa_id, produto_id, local_id, lote_id, quantidade, valor, ultimo_movimento)
      values (p_empresa, p_produto, m.local_id, m.lote_id, m.quantidade, val, m.data)
      on conflict (produto_id, local_id, coalesce(lote_id, '00000000-0000-0000-0000-000000000000'::uuid))
      do update set quantidade = est_saldos.quantidade + excluded.quantidade, valor = est_saldos.valor + excluded.valor, ultimo_movimento = excluded.ultimo_movimento;
    end if;
    update est_movimentos set custo_unitario = cu, valor = val, custo_medio_apos = cm where id = m.id;
    n := n + 1;
  end loop;
  insert into est_custos(produto_id, empresa_id, quantidade, valor, custo_medio) values (p_produto, p_empresa, q, v, cm)
  on conflict (produto_id) do update set quantidade = excluded.quantidade, valor = excluded.valor, custo_medio = excluded.custo_medio;
  perform set_config('app.est_recalculo', 'nao', true);
  return n;
end $$;

-- fechar / reabrir mês
create or replace function public.est_fechar_mes(p_empresa uuid, p_mes date, p_reabrir boolean default false)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not pode_editar(p_empresa) then raise exception 'Só administrador ou financeiro fecha o estoque.'; end if;
  if p_reabrir then
    if not is_admin(p_empresa) then raise exception 'Só o administrador reabre o mês.'; end if;
    delete from est_fechamentos where empresa_id = p_empresa and mes >= date_trunc('month', p_mes)::date;
    return 'reaberto';
  end if;
  insert into est_fechamentos(empresa_id, mes) values (p_empresa, date_trunc('month', p_mes)::date) on conflict do nothing;
  return 'fechado';
end $$;

-- ---------------------------------------------------------------- parametrização inicial
create or replace function public._est_configurar(p_empresa uuid)
returns text language plpgsql security definer set search_path = public as $$
declare x jsonb; i int := 0;
begin
  -- locais
  insert into est_locais(empresa_id, codigo, nome, finalidade, posse, controla_saldo, compoe_custo, permite_negativo, papeis, ordem) values
    (p_empresa, 'MP',   'Matéria-prima (resinas, master, aditivos)', 'materia_prima', 'propria', true, true, false, null, 10),
    (p_empresa, 'INS',  'Insumos de produção (tintas, solventes, tubetes, embalagens)', 'insumo', 'propria', true, true, false, null, 20),
    (p_empresa, 'ACA',  'Produto acabado', 'acabado', 'propria', true, true, false, null, 60),
    (p_empresa, 'APA',  'Aparas e reprocesso', 'aparas', 'propria', true, true, false, null, 70),
    (p_empresa, 'MAN',  'Manutenção (peças de reposição)', 'manutencao', 'propria', true, true, false, null, 80),
    (p_empresa, 'UC',   'Uso e consumo (EPI, limpeza, escritório)', 'uso_consumo', 'propria', true, true, false, null, 90),
    (p_empresa, 'TER',  'Nosso em poder de terceiros (industrialização, conserto)', 'terceiros', 'em_terceiros', true, true, false, null, 100),
    (p_empresa, 'DTE',  'De terceiros em nosso poder', 'terceiros', 'de_terceiros', true, false, false, null, 110),
    (p_empresa, 'QUA',  'Quarentena (aguardando a qualidade)', 'quarentena', 'propria', true, true, false, null, 120)
  on conflict (empresa_id, codigo) do nothing;
  -- em processo: um por setor da produção (ou um geral)
  for x in select jsonb_build_object('id', id, 'nome', nome, 'ordem', ordem) from prod_setores where empresa_id = p_empresa and coalesce(ativo, true) order by ordem loop
    i := i + 1;
    insert into est_locais(empresa_id, codigo, nome, finalidade, setor_id, ordem)
    values (p_empresa, 'PROC-' || i, 'Em processo — ' || (x->>'nome'), 'processo', (x->>'id')::uuid, 30 + i)
    on conflict (empresa_id, codigo) do nothing;
  end loop;
  if i = 0 then
    insert into est_locais(empresa_id, codigo, nome, finalidade, ordem) values
      (p_empresa, 'PROC-EXT', 'Em processo — Extrusão (bobina, fio)', 'processo', 31),
      (p_empresa, 'PROC-IMP', 'Em processo — Impressão', 'processo', 32),
      (p_empresa, 'PROC-CS',  'Em processo — Corte e solda', 'processo', 33)
    on conflict (empresa_id, codigo) do nothing;
  end if;
  -- famílias
  insert into est_familias(empresa_id, codigo, nome, tipo_sped, local_padrao_id, controla_lote) select p_empresa, f.c, f.n, f.t, (select id from est_locais where empresa_id = p_empresa and codigo = f.l), f.lt
    from (values ('RESINA','Resinas','01','MP',true), ('MASTER','Master e aditivos','01','MP',true), ('TINTA','Tintas e solventes','10','INS',false),
                 ('EMBAL','Embalagens e tubetes','02','INS',false), ('SEMI','Semiacabado (bobina, fio)','03','PROC-1',true), ('ACABADO','Produto acabado','04','ACA',false),
                 ('APARA','Aparas e reprocessado','05','APA',false), ('PECA','Peças de reposição','07','MAN',false), ('EPI','EPI','07','UC',false),
                 ('CONSUMO','Uso e consumo (geral)','07','UC',false), ('LIMPEZA','Limpeza e higiene','07','UC',false), ('ESCRIT','Escritório','07','UC',false), ('REVENDA','Mercadoria para revenda','00','ACA',false),
                 ('IMOB','Ativo imobilizado','08','MAN',false), ('SERV','Serviços','09',null,false), ('OUTROS','Outros','99',null,false)) f(c,n,t,l,lt)
  on conflict (empresa_id, codigo) do nothing;
  update est_familias set local_padrao_id = (select id from est_locais where empresa_id = p_empresa and finalidade = 'processo' order by ordem limit 1)
   where empresa_id = p_empresa and codigo = 'SEMI' and local_padrao_id is null;
  -- tipos de movimento
  insert into est_tipos_movimento(empresa_id, codigo, nome, sentido, afeta_custo, gera_financeiro, documento, sistema, local_origem_id, local_destino_id)
  select p_empresa, t.c, t.n, t.s, t.ac, t.gf, t.d, true, (select id from est_locais where empresa_id = p_empresa and codigo = t.o), (select id from est_locais where empresa_id = p_empresa and codigo = t.de)
    from (values
      ('SI','Saldo inicial (implantação)','E',true,false,'inventario',null,null),
      ('COMPRA','Compra','E',true,true,'nf',null,null),
      ('DEVCLI','Devolução de cliente','E',false,false,'nf',null,'ACA'),
      ('RETTER','Retorno de terceiros (industrialização, conserto)','E',false,false,'nf','TER',null),
      ('ENTTER','Entrada de bem de terceiros','E',false,false,'nf',null,'DTE'),
      ('PROD','Produção (apontamento)','E',true,false,'op',null,null),
      ('APARA','Apara gerada na produção','E',false,false,'op',null,'APA'),
      ('AJ+','Ajuste de inventário (sobra)','E',false,false,'inventario',null,null),
      ('VENDA','Venda','S',false,false,'nf','ACA',null),
      ('DEVFOR','Devolução a fornecedor','S',false,true,'nf',null,null),
      ('REMTER','Remessa para terceiros (industrialização, conserto)','S',false,false,'nf',null,'TER'),
      ('RETDTE','Devolução de bem de terceiros','S',false,false,'nf','DTE',null),
      ('REQPROD','Requisição para a produção','S',false,false,'requisicao',null,null),
      ('REQINT','Requisição interna (uso e consumo, manutenção)','S',false,false,'requisicao',null,null),
      ('PERDA','Perda / sucata','S',false,false,'nenhum',null,null),
      ('AMOSTRA','Amostra / bonificação','S',false,false,'nf','ACA',null),
      ('AJ-','Ajuste de inventário (falta)','S',false,false,'inventario',null,null),
      ('TRF','Transferência entre locais','T',false,false,'nenhum',null,null)) t(c,n,s,ac,gf,d,o,de)
  on conflict (empresa_id, codigo) do nothing;
  -- regras por CFOP (finais; valem para estadual, interestadual e exterior). Entradas: o local vem da família do produto.
  if not exists (select 1 from est_regras_cfop where empresa_id = p_empresa) then
    insert into est_regras_cfop(empresa_id, cfop, sentido, tipo_movimento_id, prioridade, observacao)
    select p_empresa, r.cf, r.se, (select id from est_tipos_movimento where empresa_id = p_empresa and codigo = r.tm), 100, r.ob
      from (values
        ('101','entrada','COMPRA','Compra para industrialização'), ('102','entrada','COMPRA','Compra para comercialização'),
        ('111','entrada','COMPRA','Compra para industrialização (encomenda)'), ('116','entrada','COMPRA','Compra para industrialização originada de encomenda'),
        ('122','entrada','COMPRA','Compra para industrialização (remetida pelo vendedor)'), ('124','entrada','COMPRA','Industrialização efetuada por outra empresa'),
        ('401','entrada','COMPRA','Compra com ST para industrialização'), ('403','entrada','COMPRA','Compra com ST para comercialização'),
        ('407','entrada','COMPRA','Compra com ST para uso e consumo'), ('556','entrada','COMPRA','Compra de material de uso e consumo'),
        ('551','entrada','COMPRA','Compra de ativo imobilizado'), ('201','entrada','DEVCLI','Devolução de venda de produção'), ('202','entrada','DEVCLI','Devolução de venda de mercadoria'),
        ('410','entrada','DEVCLI','Devolução de venda com ST'), ('902','entrada','RETTER','Retorno de industrialização por encomenda'),
        ('916','entrada','RETTER','Retorno de conserto'), ('901','entrada','ENTTER','Entrada para industrialização por encomenda'),
        ('915','entrada','ENTTER','Entrada para conserto'), ('949','entrada',null,'Outra entrada: não movimenta (revise)'),
        ('101','saida','VENDA','Venda de produção'), ('102','saida','VENDA','Venda de mercadoria'), ('105','saida','VENDA','Venda de produção sem transitar'),
        ('116','saida','VENDA','Venda de produção (entrega futura)'), ('118','saida','VENDA','Venda de produção entregue por conta e ordem'),
        ('124','saida','VENDA','Industrialização para outra empresa'), ('401','saida','VENDA','Venda de produção com ST'), ('405','saida','VENDA','Venda de mercadoria com ST'),
        ('201','saida','DEVFOR','Devolução de compra para industrialização'), ('202','saida','DEVFOR','Devolução de compra para comercialização'),
        ('556','saida','DEVFOR','Devolução de compra de uso e consumo'), ('901','saida','REMTER','Remessa para industrialização'), ('915','saida','REMTER','Remessa para conserto'),
        ('902','saida','RETDTE','Retorno de mercadoria usada na industrialização por encomenda'), ('916','saida','RETDTE','Retorno de bem recebido para conserto'),
        ('910','saida','AMOSTRA','Bonificação, doação ou brinde'), ('911','saida','AMOSTRA','Amostra grátis'),
        ('922','saida',null,'Simples faturamento (entrega futura): não movimenta'), ('949','saida',null,'Outra saída: não movimenta (revise)')) r(cf,se,tm,ob);
  end if;
  return 'ok';
end $$;
revoke all on function public._est_configurar(uuid) from public, anon, authenticated;

create or replace function public.est_configurar_padrao(p_empresa uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not pode_editar(p_empresa) then raise exception 'Só administrador ou financeiro configura o estoque.'; end if;
  return _est_configurar(p_empresa);
end $$;

-- empresa nova já nasce com a parametrização padrão
create or replace function public._est_empresa_nova() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform _est_configurar(new.id); return new; end $$;
revoke all on function public._est_empresa_nova() from public, anon, authenticated;
drop trigger if exists empresas_estoque_padrao on public.empresas;
create trigger empresas_estoque_padrao after insert on public.empresas for each row execute function public._est_empresa_nova();

-- cadastro dos produtos vendidos nas NF-e de saída (só os códigos que ainda não existem)
create or replace function public.est_produtos_das_notas(p_empresa uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int; fam uuid; loc uuid;
begin
  if auth.uid() is not null and not pode_editar(p_empresa) then raise exception 'Só administrador ou financeiro cadastra em lote.'; end if;
  select id, local_padrao_id into fam, loc from est_familias where empresa_id = p_empresa and codigo = 'ACABADO';
  insert into produtos(empresa_id, codigo, descricao, tipo, unidade, ncm, origem, familia_id, tipo_sped, local_padrao_id)
  select distinct on (i.cprod) p_empresa, i.cprod, coalesce(nullif(trim(i.xprod), ''), i.cprod), 'produto_acabado', coalesce(nullif(upper(trim(i.ucom)), ''), 'UN'), i.ncm, 'nfe_saida', fam, '04', loc
    from nfe_itens i join nfe_notas n on n.id = i.nota_id
   where n.empresa_id = p_empresa and n.emissao_propria and n.tipo = 'saida' and n.situacao = 'autorizada' and coalesce(trim(i.cprod), '') <> ''
     and right(i.cfop, 3) in ('101','102','105','107','109','116','117','118','122','124','125','401','402','403','405')
     and not exists (select 1 from produtos p where p.empresa_id = p_empresa and p.codigo = i.cprod)
   order by i.cprod, n.emissao desc
  on conflict (empresa_id, codigo) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- segurança
do $$ declare t text; a text; begin
  foreach t in array array['est_locais','est_familias','est_tipos_movimento','est_regras_cfop','est_lotes','est_movimentos','est_saldos','est_custos','est_fechamentos'] loop
    execute format('alter table public.%I enable row level security', t);
    foreach a in array array['sel','ins','upd','del'] loop execute format('drop policy if exists %1$s_%2$s on public.%1$s', t, a); end loop;
    execute format('create policy %1$s_sel on public.%1$s for select to authenticated using (public.is_participante(empresa_id))', t);
  end loop;
  -- parâmetros: administrador e financeiro
  foreach t in array array['est_locais','est_familias','est_tipos_movimento','est_regras_cfop'] loop
    execute format('create policy %1$s_ins on public.%1$s for insert to authenticated with check (public.pode_editar(empresa_id))', t);
    execute format('create policy %1$s_upd on public.%1$s for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id))', t);
    execute format('create policy %1$s_del on public.%1$s for delete to authenticated using (public.pode_editar(empresa_id))', t);
  end loop;
  -- lotes e movimentos: quem movimenta estoque (movimento não se altera nem se exclui: o gatilho bloqueia)
  execute 'create policy est_lotes_ins on public.est_lotes for insert to authenticated with check (public.pode_estoque(empresa_id))';
  execute 'create policy est_lotes_upd on public.est_lotes for update to authenticated using (public.pode_estoque(empresa_id)) with check (public.pode_estoque(empresa_id))';
  execute 'create policy est_movimentos_ins on public.est_movimentos for insert to authenticated with check (public.pode_estoque(empresa_id))';
  -- saldos, custos e fechamentos: só pelas funções (security definer)
end $$;
revoke execute on function public.est_configurar_padrao(uuid), public.est_produtos_das_notas(uuid) from public, anon;
grant execute on function public.est_configurar_padrao(uuid), public.est_produtos_das_notas(uuid), public.est_estornar(uuid, date, text),
  public.est_transferir(uuid, date, uuid, uuid, uuid, numeric, uuid, uuid, text), public.est_recalcular(uuid, uuid), public.est_fechar_mes(uuid, date, boolean),
  public.pode_estoque(uuid), public.papel_em(uuid) to authenticated;

-- produto sem família recebe a da classificação (tipo); tipo SPED, local padrão e lote vêm da família.
-- Trocar a família leva junto o tipo SPED e o local, a menos que tenham sido mudados na mesma gravação.
create or replace function public._est_produto_familia() returns trigger
language plpgsql security definer set search_path = public as $$
declare f est_familias; fo est_familias;
begin
  if new.familia_id is null then
    select * into f from est_familias where empresa_id = new.empresa_id and codigo = case new.tipo
      when 'materia_prima' then 'RESINA' when 'aditivo' then 'MASTER' when 'tinta_solvente' then 'TINTA' when 'embalagem' then 'EMBAL'
      when 'semiacabado' then 'SEMI' when 'produto_acabado' then 'ACABADO' when 'uso_consumo' then 'CONSUMO' when 'peca_manutencao' then 'PECA'
      when 'servico' then 'SERV' else 'OUTROS' end;
    new.familia_id := f.id;
  else
    select * into f from est_familias where id = new.familia_id;
  end if;
  if f.id is null then return new; end if;
  if tg_op = 'UPDATE' and old.familia_id is distinct from new.familia_id and old.familia_id is not null then
    select * into fo from est_familias where id = old.familia_id;
    if new.tipo_sped is not distinct from old.tipo_sped then new.tipo_sped := f.tipo_sped; end if;
    if new.local_padrao_id is not distinct from old.local_padrao_id then new.local_padrao_id := f.local_padrao_id; end if;
    if new.controla_lote is not distinct from old.controla_lote then new.controla_lote := f.controla_lote; end if;
  else
    new.tipo_sped := coalesce(new.tipo_sped, f.tipo_sped);
    new.local_padrao_id := coalesce(new.local_padrao_id, f.local_padrao_id);
    if tg_op = 'INSERT' and f.controla_lote then new.controla_lote := true; end if;
  end if;
  return new;
end $$;
revoke all on function public._est_produto_familia() from public, anon, authenticated;
drop trigger if exists produtos_familia on public.produtos;
create trigger produtos_familia before insert or update of tipo, familia_id, tipo_sped, local_padrao_id on public.produtos for each row execute function public._est_produto_familia();

-- ---------------------------------------------------------------- parametrização inicial de todas as empresas
select public._est_configurar(id) from public.empresas;
update public.produtos set tipo = tipo where familia_id is null;   -- produtos já cadastrados recebem a família

-- conferência: locais, famílias, tipos de movimento e regras por empresa
select e.nome, (select count(*) from public.est_locais l where l.empresa_id = e.id) as locais, (select count(*) from public.est_familias f where f.empresa_id = e.id) as familias,
       (select count(*) from public.est_tipos_movimento t where t.empresa_id = e.id) as tipos_movimento, (select count(*) from public.est_regras_cfop r where r.empresa_id = e.id) as regras_cfop
  from public.empresas e order by e.nome;
