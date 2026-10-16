-- =====================================================================
-- Etapa 2 — Compras: requisição → aprovação → cotação → pedido (alçada) → previsão no contas a pagar
-- → recebimento casado com a NF-e de entrada → parcelas da nota no contas a pagar.
-- Migração ADITIVA: só cria tabelas, funções e gatilhos novos. Nenhuma tabela existente é alterada.
-- Os lançamentos criados pelo módulo ficam ligados ao pedido em compras_pedido_lancamentos.
-- =====================================================================

-- ---------- quem pode o quê ----------
-- opera o módulo: admin, financeiro, diretor e compras
create or replace function public.pode_comprar(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid()
                and papel::text in ('admin', 'financeiro', 'diretor', 'compras'));
$$;
-- aprova requisição e pedido acima da alçada: admin e diretor
create or replace function public.pode_aprovar_compra(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid()
                and papel::text in ('admin', 'diretor'));
$$;

-- ---------- parâmetros ----------
create table if not exists public.compras_parametros (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  alcada_valor numeric(16,2) not null default 5000,          -- pedido acima disso precisa de admin/diretor
  previsao_automatica boolean not null default true,         -- pedido aprovado gera previsão no contas a pagar
  atualizado_em timestamptz not null default now()
);

-- ---------- requisições ----------
create table if not exists public.compras_requisicoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null default 0,
  solicitante text,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  necessidade date,
  prioridade text not null default 'normal' check (prioridade in ('normal', 'urgente')),
  status text not null default 'pendente' check (status in ('pendente', 'aprovada', 'rejeitada', 'atendida', 'cancelada')),
  observacao text,
  motivo text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  decidido_por uuid references auth.users(id),
  decidido_em timestamptz,
  unique (empresa_id, numero)
);
create table if not exists public.compras_requisicao_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  requisicao_id uuid not null references public.compras_requisicoes(id) on delete cascade,
  descricao text not null,
  unidade text not null default 'UN',
  quantidade numeric(16,4) not null check (quantidade > 0),
  valor_estimado numeric(16,4),                      -- unitário estimado (opcional)
  ncm text,
  observacao text
);
create index if not exists compras_req_emp on public.compras_requisicoes(empresa_id, status);
create index if not exists compras_req_itens_req on public.compras_requisicao_itens(requisicao_id);

-- ---------- cotações ----------
create table if not exists public.compras_cotacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  requisicao_id uuid not null references public.compras_requisicoes(id) on delete cascade,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  fornecedor text not null,                           -- nome como veio na proposta (fornecedor pode não ter cadastro ainda)
  prazo_entrega_dias int,
  condicao_pagamento text,
  parcelas_dias int[] not null default '{28}',
  frete numeric(16,2) not null default 0,
  validade date,
  escolhida boolean not null default false,
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create table if not exists public.compras_cotacao_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cotacao_id uuid not null references public.compras_cotacoes(id) on delete cascade,
  requisicao_item_id uuid not null references public.compras_requisicao_itens(id) on delete cascade,
  valor_unitario numeric(16,4) not null check (valor_unitario >= 0),
  unique (cotacao_id, requisicao_item_id)
);
create index if not exists compras_cot_req on public.compras_cotacoes(requisicao_id);
create index if not exists compras_cot_itens_cot on public.compras_cotacao_itens(cotacao_id);

-- ---------- pedidos ----------
create table if not exists public.compras_pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null default 0,
  favorecido_id uuid not null references public.favorecidos(id),
  data_pedido date not null default current_date,
  entrega_prevista date,
  condicao_pagamento text,
  parcelas_dias int[] not null default '{28}',        -- dias após a entrega prevista (ou a data do pedido)
  plano_id uuid references public.plano_contas(id) on delete set null,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  frete numeric(16,2) not null default 0,
  desconto numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0,             -- calculado: itens + frete − desconto
  status text not null default 'rascunho' check (status in ('rascunho', 'aguardando', 'aprovado', 'enviado', 'recebido_parcial', 'recebido', 'cancelado')),
  pedido_iniflex text,                                -- número do pedido no Iniflex (referência)
  requisicao_id uuid references public.compras_requisicoes(id) on delete set null,
  cotacao_id uuid references public.compras_cotacoes(id) on delete set null,
  observacao text,
  motivo text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  aprovado_por uuid references auth.users(id),
  aprovado_em timestamptz,
  unique (empresa_id, numero)
);
create table if not exists public.compras_pedido_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pedido_id uuid not null references public.compras_pedidos(id) on delete cascade,
  requisicao_item_id uuid references public.compras_requisicao_itens(id) on delete set null,
  descricao text not null,
  unidade text not null default 'UN',
  ncm text,
  quantidade numeric(16,4) not null check (quantidade > 0),
  valor_unitario numeric(16,4) not null default 0 check (valor_unitario >= 0),
  qtd_recebida numeric(16,4) not null default 0
);
create index if not exists compras_ped_emp on public.compras_pedidos(empresa_id, status);
create index if not exists compras_ped_fav on public.compras_pedidos(favorecido_id);
create index if not exists compras_ped_itens_ped on public.compras_pedido_itens(pedido_id);

-- ---------- recebimentos ----------
create table if not exists public.compras_recebimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pedido_id uuid not null references public.compras_pedidos(id) on delete cascade,
  nfe_nota_id uuid references public.nfe_notas(id) on delete set null,
  data date not null default current_date,
  divergencias jsonb not null default '[]'::jsonb,   -- fotografia da conferência pedido × nota
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create table if not exists public.compras_recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  recebimento_id uuid not null references public.compras_recebimentos(id) on delete cascade,
  pedido_item_id uuid not null references public.compras_pedido_itens(id) on delete cascade,
  nfe_item_id uuid references public.nfe_itens(id) on delete set null,
  quantidade numeric(16,4) not null check (quantidade > 0),
  valor_unitario numeric(16,4)
);
create index if not exists compras_rec_ped on public.compras_recebimentos(pedido_id);
create index if not exists compras_rec_nota on public.compras_recebimentos(nfe_nota_id);
create index if not exists compras_rec_itens_rec on public.compras_recebimento_itens(recebimento_id);

-- ---------- pedido × lançamentos (previsão e parcelas da nota) ----------
create table if not exists public.compras_pedido_lancamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pedido_id uuid not null references public.compras_pedidos(id) on delete cascade,
  lancamento_id uuid not null references public.lancamentos(id) on delete cascade,
  tipo text not null check (tipo in ('previsao', 'nota')),
  criado_em timestamptz not null default now(),
  unique (lancamento_id)
);
create index if not exists compras_ped_lanc_ped on public.compras_pedido_lancamentos(pedido_id);

-- ---------- numeração ----------
create or replace function public._compras_numero() returns trigger language plpgsql as $$
begin
  if coalesce(new.numero, 0) = 0 then
    execute format('select coalesce(max(numero), 0) + 1 from %I.%I where empresa_id = $1', tg_table_schema, tg_table_name)
      into new.numero using new.empresa_id;
  end if;
  return new;
end $$;
drop trigger if exists compras_req_numero on public.compras_requisicoes;
create trigger compras_req_numero before insert on public.compras_requisicoes for each row execute function public._compras_numero();
drop trigger if exists compras_ped_numero on public.compras_pedidos;
create trigger compras_ped_numero before insert on public.compras_pedidos for each row execute function public._compras_numero();

-- ---------- regras da requisição ----------
create or replace function public._compras_req_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status in ('aprovada', 'rejeitada') then
      if old.status <> 'pendente' then raise exception 'Só requisição pendente pode ser aprovada ou rejeitada.'; end if;
      if not pode_aprovar_compra(new.empresa_id) then raise exception 'Só a direção (admin ou diretor) aprova ou rejeita requisição.'; end if;
      if new.status = 'rejeitada' and coalesce(trim(new.motivo), '') = '' then raise exception 'Informe o motivo da rejeição.'; end if;
      new.decidido_por := auth.uid(); new.decidido_em := now();
    elsif new.status = 'pendente' then
      if old.status <> 'rejeitada' then raise exception 'Mudança de situação não permitida: % → %', old.status, new.status; end if;
      new.decidido_por := null; new.decidido_em := null;            -- reenviada depois de corrigida
    elsif new.status = 'atendida' then
      if old.status <> 'aprovada' then raise exception 'Só requisição aprovada vira pedido.'; end if;
    elsif new.status = 'cancelada' then
      if old.status = 'atendida' then raise exception 'Requisição já atendida por pedido não pode ser cancelada.'; end if;
    else
      raise exception 'Mudança de situação não permitida: % → %', old.status, new.status;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists compras_req_regras on public.compras_requisicoes;
create trigger compras_req_regras before update on public.compras_requisicoes for each row execute function public._compras_req_regras();

-- ---------- total do pedido ----------
create or replace function public._compras_total_itens(p_pedido uuid) returns numeric
language sql stable set search_path = public as $$
  select coalesce(round(sum(quantidade * valor_unitario), 2), 0) from compras_pedido_itens where pedido_id = p_pedido;
$$;
create or replace function public._compras_itens_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.pedido_id, old.pedido_id); st text;
begin
  select status into st from compras_pedidos where id = pid;
  -- itens só mudam com o pedido em rascunho ou aguardando (a quantidade recebida é atualizada pelo recebimento)
  if st not in ('rascunho', 'aguardando') and not (tg_op = 'UPDATE' and new.quantidade = old.quantidade and new.valor_unitario = old.valor_unitario
      and new.descricao = old.descricao) then
    raise exception 'Pedido já aprovado: itens não podem mudar. Volte o pedido para rascunho (se não tiver recebimento) ou cancele.';
  end if;
  update compras_pedidos set total = _compras_total_itens(pid) + frete - desconto where id = pid;
  return null;
end $$;
drop trigger if exists compras_itens_total on public.compras_pedido_itens;
create trigger compras_itens_total after insert or update or delete on public.compras_pedido_itens for each row execute function public._compras_itens_total();

-- ---------- previsão no contas a pagar ----------
-- refaz a previsão do pedido pelo valor ainda não recebido: apaga as previsões em aberto e cria de novo pelas parcelas.
create or replace function public._compras_refazer_previsao(p_pedido uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p compras_pedidos; f text; base date; tot_itens numeric; rec_itens numeric; restante numeric; pagos numeric;
  n int; i int; parc numeric; acum numeric := 0; lid uuid;
begin
  select * into p from compras_pedidos where id = p_pedido;
  delete from lancamentos where id in (select lancamento_id from compras_pedido_lancamentos where pedido_id = p_pedido and tipo = 'previsao')
     and status = 'Em aberto';
  if p.status not in ('aprovado', 'enviado', 'recebido_parcial') or p.plano_id is null then return; end if;
  if not coalesce((select previsao_automatica from compras_parametros where empresa_id = p.empresa_id), true) then return; end if;
  select coalesce(sum(quantidade * valor_unitario), 0), coalesce(sum(least(qtd_recebida, quantidade) * valor_unitario), 0)
    into tot_itens, rec_itens from compras_pedido_itens where pedido_id = p_pedido;
  restante := case when tot_itens > 0 then round(p.total * (1 - rec_itens / tot_itens), 2) else p.total end;
  select coalesce(sum(l.valor), 0) into pagos from compras_pedido_lancamentos pl join lancamentos l on l.id = pl.lancamento_id
    where pl.pedido_id = p_pedido and pl.tipo = 'previsao';                      -- previsão que alguém baixou como paga continua valendo
  restante := restante - pagos;
  if restante <= 0 then return; end if;
  select nome into f from favorecidos where id = p.favorecido_id;
  base := coalesce(p.entrega_prevista, p.data_pedido);
  n := greatest(coalesce(array_length(p.parcelas_dias, 1), 0), 1);
  for i in 1..n loop
    parc := case when i = n then restante - acum else round(restante / n, 2) end;
    acum := acum + parc;
    insert into lancamentos (empresa_id, data, plano_id, descricao, favorecido_id, centro_custo_id, status, valor, origem, documento)
    values (p.empresa_id, base + coalesce(p.parcelas_dias[i], 0), p.plano_id,
            left(format('PC %s — %s — previsão de compra%s', p.numero, f, case when n > 1 then format(' (%s/%s)', i, n) else '' end), 250),
            p.favorecido_id, p.centro_custo_id, 'Em aberto', parc, 'compras:previsao', 'PC ' || p.numero)
    returning id into lid;
    insert into compras_pedido_lancamentos (empresa_id, pedido_id, lancamento_id, tipo) values (p.empresa_id, p_pedido, lid, 'previsao');
  end loop;
end $$;
revoke all on function public._compras_refazer_previsao(uuid) from public, anon, authenticated;

-- ---------- regras do pedido ----------
create or replace function public._compras_ped_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare alc numeric; tem_rec boolean;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('rascunho', 'aguardando') then raise exception 'Pedido novo começa em rascunho.'; end if;
    new.total := new.frete - new.desconto;            -- os itens somam depois
    return new;
  end if;
  new.total := _compras_total_itens(new.id) + new.frete - new.desconto;
  if new.status is distinct from old.status then
    select exists(select 1 from compras_recebimentos where pedido_id = new.id) into tem_rec;
    if new.status = 'aprovado' and old.status in ('rascunho', 'aguardando') then
      if new.total <= 0 then raise exception 'Pedido sem valor.'; end if;
      if new.plano_id is null then raise exception 'Informe a classificação (plano de contas) antes de aprovar.'; end if;
      select coalesce((select alcada_valor from compras_parametros where empresa_id = new.empresa_id), 5000) into alc;
      if not (pode_aprovar_compra(new.empresa_id) or (pode_comprar(new.empresa_id) and new.total <= alc)) then
        raise exception 'Pedido de % acima da alçada de %: precisa de aprovação da direção.', replace(to_char(new.total, 'FM999999999990.00'), '.', ','), replace(to_char(alc, 'FM999999999990.00'), '.', ',');
      end if;
      new.aprovado_por := auth.uid(); new.aprovado_em := now();
    elsif new.status = 'aguardando' and old.status = 'rascunho' then null;
    elsif new.status = 'rascunho' and old.status in ('aguardando', 'aprovado', 'enviado') then
      if tem_rec then raise exception 'Pedido com recebimento não volta para rascunho.'; end if;
      new.aprovado_por := null; new.aprovado_em := null;
    elsif new.status = 'enviado' and old.status = 'aprovado' then null;
    elsif new.status in ('recebido_parcial', 'recebido') and old.status in ('aprovado', 'enviado', 'recebido_parcial') then null;
    elsif new.status = 'cancelado' then
      if old.status = 'recebido' then raise exception 'Pedido já recebido não pode ser cancelado.'; end if;
      if coalesce(trim(new.motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
    else
      raise exception 'Mudança de situação não permitida: % → %', old.status, new.status;
    end if;
  elsif old.status not in ('rascunho', 'aguardando') and (new.favorecido_id is distinct from old.favorecido_id or new.frete is distinct from old.frete
        or new.desconto is distinct from old.desconto) then
    raise exception 'Pedido já aprovado: fornecedor e valores não mudam. Volte para rascunho ou cancele.';
  end if;
  return new;
end $$;
drop trigger if exists compras_ped_regras on public.compras_pedidos;
create trigger compras_ped_regras before insert or update on public.compras_pedidos for each row execute function public._compras_ped_regras();

-- depois de mudar situação, classificação, parcelas ou entrega: refaz a previsão
create or replace function public._compras_ped_previsao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status or new.plano_id is distinct from old.plano_id or new.centro_custo_id is distinct from old.centro_custo_id
     or new.parcelas_dias is distinct from old.parcelas_dias or new.entrega_prevista is distinct from old.entrega_prevista or new.total is distinct from old.total then
    perform _compras_refazer_previsao(new.id);
  end if;
  return null;
end $$;
drop trigger if exists compras_ped_previsao on public.compras_pedidos;
create trigger compras_ped_previsao after update on public.compras_pedidos for each row execute function public._compras_ped_previsao();

-- ---------- RPC: cadastros que o perfil Compras precisa (ele não lê as tabelas de cadastro) ----------
create or replace function public.compras_cadastros(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not pode_comprar(p_empresa) then raise exception 'Sem acesso a Compras.'; end if;
  return jsonb_build_object(
    'fornecedores', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'documento', documento, 'tipo', tipo) order by nome)
                     from favorecidos where empresa_id = p_empresa and ativo and tipo not in ('CLIENTES', 'TERCEIROS - CLIENTES')), '[]'::jsonb),
    'centros', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by nome) from centros_custo where empresa_id = p_empresa), '[]'::jsonb),
    'planos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'nome', nome) order by codigo)
                from plano_contas where empresa_id = p_empresa and nivel = 2 and tipo = 'S'), '[]'::jsonb),
    'parametros', coalesce((select to_jsonb(cp) from compras_parametros cp where empresa_id = p_empresa),
                           jsonb_build_object('alcada_valor', 5000, 'previsao_automatica', true)),
    'pode_aprovar', pode_aprovar_compra(p_empresa));
end $$;

-- ---------- RPC: notas de entrada candidatas ao recebimento de um pedido ----------
create or replace function public.compras_notas_candidatas(p_pedido uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p compras_pedidos; doc text;
begin
  select * into p from compras_pedidos where id = p_pedido;
  if p.id is null or not pode_comprar(p.empresa_id) then raise exception 'Sem acesso a este pedido.'; end if;
  select regexp_replace(coalesce(documento, ''), '\D', '', 'g') into doc from favorecidos where id = p.favorecido_id;
  return coalesce((select jsonb_agg(x order by x->>'emissao' desc) from (
    select jsonb_build_object('id', n.id, 'numero', n.numero, 'serie', n.serie, 'emissao', n.emissao, 'emit_nome', n.emit_nome, 'v_nf', n.v_nf,
      'mesmo_fornecedor', (n.favorecido_id = p.favorecido_id or (doc <> '' and n.emit_doc = doc)),
      'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'n_item', i.n_item, 'xprod', i.xprod, 'ucom', i.ucom, 'qcom', i.qcom, 'vuncom', i.vuncom, 'vprod', i.vprod, 'ncm', i.ncm) order by i.n_item)
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

-- ---------- RPC: registrar recebimento ----------
-- p_itens: [{pedido_item_id, quantidade, valor_unitario, nfe_item_id}]
-- p_lancar_parcelas: lança no contas a pagar as parcelas da nota que ainda não têm lançamento vinculado
create or replace function public.compras_receber(p_pedido uuid, p_nota uuid, p_data date, p_itens jsonb, p_divergencias jsonb,
                                                  p_lancar_parcelas boolean, p_observacao text)
returns uuid language plpgsql security definer set search_path = public as $$
declare p compras_pedidos; rid uuid; it jsonb; pi compras_pedido_itens; f text; n nfe_notas; pa record; lid uuid; falta numeric;
begin
  select * into p from compras_pedidos where id = p_pedido for update;
  if p.id is null or not pode_comprar(p.empresa_id) then raise exception 'Sem acesso a este pedido.'; end if;
  if p.status not in ('aprovado', 'enviado', 'recebido_parcial') then raise exception 'Só pedido aprovado pode ser recebido (situação atual: %).', p.status; end if;
  if p_nota is not null then
    select * into n from nfe_notas where id = p_nota and empresa_id = p.empresa_id and tipo = 'entrada';
    if n.id is null then raise exception 'Nota de entrada não encontrada.'; end if;
  end if;
  if jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) = 0 then raise exception 'Informe ao menos um item recebido.'; end if;
  insert into compras_recebimentos (empresa_id, pedido_id, nfe_nota_id, data, divergencias, observacao)
  values (p.empresa_id, p.id, p_nota, coalesce(p_data, current_date), coalesce(p_divergencias, '[]'::jsonb), p_observacao) returning id into rid;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into pi from compras_pedido_itens where id = (it->>'pedido_item_id')::uuid and pedido_id = p.id;
    if pi.id is null then raise exception 'Item não pertence ao pedido.'; end if;
    if coalesce((it->>'quantidade')::numeric, 0) <= 0 then continue; end if;
    insert into compras_recebimento_itens (empresa_id, recebimento_id, pedido_item_id, nfe_item_id, quantidade, valor_unitario)
    values (p.empresa_id, rid, pi.id, nullif(it->>'nfe_item_id', '')::uuid, (it->>'quantidade')::numeric, nullif(it->>'valor_unitario', '')::numeric);
    update compras_pedido_itens set qtd_recebida = qtd_recebida + (it->>'quantidade')::numeric where id = pi.id;
  end loop;
  select coalesce(sum(greatest(quantidade - qtd_recebida, 0)), 0) into falta from compras_pedido_itens where pedido_id = p.id;
  update compras_pedidos set status = case when falta <= 0 then 'recebido' else 'recebido_parcial' end where id = p.id;   -- refaz a previsão pelo que falta
  if p_lancar_parcelas and p_nota is not null then
    select nome into f from favorecidos where id = p.favorecido_id;
    for pa in select * from nfe_parcelas where nota_id = p_nota
               and not exists (select 1 from nfe_vinculos v where v.parcela_id = nfe_parcelas.id or (v.nota_id = p_nota and v.parcela_id is null))
               order by numero loop
      insert into lancamentos (empresa_id, data, plano_id, descricao, favorecido_id, centro_custo_id, status, valor, origem, documento, emissao)
      values (p.empresa_id, coalesce(pa.vencimento, n.emissao), p.plano_id, left(format('NF %s — %s — PC %s', n.numero, f, p.numero), 250),
              p.favorecido_id, p.centro_custo_id, 'Em aberto', pa.valor, 'compras:nota', format('%s-%s', n.numero, pa.numero), n.emissao)
      returning id into lid;
      insert into nfe_vinculos (empresa_id, nota_id, parcela_id, lancamento_id, tipo) values (p.empresa_id, p_nota, pa.id, lid, 'exata');
      insert into compras_pedido_lancamentos (empresa_id, pedido_id, lancamento_id, tipo) values (p.empresa_id, p.id, lid, 'nota');
    end loop;
  end if;
  return rid;
end $$;

-- ---------- RPC: ajustar parâmetros (admin/diretor) ----------
create or replace function public.compras_salvar_parametros(p_empresa uuid, p_alcada numeric, p_previsao boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pode_aprovar_compra(p_empresa) then raise exception 'Só admin ou diretor altera os parâmetros de Compras.'; end if;
  insert into compras_parametros (empresa_id, alcada_valor, previsao_automatica, atualizado_em) values (p_empresa, p_alcada, p_previsao, now())
  on conflict (empresa_id) do update set alcada_valor = excluded.alcada_valor, previsao_automatica = excluded.previsao_automatica, atualizado_em = now();
end $$;

revoke all on function public.compras_cadastros(uuid), public.compras_notas_candidatas(uuid),
  public.compras_receber(uuid, uuid, date, jsonb, jsonb, boolean, text), public.compras_salvar_parametros(uuid, numeric, boolean) from public, anon;
grant execute on function public.compras_cadastros(uuid), public.compras_notas_candidatas(uuid),
  public.compras_receber(uuid, uuid, date, jsonb, jsonb, boolean, text), public.compras_salvar_parametros(uuid, numeric, boolean),
  public.pode_comprar(uuid), public.pode_aprovar_compra(uuid) to authenticated;

-- ---------- acesso (RLS) ----------
do $$
declare t text;
begin
  foreach t in array array['compras_requisicoes', 'compras_requisicao_itens', 'compras_cotacoes', 'compras_cotacao_itens',
                           'compras_pedidos', 'compras_pedido_itens', 'compras_recebimentos', 'compras_recebimento_itens',
                           'compras_pedido_lancamentos', 'compras_parametros'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_participante(empresa_id))', t || '_sel', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  -- requisições, cotações e pedidos: quem opera Compras escreve (as regras de situação ficam nos gatilhos)
  foreach t in array array['compras_requisicoes', 'compras_requisicao_itens', 'compras_cotacoes', 'compras_cotacao_itens',
                           'compras_pedidos', 'compras_pedido_itens'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_comprar(empresa_id))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_comprar(empresa_id)) with check (public.pode_comprar(empresa_id))', t || '_upd', t);
    execute format('grant insert, update on public.%I to authenticated', t);
  end loop;
  -- itens e cotações podem ser apagados enquanto o documento está aberto; requisição/pedido não se apagam (cancela)
  foreach t in array array['compras_requisicao_itens', 'compras_cotacoes', 'compras_cotacao_itens', 'compras_pedido_itens'] loop
    execute format('create policy %I on public.%I for delete to authenticated using (public.pode_comprar(empresa_id))', t || '_del', t);
    execute format('grant delete on public.%I to authenticated', t);
  end loop;
  -- recebimentos, vínculos e parâmetros: só pelas funções (compras_receber / compras_salvar_parametros)
end $$;

-- ---------- auditoria (migração 038) ----------
do $$
declare t text;
begin
  foreach t in array array['compras_parametros', 'compras_requisicoes', 'compras_requisicao_itens', 'compras_cotacoes', 'compras_cotacao_itens',
                           'compras_pedidos', 'compras_pedido_itens', 'compras_recebimentos', 'compras_recebimento_itens'] loop
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;
