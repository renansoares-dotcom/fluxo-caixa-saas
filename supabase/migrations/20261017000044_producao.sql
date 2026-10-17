-- =====================================================================
-- Etapa 5 — PCP e Produção (embalagens flexíveis: extrusão → impressão → corte/solda, rebobinamento, recuperação).
-- Decisão de 17/10/2026: a plataforma faz tudo (OP, programação, apontamento, bobinas/etiquetas, rastreabilidade,
-- indicadores), mas enquanto o trabalho continua no Iniflex os dados entram por IMPORTAÇÃO; quando a plataforma virar
-- o sistema principal, os mesmos registros passam a ser lançados aqui (coluna origem = 'iniflex' | 'plataforma').
-- Apontamento em terminal por setor, cada operador com o próprio acesso: perfil novo "producao".
-- Migração ADITIVA, com uma alteração em função existente: is_membro passa a excluir também "producao"
-- (o operador não deve ler financeiro, lançamentos, saldos).
-- =====================================================================

alter type public.papel_membro add value if not exists 'producao';

create or replace function public.is_membro(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text not in ('compras', 'vendas', 'producao'));
$$;

-- planeja e mantém cadastros de produção: admin, financeiro, diretor
create or replace function public.pode_pcp(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor'));
$$;
-- aponta produção: os de cima e o operador
create or replace function public.pode_apontar(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'producao'));
$$;
-- lê produção: membros internos e operadores
create or replace function public.ve_producao(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'leitura', 'producao'));
$$;

-- ---------- cadastros ----------
create table if not exists public.prod_setores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  ordem smallint not null default 0,          -- posição no fluxo (extrusão 1, impressão 2, corte e solda 3…)
  horas_dia numeric(5,2) not null default 24, -- horas produtivas por dia (capacidade e OEE)
  ativo boolean not null default true,
  unique (empresa_id, nome)
);
create table if not exists public.prod_maquinas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  setor_id uuid not null references public.prod_setores(id),
  codigo text not null,
  nome text not null,
  capacidade_kg_h numeric(10,2),              -- velocidade nominal (performance do OEE)
  ativo boolean not null default true,
  observacao text,
  unique (empresa_id, codigo)
);
create table if not exists public.prod_motivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('parada', 'refugo')),
  nome text not null,
  planejada boolean not null default false,   -- parada planejada (setup, limpeza programada) não derruba a disponibilidade
  ativo boolean not null default true,
  unique (empresa_id, tipo, nome)
);
create table if not exists public.prod_operadores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  user_id uuid references auth.users(id) on delete set null,
  setores uuid[] not null default '{}',
  matricula text,
  ativo boolean not null default true,
  unique (empresa_id, user_id)
);
-- roteiro do produto: etapas na ordem, com máquina padrão
create table if not exists public.prod_roteiros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  seq smallint not null,
  setor_id uuid not null references public.prod_setores(id),
  maquina_id uuid references public.prod_maquinas(id) on delete set null,
  velocidade_kg_h numeric(10,2),
  setup_min numeric(8,2),
  observacao text,
  unique (produto_id, seq)
);
-- clichês, cilindros e facas
create table if not exists public.prod_ferramentas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('cliche', 'cilindro', 'faca', 'outro')),
  codigo text not null,
  descricao text,
  produto_id uuid references public.produtos(id) on delete set null,
  favorecido_id uuid references public.favorecidos(id) on delete set null,   -- cliente dono da arte
  cores smallint,
  vida_util_m numeric(14,2),
  metros_usados numeric(14,2) not null default 0,
  localizacao text,
  situacao text not null default 'ativa' check (situacao in ('ativa', 'manutencao', 'descartada')),
  observacao text,
  unique (empresa_id, codigo)
);

-- ---------- ordens de produção ----------
create table if not exists public.prod_ordens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null default 0,
  numero_iniflex text,                         -- nº da OP no Iniflex (importação)
  origem text not null default 'plataforma' check (origem in ('plataforma', 'iniflex')),
  produto_id uuid references public.produtos(id) on delete set null,
  codigo_produto text, descricao text,         -- como veio (mesmo sem cadastro)
  quantidade numeric(16,3) not null check (quantidade > 0),
  unidade text not null default 'KG',
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  cliente text,
  pedido_iniflex text,
  emissao date not null default current_date,
  entrega date,
  prioridade smallint not null default 3 check (prioridade between 1 and 5),   -- 1 = mais urgente
  status text not null default 'planejada' check (status in ('planejada', 'liberada', 'em_producao', 'concluida', 'cancelada')),
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  concluida_em timestamptz,
  unique (empresa_id, numero)
);
create unique index if not exists prod_ordens_iniflex on public.prod_ordens(empresa_id, numero_iniflex) where numero_iniflex is not null;
create index if not exists prod_ordens_status on public.prod_ordens(empresa_id, status);

create table if not exists public.prod_ordem_etapas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.prod_ordens(id) on delete cascade,
  seq smallint not null,
  setor_id uuid not null references public.prod_setores(id),
  maquina_id uuid references public.prod_maquinas(id) on delete set null,
  qtd_prevista numeric(16,3),
  inicio_previsto date, fim_previsto date,
  horas_previstas numeric(8,2),
  status text not null default 'aguardando' check (status in ('aguardando', 'em_andamento', 'concluida')),
  qtd_boa numeric(16,3) not null default 0,
  refugo numeric(16,3) not null default 0,
  unique (ordem_id, seq)
);
create index if not exists prod_etapas_maquina on public.prod_ordem_etapas(maquina_id, inicio_previsto);

-- ---------- chão de fábrica ----------
create table if not exists public.prod_apontamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.prod_ordens(id) on delete cascade,
  etapa_id uuid references public.prod_ordem_etapas(id) on delete set null,
  setor_id uuid references public.prod_setores(id),
  maquina_id uuid references public.prod_maquinas(id),
  operador_id uuid references public.prod_operadores(id) on delete set null,
  operador_nome text,
  turno text,
  inicio timestamptz not null default now(),
  fim timestamptz,
  qtd_boa numeric(16,3) not null default 0,     -- na unidade da OP (normalmente kg)
  refugo numeric(16,3) not null default 0,      -- apara/refugo em kg
  refugo_motivo_id uuid references public.prod_motivos(id) on delete set null,
  observacao text,
  origem text not null default 'plataforma' check (origem in ('plataforma', 'iniflex')),
  chave_importacao text,                        -- evita importar a mesma linha duas vezes
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);
create unique index if not exists prod_apont_chave on public.prod_apontamentos(empresa_id, chave_importacao) where chave_importacao is not null;
create index if not exists prod_apont_ordem on public.prod_apontamentos(ordem_id);
create index if not exists prod_apont_maq on public.prod_apontamentos(maquina_id, inicio);

create table if not exists public.prod_paradas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  maquina_id uuid not null references public.prod_maquinas(id),
  ordem_id uuid references public.prod_ordens(id) on delete set null,
  motivo_id uuid references public.prod_motivos(id) on delete set null,
  inicio timestamptz not null default now(),
  fim timestamptz,
  operador_id uuid references public.prod_operadores(id) on delete set null,
  observacao text,
  origem text not null default 'plataforma' check (origem in ('plataforma', 'iniflex')),
  criado_por uuid default auth.uid(),
  check (fim is null or fim >= inicio)
);
create index if not exists prod_paradas_maq on public.prod_paradas(maquina_id, inicio);

-- bobinas (ou volumes) produzidas: cada uma tem etiqueta com código; a "mãe" liga a bobina impressa à extrudada
create table if not exists public.prod_bobinas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  ordem_id uuid not null references public.prod_ordens(id) on delete cascade,
  etapa_id uuid references public.prod_ordem_etapas(id) on delete set null,
  apontamento_id uuid references public.prod_apontamentos(id) on delete set null,
  maquina_id uuid references public.prod_maquinas(id),
  peso_kg numeric(12,3) not null check (peso_kg > 0),
  metros numeric(14,2),
  quantidade numeric(16,3),                     -- unidades/milheiros quando for saco/sacola
  mae_id uuid references public.prod_bobinas(id) on delete set null,
  lote_materia text,                            -- lote/NF da resina usada (extrusão)
  situacao text not null default 'estoque' check (situacao in ('estoque', 'consumida', 'expedida', 'refugada')),
  operador_id uuid references public.prod_operadores(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists prod_bobinas_ordem on public.prod_bobinas(ordem_id);
create index if not exists prod_bobinas_mae on public.prod_bobinas(mae_id);

-- consumo real de matéria-prima por OP (para custo real × teórico e rastreabilidade do lote)
create table if not exists public.prod_consumos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.prod_ordens(id) on delete cascade,
  apontamento_id uuid references public.prod_apontamentos(id) on delete set null,
  produto_id uuid references public.produtos(id) on delete set null,
  codigo text,
  quantidade numeric(16,4) not null check (quantidade > 0),
  lote text,                                    -- lote do fornecedor / nº da NF de entrada
  origem text not null default 'plataforma' check (origem in ('plataforma', 'iniflex')),
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists prod_consumos_ordem on public.prod_consumos(ordem_id);

-- ---------- gatilhos ----------
drop trigger if exists prod_ordens_numero on public.prod_ordens;
create trigger prod_ordens_numero before insert on public.prod_ordens for each row execute function public._compras_numero();

-- apontamento: soma na etapa e põe a OP em produção
create or replace function public._prod_apont_soma() returns trigger language plpgsql security definer set search_path = public as $$
declare eid uuid := coalesce(new.etapa_id, old.etapa_id); oid uuid := coalesce(new.ordem_id, old.ordem_id);
begin
  if eid is not null then
    update prod_ordem_etapas e set qtd_boa = coalesce((select sum(qtd_boa) from prod_apontamentos where etapa_id = eid), 0),
           refugo = coalesce((select sum(refugo) from prod_apontamentos where etapa_id = eid), 0),
           status = case when e.status = 'concluida' then 'concluida'
                         when exists(select 1 from prod_apontamentos where etapa_id = eid) then 'em_andamento' else 'aguardando' end
     where e.id = eid;
  end if;
  update prod_ordens set status = 'em_producao' where id = oid and status in ('planejada', 'liberada') and tg_op <> 'DELETE';
  return null;
end $$;
drop trigger if exists prod_apont_soma on public.prod_apontamentos;
create trigger prod_apont_soma after insert or update or delete on public.prod_apontamentos for each row execute function public._prod_apont_soma();

create or replace function public._prod_ordem_regras() returns trigger language plpgsql as $$
begin
  if new.status = 'concluida' and (tg_op = 'INSERT' or old.status <> 'concluida') then new.concluida_em := now(); end if;
  if new.status <> 'concluida' then new.concluida_em := null; end if;
  return new;
end $$;
drop trigger if exists prod_ordem_regras on public.prod_ordens;
create trigger prod_ordem_regras before insert or update on public.prod_ordens for each row execute function public._prod_ordem_regras();

-- bobina com mãe: a mãe passa a "consumida"
create or replace function public._prod_bobina_mae() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.mae_id is not null then update prod_bobinas set situacao = 'consumida' where id = new.mae_id and situacao = 'estoque'; end if;
  return null;
end $$;
drop trigger if exists prod_bobina_mae on public.prod_bobinas;
create trigger prod_bobina_mae after insert on public.prod_bobinas for each row execute function public._prod_bobina_mae();

-- operador ligado ao usuário que está no terminal
create or replace function public.meu_operador(p_empresa uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from prod_operadores where empresa_id = p_empresa and user_id = auth.uid() and ativo limit 1;
$$;

-- importação do Iniflex: OPs (upsert pelo nº do Iniflex; liga o produto pelo código; cria as etapas pelo roteiro na 1ª vez)
-- p_itens: [{numero_iniflex, codigo_produto, descricao, quantidade, unidade, cliente, cliente_doc, pedido, emissao, entrega, status}]
create or replace function public.prod_importar_ordens(p_empresa uuid, p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x record; oid uuid; novo boolean; n_novo int := 0; n_at int := 0; pr uuid; fav uuid;
begin
  if not pode_pcp(p_empresa) then raise exception 'Só admin, financeiro ou diretor importa ordens.'; end if;
  for x in select * from jsonb_to_recordset(p_itens) as t(numero_iniflex text, codigo_produto text, descricao text, quantidade numeric, unidade text,
                                                          cliente text, cliente_doc text, pedido text, emissao date, entrega date, status text) loop
    if coalesce(trim(x.numero_iniflex), '') = '' or coalesce(x.quantidade, 0) <= 0 then continue; end if;
    select id into pr from produtos where empresa_id = p_empresa and codigo = trim(x.codigo_produto);
    select id into fav from favorecidos where empresa_id = p_empresa and tipo in ('CLIENTES', 'TERCEIROS - CLIENTES')
       and regexp_replace(coalesce(documento, ''), '\D', '', 'g') = regexp_replace(coalesce(x.cliente_doc, ''), '\D', '', 'g') and coalesce(x.cliente_doc, '') <> '' limit 1;
    select id into oid from prod_ordens where empresa_id = p_empresa and numero_iniflex = trim(x.numero_iniflex);
    novo := oid is null;
    if novo then
      insert into prod_ordens (empresa_id, numero_iniflex, origem, produto_id, codigo_produto, descricao, quantidade, unidade, favorecido_id, cliente, pedido_iniflex, emissao, entrega, status)
      values (p_empresa, trim(x.numero_iniflex), 'iniflex', pr, x.codigo_produto, x.descricao, x.quantidade, coalesce(nullif(upper(trim(x.unidade)), ''), 'KG'), fav, x.cliente, x.pedido,
              coalesce(x.emissao, current_date), x.entrega, coalesce(nullif(x.status, ''), 'liberada'))
      returning id into oid;
      insert into prod_ordem_etapas (empresa_id, ordem_id, seq, setor_id, maquina_id, qtd_prevista)
      select p_empresa, oid, r.seq, r.setor_id, r.maquina_id, x.quantidade from prod_roteiros r where r.produto_id = pr order by r.seq;
      n_novo := n_novo + 1;
    else
      update prod_ordens set quantidade = x.quantidade, entrega = coalesce(x.entrega, entrega), produto_id = coalesce(produto_id, pr), favorecido_id = coalesce(favorecido_id, fav),
             status = case when x.status in ('concluida', 'cancelada') then x.status else status end
       where id = oid;
      n_at := n_at + 1;
    end if;
  end loop;
  return jsonb_build_object('novas', n_novo, 'atualizadas', n_at);
end $$;

-- importação do Iniflex: apontamentos (ligados à OP pelo nº do Iniflex e à máquina pelo código)
-- p_itens: [{numero_iniflex, maquina, operador, inicio, fim, qtd_boa, refugo, turno, chave}]
create or replace function public.prod_importar_apontamentos(p_empresa uuid, p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x record; o prod_ordens; mq prod_maquinas; et uuid; n int := 0; sem_op int := 0; dup int := 0;
begin
  if not pode_pcp(p_empresa) then raise exception 'Só admin, financeiro ou diretor importa apontamentos.'; end if;
  for x in select * from jsonb_to_recordset(p_itens) as t(numero_iniflex text, maquina text, operador text, inicio timestamptz, fim timestamptz,
                                                          qtd_boa numeric, refugo numeric, turno text, chave text) loop
    select * into o from prod_ordens where empresa_id = p_empresa and numero_iniflex = trim(x.numero_iniflex);
    if o.id is null then sem_op := sem_op + 1; continue; end if;
    select * into mq from prod_maquinas where empresa_id = p_empresa and (codigo = trim(x.maquina) or nome = trim(x.maquina)) limit 1;
    select id into et from prod_ordem_etapas where ordem_id = o.id and (mq.id is null or setor_id = mq.setor_id) order by seq limit 1;
    begin
      insert into prod_apontamentos (empresa_id, ordem_id, etapa_id, setor_id, maquina_id, operador_nome, turno, inicio, fim, qtd_boa, refugo, origem, chave_importacao)
      values (p_empresa, o.id, et, mq.setor_id, mq.id, x.operador, x.turno, coalesce(x.inicio, now()), x.fim, coalesce(x.qtd_boa, 0), coalesce(x.refugo, 0), 'iniflex',
              coalesce(nullif(x.chave, ''), md5(concat_ws('|', x.numero_iniflex, x.maquina, x.inicio, x.fim, x.qtd_boa, x.refugo))));
      n := n + 1;
    exception when unique_violation then dup := dup + 1;
    end;
  end loop;
  return jsonb_build_object('importados', n, 'sem_op', sem_op, 'repetidos', dup);
end $$;

revoke all on function public.prod_importar_ordens(uuid, jsonb), public.prod_importar_apontamentos(uuid, jsonb) from public, anon;
grant execute on function public.prod_importar_ordens(uuid, jsonb), public.prod_importar_apontamentos(uuid, jsonb), public.pode_pcp(uuid), public.pode_apontar(uuid),
  public.ve_producao(uuid), public.meu_operador(uuid) to authenticated;

-- ---------- acesso ----------
do $$
declare t text;
begin
  -- cadastros e OPs: leitura de quem vê produção; escrita do PCP
  foreach t in array array['prod_setores', 'prod_maquinas', 'prod_motivos', 'prod_operadores', 'prod_roteiros', 'prod_ferramentas', 'prod_ordens', 'prod_ordem_etapas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_producao(empresa_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id))', t || '_all', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
  -- chão de fábrica: lê quem vê produção; aponta quem pode apontar; operador só altera/exclui o que ele mesmo lançou
  foreach t in array array['prod_apontamentos', 'prod_paradas', 'prod_bobinas', 'prod_consumos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_producao(empresa_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_apontar(empresa_id))', t || '_ins', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
  execute 'create policy prod_apontamentos_upd on public.prod_apontamentos for update to authenticated using (public.pode_pcp(empresa_id) or (public.pode_apontar(empresa_id) and criado_por = (select auth.uid()))) with check (public.pode_apontar(empresa_id))';
  execute 'create policy prod_apontamentos_del on public.prod_apontamentos for delete to authenticated using (public.pode_pcp(empresa_id) or (public.pode_apontar(empresa_id) and criado_por = (select auth.uid()) and criado_em > now() - interval ''1 day''))';
  execute 'create policy prod_paradas_upd on public.prod_paradas for update to authenticated using (public.pode_pcp(empresa_id) or (public.pode_apontar(empresa_id) and criado_por = (select auth.uid()))) with check (public.pode_apontar(empresa_id))';
  execute 'create policy prod_paradas_del on public.prod_paradas for delete to authenticated using (public.pode_pcp(empresa_id))';
  execute 'create policy prod_bobinas_upd on public.prod_bobinas for update to authenticated using (public.pode_apontar(empresa_id)) with check (public.pode_apontar(empresa_id))';
  execute 'create policy prod_bobinas_del on public.prod_bobinas for delete to authenticated using (public.pode_pcp(empresa_id))';
  execute 'create policy prod_consumos_upd on public.prod_consumos for update to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id))';
  execute 'create policy prod_consumos_del on public.prod_consumos for delete to authenticated using (public.pode_pcp(empresa_id) or (public.pode_apontar(empresa_id) and criado_por = (select auth.uid())))';
end $$;

-- o operador precisa enxergar produtos (descrição na OP) — produtos já é legível por qualquer participante (migração 041)

-- ---------- auditoria ----------
do $$
declare t text;
begin
  foreach t in array array['prod_setores', 'prod_maquinas', 'prod_motivos', 'prod_operadores', 'prod_roteiros', 'prod_ferramentas', 'prod_ordens', 'prod_ordem_etapas',
                           'prod_apontamentos', 'prod_paradas', 'prod_bobinas', 'prod_consumos'] loop
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;
