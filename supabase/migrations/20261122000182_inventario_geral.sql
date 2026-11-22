-- 182 — inventário geral (o inventário do dia 01), ao lado do cíclico
-- Como funciona:
--   1. Abre-se o inventário com uma DATA DE REFERÊNCIA (o último dia do mês anterior) e os locais, cada um com quem conta e quem audita.
--   2. Os locais ficam CONGELADOS: nenhum movimento entra neles até a contagem e a auditoria do local terminarem; movimento com data
--      até a referência fica barrado até o inventário ser aprovado.
--   3. CONTAGEM CEGA: quem conta recebe a lista sem o saldo do sistema (a tabela de itens não é lida direto; só pelas funções).
--   4. AUDITORIA CEGA por outra pessoa (rodízio entre os responsáveis): amostra por parâmetro; o auditor não vê o saldo nem a contagem.
--   5. Contagem e auditoria diferentes: TERCEIRA CONTAGEM, feita pelos dois.
--   6. APROVAÇÃO: os ajustes entram na data de referência e o mês é fechado, de modo que a posição do fechamento é o próprio inventário.
--   7. O primeiro inventário serve de IMPLANTAÇÃO, local a local, sem depender do espelho do Iniflex.
-- Aditivo: nada é apagado.

-- ------------------------------------------------------------ tabelas
create table if not exists public.est_ig_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  amostra_pct numeric(5,2) not null default 100 check (amostra_pct between 0 and 100),   -- % dos itens sorteados para a auditoria (100 = audita tudo)
  amostra_classe_a boolean not null default true,       -- os itens de maior valor (80% do valor do local) sempre entram na auditoria
  amostra_divergentes boolean not null default true,    -- os itens que divergiram do sistema além da tolerância sempre entram
  tolerancia_pct numeric(6,2) not null default 2 check (tolerancia_pct >= 0),        -- contagem × sistema: diferença aceita, em %
  tolerancia_valor numeric(14,2) not null default 100 check (tolerancia_valor >= 0), -- contagem × sistema: diferença aceita, em R$
  dif_auditoria_pct numeric(6,2) not null default 0.5 check (dif_auditoria_pct >= 0),   -- contagem × auditoria: diferença aceita, em %
  papeis_aprovacao text[] not null default '{admin,diretor,financeiro}',
  aprovar_quem_contou boolean not null default false,   -- exceção: quem contou ou auditou também aprova
  fechar_mes boolean not null default true,             -- ao aprovar, fecha o mês da data de referência
  atualizado_em timestamptz not null default now(), atualizado_por uuid
);

create table if not exists public.est_ig_inventarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  referencia date not null,                             -- os ajustes entram nesta data
  implantacao boolean not null default false,           -- primeiro inventário: o contado vira o saldo inicial
  situacao text not null default 'aberto' check (situacao in ('aberto', 'aprovado', 'cancelado')),
  observacao text check (length(observacao) <= 500),
  criado_por uuid default auth.uid(), criado_nome text, criado_em timestamptz not null default now(),
  decidido_por uuid, decidido_nome text, decidido_em timestamptz, motivo text,
  ajustes int, valor_ajuste numeric(16,2), mes_fechado boolean,
  unique (empresa_id, numero)
);
create unique index if not exists est_ig_um_aberto on public.est_ig_inventarios (empresa_id) where situacao = 'aberto';

create table if not exists public.est_ig_locais (
  id uuid primary key default gen_random_uuid(),
  inventario_id uuid not null references public.est_ig_inventarios(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  local_id uuid not null references public.est_locais(id),
  responsavel_id uuid not null, responsavel_nome text,  -- quem conta
  auditor_id uuid, auditor_nome text,                   -- quem audita (nunca quem conta)
  situacao text not null default 'contando' check (situacao in ('contando', 'auditando', 'terceira', 'concluido')),
  iniciado_em timestamptz, contado_em timestamptz, auditado_em timestamptz, concluido_em timestamptz,
  unique (inventario_id, local_id),
  check (auditor_id is null or auditor_id <> responsavel_id)
);
create index if not exists est_ig_locais_local on public.est_ig_locais (local_id, situacao);

create table if not exists public.est_ig_itens (
  id uuid primary key default gen_random_uuid(),
  inventario_id uuid not null references public.est_ig_inventarios(id) on delete cascade,
  ig_local_id uuid not null references public.est_ig_locais(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  local_id uuid not null references public.est_locais(id),
  produto_id uuid not null references public.produtos(id),
  lote_id uuid references public.est_lotes(id),
  saldo_ref numeric(18,4) not null default 0,           -- saldo do sistema na data de referência
  custo numeric(18,6) not null default 0,               -- custo unitário de referência (custo médio; na implantação, última compra ou informado)
  incluido boolean not null default false,              -- achado no local, fora da lista
  contado numeric(18,4), contado_por uuid, contado_em timestamptz,
  na_amostra boolean not null default false,
  auditado numeric(18,4), auditado_por uuid, auditado_em timestamptz,
  terceira numeric(18,4), terceira_por uuid, terceira_em timestamptz, justificativa text check (length(justificativa) <= 300),
  final numeric(18,4),                                  -- a quantidade que vale
  situacao text not null default 'pendente' check (situacao in ('pendente', 'contado', 'conferido', 'divergente', 'resolvido')),
  movimento_id uuid references public.est_movimentos(id) on delete set null
);
create unique index if not exists est_ig_itens_unico on public.est_ig_itens (ig_local_id, produto_id, coalesce(lote_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists est_ig_itens_inv on public.est_ig_itens (inventario_id);

-- ------------------------------------------------------------ acesso
-- a tabela de itens não é lida direto por ninguém: é assim que a contagem e a auditoria são cegas de verdade.
alter table public.est_ig_config enable row level security;
alter table public.est_ig_inventarios enable row level security;
alter table public.est_ig_locais enable row level security;
alter table public.est_ig_itens enable row level security;
do $$ declare t text; begin
  foreach t in array array['est_ig_config', 'est_ig_inventarios', 'est_ig_locais', 'est_ig_itens'] loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
  end loop;
  foreach t in array array['est_ig_config', 'est_ig_inventarios', 'est_ig_locais'] loop
    execute format('grant select on table public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (empresa_id in (select public.est_empresas_que_vejo()))', t || '_sel', t);
  end loop;
end $$;
drop trigger if exists zz_auditoria on public.est_ig_config;
create trigger zz_auditoria after insert or update or delete on public.est_ig_config for each row execute function public._auditar();
drop trigger if exists zz_auditoria on public.est_ig_inventarios;
create trigger zz_auditoria after insert or update or delete on public.est_ig_inventarios for each row execute function public._auditar();
drop trigger if exists zz_auditoria on public.est_ig_locais;
create trigger zz_auditoria after update or delete on public.est_ig_locais for each row execute function public._auditar();

-- ------------------------------------------------------------ auxiliares
create or replace function public._ig_cfg(p_empresa uuid) returns est_ig_config language sql stable security definer set search_path = public as $$
  select coalesce((select c from est_ig_config c where c.empresa_id = p_empresa),
                  (select row(p_empresa, 100, true, true, 2, 100, 0.5, array['admin', 'diretor', 'financeiro'], false, true, now(), null)::est_ig_config));
$$;
create or replace function public._ig_nome(p_empresa uuid, p_user uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(m.nome), ''), split_part(u.email, '@', 1))::text from membros m join auth.users u on u.id = m.user_id where m.empresa_id = p_empresa and m.user_id = p_user;
$$;
-- quem gerencia o inventário geral: administrador, financeiro e diretor (com a segunda etapa, quando obrigatória)
create or replace function public.est_ig_gerencia(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor')) and public._mfa_ok(p_empresa);
$$;
create or replace function public._ig_aprova(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text = any((public._ig_cfg(p_empresa)).papeis_aprovacao)) and public._mfa_ok(p_empresa);
$$;
-- saldo do sistema na data de referência (soma dos movimentos até o dia)
create or replace function public._ig_saldo(p_empresa uuid, p_produto uuid, p_local uuid, p_lote uuid, p_data date) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(m.quantidade), 0) from est_movimentos m
   where m.empresa_id = p_empresa and m.produto_id = p_produto and m.local_id = p_local and m.lote_id is not distinct from p_lote and m.data <= p_data;
$$;
-- custo de referência: custo médio do estoque; sem ele, a última compra
create or replace function public._ig_custo(p_produto uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select custo from public._custo_unit(p_produto)), 0);
$$;

-- pessoas que podem contar ou auditar (para montar o inventário)
create or replace function public.est_ig_pessoas(p_empresa uuid)
returns table (user_id uuid, nome text, papel text) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.est_ig_gerencia(p_empresa) then raise exception 'Só administrador, financeiro ou diretor monta o inventário geral.'; end if;
  return query select m.user_id, public._ig_nome(p_empresa, m.user_id), m.papel::text from membros m
    where m.empresa_id = p_empresa and m.papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao') order by 2;
end $$;

create or replace function public.est_ig_config_salvar(p_empresa uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare c est_ig_config := public._ig_cfg(p_empresa); v_papeis text[];
begin
  if not is_admin(p_empresa) or not _mfa_ok(p_empresa) then raise exception 'Só o administrador altera os parâmetros do inventário geral.'; end if;
  v_papeis := coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'papeis_aprovacao') x), c.papeis_aprovacao);
  if not (v_papeis <@ array['admin', 'diretor', 'financeiro']) or cardinality(v_papeis) = 0 then raise exception 'Quem aprova: administrador, diretor ou financeiro.'; end if;
  insert into est_ig_config (empresa_id, amostra_pct, amostra_classe_a, amostra_divergentes, tolerancia_pct, tolerancia_valor, dif_auditoria_pct, papeis_aprovacao, aprovar_quem_contou, fechar_mes, atualizado_por)
  values (p_empresa, coalesce((p ->> 'amostra_pct')::numeric, c.amostra_pct), coalesce((p ->> 'amostra_classe_a')::boolean, c.amostra_classe_a), coalesce((p ->> 'amostra_divergentes')::boolean, c.amostra_divergentes),
          coalesce((p ->> 'tolerancia_pct')::numeric, c.tolerancia_pct), coalesce((p ->> 'tolerancia_valor')::numeric, c.tolerancia_valor), coalesce((p ->> 'dif_auditoria_pct')::numeric, c.dif_auditoria_pct),
          v_papeis, coalesce((p ->> 'aprovar_quem_contou')::boolean, c.aprovar_quem_contou), coalesce((p ->> 'fechar_mes')::boolean, c.fechar_mes), auth.uid())
  on conflict (empresa_id) do update set amostra_pct = excluded.amostra_pct, amostra_classe_a = excluded.amostra_classe_a, amostra_divergentes = excluded.amostra_divergentes,
    tolerancia_pct = excluded.tolerancia_pct, tolerancia_valor = excluded.tolerancia_valor, dif_auditoria_pct = excluded.dif_auditoria_pct, papeis_aprovacao = excluded.papeis_aprovacao,
    aprovar_quem_contou = excluded.aprovar_quem_contou, fechar_mes = excluded.fechar_mes, atualizado_em = now(), atualizado_por = auth.uid();
end $$;

-- ------------------------------------------------------------ abrir
-- p_locais: [{"local_id": "...", "responsavel_id": "...", "auditor_id": "..." (opcional)}]. Sem auditor, vale o rodízio:
-- cada local é auditado pelo responsável do local seguinte da lista (o primeiro que não seja quem contou).
create or replace function public.est_ig_abrir(p_empresa uuid, p_referencia date, p_locais jsonb, p_observacao text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cfg est_ig_config := public._ig_cfg(p_empresa); v_id uuid; v_num int; v_impl boolean; v_fech date; l jsonb; v_loc uuid; v_resp uuid; v_aud uuid; v_n int; i int; j int; k int; v_igl uuid; v_tot int := 0;
  v_precisa_auditor boolean;
begin
  if not public.est_ig_gerencia(p_empresa) then raise exception 'Só administrador, financeiro ou diretor abre o inventário geral.'; end if;
  if p_referencia is null or p_referencia > current_date then raise exception 'A data de referência não pode ser futura.'; end if;
  select max(mes) into v_fech from est_fechamentos where empresa_id = p_empresa;
  if v_fech is not null and p_referencia < (v_fech + interval '1 month')::date then raise exception 'O estoque de % está fechado: a data de referência precisa ser de um mês aberto.', to_char(v_fech, 'MM/YYYY'); end if;
  if exists (select 1 from est_ig_inventarios where empresa_id = p_empresa and situacao = 'aberto') then raise exception 'Já há um inventário geral aberto: conclua ou cancele antes de abrir outro.'; end if;
  if jsonb_typeof(coalesce(p_locais, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_locais) = 0 then raise exception 'Escolha pelo menos um local.'; end if;
  v_n := jsonb_array_length(p_locais);
  v_precisa_auditor := cfg.amostra_pct > 0 or cfg.amostra_classe_a or cfg.amostra_divergentes;
  v_impl := (select implantado_em from est_config where empresa_id = p_empresa) is null;
  perform pg_advisory_xact_lock(hashtext('est_ig:' || p_empresa::text));
  select coalesce(max(numero), 0) + 1 into v_num from est_ig_inventarios where empresa_id = p_empresa;
  insert into est_ig_inventarios (empresa_id, numero, referencia, implantacao, observacao, criado_nome)
  values (p_empresa, v_num, p_referencia, v_impl, left(nullif(trim(coalesce(p_observacao, '')), ''), 500), public._ig_nome(p_empresa, auth.uid())) returning id into v_id;
  for i in 0 .. v_n - 1 loop
    l := p_locais -> i; v_loc := (l ->> 'local_id')::uuid; v_resp := (l ->> 'responsavel_id')::uuid; v_aud := nullif(l ->> 'auditor_id', '')::uuid;
    if not exists (select 1 from est_locais where id = v_loc and empresa_id = p_empresa and ativo and controla_saldo) then raise exception 'Local inválido ou que não controla saldo.'; end if;
    if exists (select 1 from est_inv_contagens where empresa_id = p_empresa and local_id = v_loc and situacao in ('aberta', 'em_aprovacao')) then
      raise exception 'O local % tem uma contagem cíclica em andamento: conclua ou cancele antes.', (select nome from est_locais where id = v_loc);
    end if;
    if v_resp is null or not exists (select 1 from membros where empresa_id = p_empresa and user_id = v_resp and papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao')) then
      raise exception 'Informe quem conta o local % (alguém com perfil de estoque).', (select nome from est_locais where id = v_loc);
    end if;
    if v_aud is null and v_precisa_auditor then   -- rodízio: o responsável do próximo local que não seja quem contou
      for k in 1 .. v_n - 1 loop
        j := (i + k) % v_n;
        if ((p_locais -> j) ->> 'responsavel_id')::uuid <> v_resp then v_aud := ((p_locais -> j) ->> 'responsavel_id')::uuid; exit; end if;
      end loop;
      if v_aud is null then raise exception 'Não há outra pessoa para auditar o local %: escolha o auditor, ou desligue a auditoria nos parâmetros.', (select nome from est_locais where id = v_loc); end if;
    end if;
    if v_aud is not null then
      if v_aud = v_resp then raise exception 'Quem conta o local % não pode ser o auditor dele.', (select nome from est_locais where id = v_loc); end if;
      if not exists (select 1 from membros where empresa_id = p_empresa and user_id = v_aud and papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao')) then raise exception 'O auditor precisa ter perfil de estoque.'; end if;
    end if;
    insert into est_ig_locais (inventario_id, empresa_id, local_id, responsavel_id, responsavel_nome, auditor_id, auditor_nome)
    values (v_id, p_empresa, v_loc, v_resp, public._ig_nome(p_empresa, v_resp), v_aud, public._ig_nome(p_empresa, v_aud)) returning id into v_igl;
    -- a lista: tudo que tem saldo na data de referência, tudo que se movimentou no local nos últimos 12 meses (mesmo com saldo zero)
    -- e os produtos que têm este local como padrão (é o que monta a lista na implantação, com o estoque ainda vazio)
    insert into est_ig_itens (inventario_id, ig_local_id, empresa_id, local_id, produto_id, lote_id, saldo_ref, custo)
    select v_id, v_igl, p_empresa, v_loc, x.produto_id, x.lote_id, public._ig_saldo(p_empresa, x.produto_id, v_loc, x.lote_id, p_referencia), public._ig_custo(x.produto_id)
      from (select m.produto_id, m.lote_id from est_movimentos m where m.empresa_id = p_empresa and m.local_id = v_loc and m.data <= p_referencia and m.data > p_referencia - 365 group by 1, 2
            union
            select m.produto_id, m.lote_id from est_movimentos m where m.empresa_id = p_empresa and m.local_id = v_loc and m.data <= p_referencia group by 1, 2 having sum(m.quantidade) <> 0
            union
            select p.id, null::uuid from produtos p where p.empresa_id = p_empresa and coalesce(p.ativo, true) and p.local_padrao_id = v_loc and not coalesce(p.controla_lote, false)) x;
    get diagnostics k = row_count; v_tot := v_tot + k;
    begin
      perform _notificar_u(p_empresa, array[v_resp], 'inventario', 'Inventário geral nº ' || v_num || ': contar ' || (select nome from est_locais where id = v_loc),
        'Data de referência ' || to_char(p_referencia, 'DD/MM/YYYY') || '. O local fica congelado até a contagem e a auditoria terminarem.', '#/estoque/inventario-geral?i=' || v_id, v_id, false);
    exception when others then null; end;
  end loop;
  return v_id;
end $$;

-- ------------------------------------------------------------ listas (é por aqui que a contagem é cega)
-- quem conta: os itens do local, sem o saldo do sistema. Quem audita: só a amostra, sem o saldo e sem a contagem.
create or replace function public.est_ig_lista(p_ig_local uuid)
returns table (item_id uuid, produto_id uuid, codigo text, descricao text, unidade text, etiqueta text, lote_id uuid, lote text, lote_etiqueta text,
               quantidade numeric, feito boolean, incluido boolean, situacao text, papel text, contado numeric, auditado numeric)
language plpgsql stable security definer set search_path = public as $$
declare gl est_ig_locais; g est_ig_inventarios; v_papel text;
begin
  select * into gl from est_ig_locais where id = p_ig_local;
  if not found or not public.pode_estoque(gl.empresa_id) then raise exception 'Sem acesso.'; end if;
  select * into g from est_ig_inventarios where id = gl.inventario_id;
  v_papel := case when gl.situacao = 'terceira' and auth.uid() in (gl.responsavel_id, gl.auditor_id) then 'terceira'
                  when auth.uid() = gl.responsavel_id then 'contador' when auth.uid() = gl.auditor_id then 'auditor' end;
  if v_papel is null then raise exception 'Este local é contado por % e auditado por %.', gl.responsavel_nome, coalesce(gl.auditor_nome, 'ninguém'); end if;
  if v_papel = 'auditor' and gl.situacao = 'contando' then raise exception 'A auditoria deste local começa quando % concluir a contagem.', gl.responsavel_nome; end if;
  return query
  select i.id, i.produto_id, p.codigo::text, p.descricao::text, p.unidade::text, p.etiqueta::text, i.lote_id, lt.codigo::text, lt.etiqueta::text,
         case v_papel when 'contador' then i.contado when 'auditor' then i.auditado else i.terceira end,
         case v_papel when 'contador' then i.contado is not null when 'auditor' then i.auditado is not null else i.terceira is not null end,
         i.incluido, i.situacao, v_papel,
         case when v_papel = 'terceira' then i.contado end, case when v_papel = 'terceira' then i.auditado end   -- na terceira contagem os dois veem as duas quantidades
    from est_ig_itens i join produtos p on p.id = i.produto_id left join est_lotes lt on lt.id = i.lote_id
   where i.ig_local_id = p_ig_local
     and (v_papel = 'contador' or (v_papel = 'auditor' and i.na_amostra) or (v_papel = 'terceira' and i.situacao in ('divergente', 'resolvido') and i.na_amostra))
   order by p.descricao, lt.codigo;
end $$;

-- o gerente e o aprovador veem tudo: sistema, contado, auditado, final, diferença e valor
create or replace function public.est_ig_detalhe(p_inventario uuid)
returns table (item_id uuid, ig_local_id uuid, local_id uuid, produto_id uuid, codigo text, descricao text, unidade text, lote text, saldo_ref numeric, custo numeric,
               contado numeric, na_amostra boolean, auditado numeric, terceira numeric, final numeric, situacao text, incluido boolean, justificativa text, diferenca numeric, valor numeric, movimento_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare g est_ig_inventarios;
begin
  select * into g from est_ig_inventarios where id = p_inventario;
  if not found or not (public.est_ig_gerencia(g.empresa_id) or public._ig_aprova(g.empresa_id)) then raise exception 'Só quem gerencia ou aprova o inventário vê o resultado.'; end if;
  return query
  select i.id, i.ig_local_id, i.local_id, i.produto_id, p.codigo::text, p.descricao::text, p.unidade::text, lt.codigo::text, i.saldo_ref, i.custo,
         i.contado, i.na_amostra, i.auditado, i.terceira, i.final, i.situacao, i.incluido, i.justificativa,
         coalesce(i.final, i.contado) - i.saldo_ref, round((coalesce(i.final, i.contado) - i.saldo_ref) * i.custo, 2), i.movimento_id
    from est_ig_itens i join produtos p on p.id = i.produto_id left join est_lotes lt on lt.id = i.lote_id
   where i.inventario_id = p_inventario order by p.descricao, lt.codigo;
end $$;

-- andamento por local (sem quantidades): qualquer pessoa do estoque acompanha
create or replace function public.est_ig_andamento(p_inventario uuid)
returns table (ig_local_id uuid, itens int, contados int, na_amostra int, auditados int, divergentes int, resolvidos int)
language plpgsql stable security definer set search_path = public as $$
declare g est_ig_inventarios;
begin
  select * into g from est_ig_inventarios where id = p_inventario;
  if not found or not public.pode_ver_estoque(g.empresa_id) then raise exception 'Sem acesso.'; end if;
  return query select i.ig_local_id, count(*)::int, count(i.contado)::int, count(*) filter (where i.na_amostra)::int, count(i.auditado)::int,
                      count(*) filter (where i.situacao = 'divergente')::int, count(*) filter (where i.situacao = 'resolvido')::int
                 from est_ig_itens i where i.inventario_id = p_inventario group by 1;
end $$;

-- ------------------------------------------------------------ contar
create or replace function public._ig_local_aberto(p_ig_local uuid) returns est_ig_locais language plpgsql security definer set search_path = public as $$
declare gl est_ig_locais;
begin
  select l.* into gl from est_ig_locais l join est_ig_inventarios g on g.id = l.inventario_id where l.id = p_ig_local and g.situacao = 'aberto' for update of l;
  if not found then raise exception 'Local não encontrado ou inventário já encerrado.'; end if;
  if not public.pode_estoque(gl.empresa_id) then raise exception 'Sem permissão.'; end if;
  return gl;
end $$;

create or replace function public.est_ig_contar(p_item uuid, p_qtd numeric)
returns void language plpgsql security definer set search_path = public as $$
declare it est_ig_itens; gl est_ig_locais;
begin
  select * into it from est_ig_itens where id = p_item;
  if not found then raise exception 'Item não encontrado.'; end if;
  gl := public._ig_local_aberto(it.ig_local_id);
  if p_qtd is null or p_qtd < 0 then raise exception 'Quantidade inválida.'; end if;
  if gl.situacao = 'contando' then
    if auth.uid() <> gl.responsavel_id then raise exception 'Quem conta este local é %.', gl.responsavel_nome; end if;
    update est_ig_itens set contado = p_qtd, contado_por = auth.uid(), contado_em = now(), situacao = 'contado' where id = p_item;
    update est_ig_locais set iniciado_em = coalesce(iniciado_em, now()) where id = gl.id;
  elsif gl.situacao = 'auditando' then
    if auth.uid() <> gl.auditor_id then raise exception 'Quem audita este local é %.', gl.auditor_nome; end if;
    if not it.na_amostra then raise exception 'Este item não está na amostra da auditoria.'; end if;
    update est_ig_itens set auditado = p_qtd, auditado_por = auth.uid(), auditado_em = now() where id = p_item;
  else raise exception 'Este local não está em contagem nem em auditoria.';
  end if;
end $$;

-- item achado no local, fora da lista
create or replace function public.est_ig_incluir(p_ig_local uuid, p_produto uuid, p_lote uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare gl est_ig_locais; g est_ig_inventarios; v_id uuid;
begin
  gl := public._ig_local_aberto(p_ig_local);
  if gl.situacao <> 'contando' or auth.uid() <> gl.responsavel_id then raise exception 'Só quem conta o local inclui item, e só durante a contagem.'; end if;
  select * into g from est_ig_inventarios where id = gl.inventario_id;
  if not exists (select 1 from produtos where id = p_produto and empresa_id = gl.empresa_id) then raise exception 'Produto não encontrado nesta empresa.'; end if;
  if p_lote is not null and not exists (select 1 from est_lotes where id = p_lote and produto_id = p_produto and empresa_id = gl.empresa_id) then raise exception 'Lote de outro produto.'; end if;
  if p_lote is null and (select coalesce(controla_lote, false) from produtos where id = p_produto) then raise exception 'Este produto controla lote: leia a etiqueta do lote.'; end if;
  select id into v_id from est_ig_itens where ig_local_id = gl.id and produto_id = p_produto and lote_id is not distinct from p_lote;
  if v_id is null then
    insert into est_ig_itens (inventario_id, ig_local_id, empresa_id, local_id, produto_id, lote_id, saldo_ref, custo, incluido)
    values (gl.inventario_id, gl.id, gl.empresa_id, gl.local_id, p_produto, p_lote, public._ig_saldo(gl.empresa_id, p_produto, gl.local_id, p_lote, g.referencia), public._ig_custo(p_produto), true)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- termina a contagem do local: o que não foi contado não pode ficar em branco (não encontrado = contar zero); sorteia a amostra da auditoria
create or replace function public.est_ig_concluir_contagem(p_ig_local uuid, p_zerar_pendentes boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare gl est_ig_locais; cfg est_ig_config; v_pend int; v_total numeric; v_n int;
begin
  gl := public._ig_local_aberto(p_ig_local);
  if gl.situacao <> 'contando' or auth.uid() <> gl.responsavel_id then raise exception 'Só quem conta o local conclui a contagem.'; end if;
  cfg := public._ig_cfg(gl.empresa_id);
  select count(*) into v_pend from est_ig_itens where ig_local_id = gl.id and contado is null;
  if v_pend > 0 then
    if not coalesce(p_zerar_pendentes, false) then raise exception 'Faltam % item(ns) sem contagem. Conte-os, ou confirme que não foram encontrados (ficam com zero).', v_pend; end if;
    update est_ig_itens set contado = 0, contado_por = auth.uid(), contado_em = now(), situacao = 'contado' where ig_local_id = gl.id and contado is null;
  end if;
  if not exists (select 1 from est_ig_itens where ig_local_id = gl.id) then raise exception 'Nenhum item neste local: inclua o que encontrar, lendo a etiqueta ou o código.'; end if;
  -- amostra: maior valor (classe A, 80% do valor do local), divergentes além da tolerância e um sorteio do restante
  select coalesce(sum(greatest(contado, saldo_ref) * custo), 0) into v_total from est_ig_itens where ig_local_id = gl.id;
  update est_ig_itens i set na_amostra = (gl.auditor_id is not null) and (
       (cfg.amostra_divergentes and (abs(i.contado - i.saldo_ref) > i.saldo_ref * cfg.tolerancia_pct / 100 or abs((i.contado - i.saldo_ref) * i.custo) > cfg.tolerancia_valor))
    or (cfg.amostra_classe_a and v_total > 0 and i.id in (select a.id from (select x.id, sum(greatest(x.contado, x.saldo_ref) * x.custo) over (order by greatest(x.contado, x.saldo_ref) * x.custo desc, x.id) - greatest(x.contado, x.saldo_ref) * x.custo antes
                                                                               from est_ig_itens x where x.ig_local_id = gl.id) a where a.antes < v_total * 0.8))
    or (cfg.amostra_pct >= 100) or (cfg.amostra_pct > 0 and random() * 100 < cfg.amostra_pct))
   where i.ig_local_id = gl.id;
  select count(*) into v_n from est_ig_itens where ig_local_id = gl.id and na_amostra;
  if v_n = 0 then
    update est_ig_itens set final = contado, situacao = 'conferido' where ig_local_id = gl.id;
    update est_ig_locais set situacao = 'concluido', contado_em = now(), concluido_em = now() where id = gl.id;
    return 'concluido';
  end if;
  update est_ig_itens set final = contado, situacao = 'conferido' where ig_local_id = gl.id and not na_amostra;
  update est_ig_locais set situacao = 'auditando', contado_em = now() where id = gl.id;
  begin
    perform _notificar_u(gl.empresa_id, array[gl.auditor_id], 'inventario', 'Inventário geral: auditar ' || (select nome from est_locais where id = gl.local_id),
      v_n || ' item(ns) na amostra. A auditoria é cega: você não vê o saldo nem a contagem.', '#/estoque/inventario-geral?i=' || gl.inventario_id, gl.inventario_id, false);
  exception when others then null; end;
  return 'auditando';
end $$;

-- termina a auditoria do local: o que bate com a contagem vale; o que diverge vai para a terceira contagem
create or replace function public.est_ig_concluir_auditoria(p_ig_local uuid)
returns text language plpgsql security definer set search_path = public as $$
declare gl est_ig_locais; cfg est_ig_config; v_div int;
begin
  gl := public._ig_local_aberto(p_ig_local);
  if gl.situacao <> 'auditando' or auth.uid() <> gl.auditor_id then raise exception 'Só o auditor do local conclui a auditoria.'; end if;
  cfg := public._ig_cfg(gl.empresa_id);
  if exists (select 1 from est_ig_itens where ig_local_id = gl.id and na_amostra and auditado is null) then raise exception 'Há itens da amostra sem auditoria.'; end if;
  update est_ig_itens set
         situacao = case when abs(auditado - contado) <= greatest(contado, auditado) * cfg.dif_auditoria_pct / 100 then 'conferido' else 'divergente' end,
         final = case when abs(auditado - contado) <= greatest(contado, auditado) * cfg.dif_auditoria_pct / 100 then contado end
   where ig_local_id = gl.id and na_amostra;
  select count(*) into v_div from est_ig_itens where ig_local_id = gl.id and situacao = 'divergente';
  if v_div = 0 then
    update est_ig_locais set situacao = 'concluido', auditado_em = now(), concluido_em = now() where id = gl.id;
    return 'concluido';
  end if;
  update est_ig_locais set situacao = 'terceira', auditado_em = now() where id = gl.id;
  begin
    perform _notificar_u(gl.empresa_id, array[gl.responsavel_id, gl.auditor_id], 'inventario', 'Inventário geral: terceira contagem em ' || (select nome from est_locais where id = gl.local_id),
      v_div || ' item(ns) com contagem e auditoria diferentes. A terceira contagem é feita pelos dois, juntos.', '#/estoque/inventario-geral?i=' || gl.inventario_id, gl.inventario_id, true);
  exception when others then null; end;
  return 'terceira';
end $$;

-- terceira contagem: feita pelos dois; qualquer um registra, com a justificativa da diferença
create or replace function public.est_ig_terceira(p_item uuid, p_qtd numeric, p_justificativa text default null)
returns text language plpgsql security definer set search_path = public as $$
declare it est_ig_itens; gl est_ig_locais;
begin
  select * into it from est_ig_itens where id = p_item;
  if not found then raise exception 'Item não encontrado.'; end if;
  gl := public._ig_local_aberto(it.ig_local_id);
  if gl.situacao <> 'terceira' or auth.uid() not in (gl.responsavel_id, gl.auditor_id) then raise exception 'A terceira contagem é registrada por quem contou ou por quem auditou o local.'; end if;
  if it.situacao not in ('divergente', 'resolvido') then raise exception 'Este item não precisa de terceira contagem.'; end if;
  if p_qtd is null or p_qtd < 0 then raise exception 'Quantidade inválida.'; end if;
  update est_ig_itens set terceira = p_qtd, terceira_por = auth.uid(), terceira_em = now(), final = p_qtd, situacao = 'resolvido',
         justificativa = left(nullif(trim(coalesce(p_justificativa, '')), ''), 300) where id = p_item;
  if not exists (select 1 from est_ig_itens where ig_local_id = gl.id and situacao = 'divergente') then
    update est_ig_locais set situacao = 'concluido', concluido_em = now() where id = gl.id;
    return 'concluido';
  end if;
  return 'terceira';
end $$;

-- custo de um item sem custo (implantação): só quem gerencia informa
create or replace function public.est_ig_custo(p_item uuid, p_custo numeric)
returns void language plpgsql security definer set search_path = public as $$
declare it est_ig_itens; g est_ig_inventarios;
begin
  select * into it from est_ig_itens where id = p_item;
  select * into g from est_ig_inventarios where id = it.inventario_id;
  if g.id is null or g.situacao <> 'aberto' or not public.est_ig_gerencia(g.empresa_id) then raise exception 'Só quem gerencia o inventário informa o custo, e só com ele aberto.'; end if;
  if p_custo is null or p_custo < 0 then raise exception 'Custo inválido.'; end if;
  update est_ig_itens set custo = p_custo where inventario_id = g.id and produto_id = it.produto_id;   -- o custo é do produto: vale para todos os locais e lotes
end $$;

-- ------------------------------------------------------------ fechamento interno e aprovação
create or replace function public._est_fechar(p_empresa uuid, p_mes date) returns void language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_mes)::date; v_fim date := (date_trunc('month', p_mes) + interval '1 month')::date;
begin
  perform pg_advisory_xact_lock(hashtext('est_fech:' || p_empresa::text));
  insert into est_fechamentos(empresa_id, mes) values (p_empresa, v_mes) on conflict do nothing;
  delete from est_fechamento_saldos where empresa_id = p_empresa and mes = v_mes;
  insert into est_fechamento_saldos(empresa_id, mes, produto_id, local_id, lote_id, quantidade, valor)
  select p_empresa, v_mes, m.produto_id, m.local_id, m.lote_id, sum(m.quantidade), sum(m.valor)
    from est_movimentos m join est_locais l on l.id = m.local_id
   where m.empresa_id = p_empresa and m.data < v_fim and l.controla_saldo
   group by m.produto_id, m.local_id, m.lote_id
  having sum(m.quantidade) <> 0 or sum(m.valor) <> 0;
end $$;

create or replace function public.est_ig_aprovar(p_inventario uuid, p_sem_custo boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g est_ig_inventarios; cfg est_ig_config; it record; v_tipo uuid; v_si uuid; v_ajm uuid; v_ajn uuid; v_mov uuid; v_dif numeric; v_n int := 0; v_valor numeric := 0; v_semc int; v_fechou boolean := false; v_val numeric;
begin
  select * into g from est_ig_inventarios where id = p_inventario for update;
  if not found then raise exception 'Inventário não encontrado.'; end if;
  if g.situacao <> 'aberto' then raise exception 'Este inventário já foi encerrado.'; end if;
  if not public._ig_aprova(g.empresa_id) then raise exception 'Sem permissão para aprovar o inventário geral.'; end if;
  cfg := public._ig_cfg(g.empresa_id);
  if exists (select 1 from est_ig_locais where inventario_id = g.id and situacao <> 'concluido') then raise exception 'Há locais que ainda não terminaram a contagem, a auditoria ou a terceira contagem.'; end if;
  if not cfg.aprovar_quem_contou and exists (select 1 from est_ig_itens where inventario_id = g.id and auth.uid() in (contado_por, auditado_por, terceira_por)) then
    raise exception 'Quem contou ou auditou não aprova o inventário. Peça a outro aprovador, ou libere a exceção nos parâmetros.';
  end if;
  select count(*) into v_semc from est_ig_itens where inventario_id = g.id and final > saldo_ref and custo = 0;
  if v_semc > 0 and not coalesce(p_sem_custo, false) then
    raise exception '% item(ns) com sobra não têm custo: informe o custo no resultado, ou confirme a entrada a custo zero.', v_semc;
  end if;
  select id into v_si from est_tipos_movimento where empresa_id = g.empresa_id and codigo = 'SI' and ativo;
  select id into v_ajm from est_tipos_movimento where empresa_id = g.empresa_id and codigo = 'AJ+' and ativo;
  select id into v_ajn from est_tipos_movimento where empresa_id = g.empresa_id and codigo = 'AJ-' and ativo;
  if v_ajm is null or v_ajn is null or v_si is null then raise exception 'Tipos de movimento de saldo inicial e de ajuste de inventário não configurados.'; end if;
  perform set_config('app.est_ig', g.id::text, true);   -- só os ajustes deste inventário passam pelo congelamento
  -- primeiro as sobras, depois as faltas: assim nenhuma falta esbarra em saldo que a sobra de outro lote vai repor
  for it in select i.* from est_ig_itens i where i.inventario_id = g.id and i.final is distinct from i.saldo_ref order by (i.final - i.saldo_ref) desc loop
    v_dif := it.final - it.saldo_ref;
    -- a sobra entra pelo custo médio do produto; produto que ainda não tem custo médio (nunca teve estoque) entra como saldo inicial, pelo custo do inventário
    v_tipo := case when v_dif <= 0 then v_ajn
                   when g.implantacao or coalesce((select c.custo_medio from est_custos c where c.produto_id = it.produto_id), 0) = 0 then v_si else v_ajm end;
    insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao)
    values (g.empresa_id, g.referencia, it.produto_id, it.local_id, it.lote_id, v_tipo, v_dif, case when v_tipo = v_si then it.custo end,
            'IG ' || g.numero, left(coalesce(it.justificativa, case when g.implantacao then 'Implantação pelo inventário geral' else 'Inventário geral' end), 200))
    returning id, valor into v_mov, v_val;
    update est_ig_itens set movimento_id = v_mov where id = it.id;
    v_n := v_n + 1; v_valor := v_valor + coalesce(v_val, 0);
  end loop;
  perform set_config('app.est_ig', '', true);
  if g.implantacao then
    insert into est_config (empresa_id, implantado_em) values (g.empresa_id, g.referencia)
    on conflict (empresa_id) do update set implantado_em = coalesce(est_config.implantado_em, excluded.implantado_em);
  end if;
  -- fecha o mês da referência quando ela é o último dia de um mês já terminado: a posição guardada passa a ser o inventário
  if cfg.fechar_mes and g.referencia = (date_trunc('month', g.referencia) + interval '1 month - 1 day')::date and date_trunc('month', g.referencia) < date_trunc('month', current_date) then
    perform public._est_fechar(g.empresa_id, g.referencia); v_fechou := true;
  end if;
  update est_ig_inventarios set situacao = 'aprovado', decidido_por = auth.uid(), decidido_nome = public._ig_nome(g.empresa_id, auth.uid()), decidido_em = now(),
         ajustes = v_n, valor_ajuste = round(v_valor, 2), mes_fechado = v_fechou where id = g.id;
  return jsonb_build_object('ajustes', v_n, 'valor', round(v_valor, 2), 'mes_fechado', v_fechou, 'implantacao', g.implantacao);
end $$;

create or replace function public.est_ig_cancelar(p_inventario uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare g est_ig_inventarios;
begin
  select * into g from est_ig_inventarios where id = p_inventario for update;
  if not found or g.situacao <> 'aberto' then raise exception 'Inventário não encontrado ou já encerrado.'; end if;
  if not public.est_ig_gerencia(g.empresa_id) then raise exception 'Só administrador, financeiro ou diretor cancela o inventário geral.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo do cancelamento.'; end if;
  update est_ig_inventarios set situacao = 'cancelado', decidido_por = auth.uid(), decidido_nome = public._ig_nome(g.empresa_id, auth.uid()), decidido_em = now(), motivo = left(trim(p_motivo), 300) where id = g.id;
end $$;

-- troca quem conta ou quem audita um local (falta, férias), enquanto o local não terminou
create or replace function public.est_ig_trocar(p_ig_local uuid, p_responsavel uuid, p_auditor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare gl est_ig_locais;
begin
  gl := public._ig_local_aberto(p_ig_local);
  if not public.est_ig_gerencia(gl.empresa_id) then raise exception 'Só quem gerencia o inventário troca as pessoas.'; end if;
  if gl.situacao = 'concluido' then raise exception 'Este local já terminou.'; end if;
  if p_responsavel is null or p_responsavel = p_auditor then raise exception 'Quem conta e quem audita precisam ser pessoas diferentes.'; end if;
  if exists (select 1 from est_ig_itens where ig_local_id = gl.id and (contado_por = p_auditor or auditado_por = p_responsavel)) then raise exception 'Quem já contou itens deste local não pode auditá-lo, e quem já auditou não pode contá-lo.'; end if;
  if not exists (select 1 from membros where empresa_id = gl.empresa_id and user_id = p_responsavel and papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao'))
     or (p_auditor is not null and not exists (select 1 from membros where empresa_id = gl.empresa_id and user_id = p_auditor and papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao'))) then
    raise exception 'Quem conta e quem audita precisam ter perfil de estoque.';
  end if;
  update est_ig_locais set responsavel_id = p_responsavel, responsavel_nome = public._ig_nome(gl.empresa_id, p_responsavel),
         auditor_id = p_auditor, auditor_nome = public._ig_nome(gl.empresa_id, p_auditor) where id = gl.id;
end $$;

-- acuracidade por local (depois de aprovado ou durante, para quem gerencia)
create or replace function public.est_ig_acuracidade(p_inventario uuid)
returns table (ig_local_id uuid, local_id uuid, itens int, itens_certos int, pct_itens numeric, valor_sistema numeric, valor_diferenca numeric, pct_valor numeric,
               auditados int, divergiu_auditoria int, pct_auditoria numeric, minutos_contagem int, minutos_auditoria int)
language plpgsql stable security definer set search_path = public as $$
declare g est_ig_inventarios; cfg est_ig_config;
begin
  select * into g from est_ig_inventarios where id = p_inventario;
  if not found or not (public.est_ig_gerencia(g.empresa_id) or public._ig_aprova(g.empresa_id)) then raise exception 'Só quem gerencia ou aprova o inventário vê a acuracidade.'; end if;
  cfg := public._ig_cfg(g.empresa_id);
  return query
  select l.id, l.local_id, count(i.id)::int,
         count(*) filter (where abs(coalesce(i.final, i.contado, 0) - i.saldo_ref) <= i.saldo_ref * cfg.tolerancia_pct / 100 and abs((coalesce(i.final, i.contado, 0) - i.saldo_ref) * i.custo) <= cfg.tolerancia_valor)::int,
         round(100.0 * count(*) filter (where abs(coalesce(i.final, i.contado, 0) - i.saldo_ref) <= i.saldo_ref * cfg.tolerancia_pct / 100 and abs((coalesce(i.final, i.contado, 0) - i.saldo_ref) * i.custo) <= cfg.tolerancia_valor) / nullif(count(i.id), 0), 1),
         round(coalesce(sum(i.saldo_ref * i.custo), 0), 2), round(coalesce(sum(abs(coalesce(i.final, i.contado, 0) - i.saldo_ref) * i.custo), 0), 2),
         round(100 - 100.0 * coalesce(sum(abs(coalesce(i.final, i.contado, 0) - i.saldo_ref) * i.custo), 0) / nullif(sum(greatest(i.saldo_ref, coalesce(i.final, i.contado, 0)) * i.custo), 0), 1),
         count(i.auditado)::int, count(*) filter (where i.terceira is not null or i.situacao = 'divergente')::int,
         round(100.0 * count(*) filter (where i.terceira is not null or i.situacao = 'divergente') / nullif(count(i.auditado), 0), 1),
         (extract(epoch from (l.contado_em - l.iniciado_em)) / 60)::int, (extract(epoch from (l.auditado_em - l.contado_em)) / 60)::int
    from est_ig_locais l left join est_ig_itens i on i.ig_local_id = l.id
   where l.inventario_id = p_inventario group by l.id, l.local_id, l.contado_em, l.iniciado_em, l.auditado_em;
end $$;

-- ------------------------------------------------------------ congelamento dos locais em inventário geral
-- acrescenta a regra à guarda do lançamento (vale para todo movimento, venha da tela ou da plataforma)
-- o ajuste do próprio inventário é o único movimento que passa (variável definida só dentro de est_ig_aprovar)
create or replace function public.g_ig_meu(p_empresa uuid) returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from est_ig_inventarios g where g.empresa_id = p_empresa and g.situacao = 'aberto' and g.id::text = coalesce(current_setting('app.est_ig', true), ''));
$$;
create or replace function public._est_mov_ig() returns trigger language plpgsql set search_path = public as $$
declare v record;
begin
  select g.numero, g.referencia, l.situacao into v from est_ig_locais l join est_ig_inventarios g on g.id = l.inventario_id
   where l.local_id = new.local_id and g.situacao = 'aberto' limit 1;
  if not found then return new; end if;
  if current_user not in ('authenticated', 'anon') then   -- só a plataforma chega aqui; o usuário logado nunca executa a função abaixo
    if g_ig_meu(new.empresa_id) then return new; end if;
  end if;
  if v.situacao <> 'concluido' then
    raise exception 'Local congelado pelo inventário geral nº %: movimente depois que a contagem e a auditoria deste local terminarem.', v.numero;
  end if;
  if new.data <= v.referencia then
    raise exception 'O inventário geral nº % ainda não foi aprovado: movimento com data até % só depois da aprovação.', v.numero, to_char(v.referencia, 'DD/MM/YYYY');
  end if;
  return new;
end $$;
revoke all on function public._est_mov_ig(), public.g_ig_meu(uuid) from public, anon, authenticated;
drop trigger if exists est_movimentos_a_ig on public.est_movimentos;
create trigger est_movimentos_a_ig before insert on public.est_movimentos for each row execute function public._est_mov_ig();

-- o fechamento manual passa a usar a mesma rotina interna
create or replace function public.est_fechar_mes(p_empresa uuid, p_mes date, p_reabrir boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_mes)::date;
begin
  if not pode_editar(p_empresa) then raise exception 'Só administrador ou financeiro fecha o estoque.'; end if;
  perform pg_advisory_xact_lock(hashtext('est_fech:' || p_empresa::text));   -- espera os lançamentos em andamento e segura os novos até terminar
  if p_reabrir then
    if not is_admin(p_empresa) then raise exception 'Só o administrador reabre o mês.'; end if;
    delete from est_fechamentos where empresa_id = p_empresa and mes >= v_mes;
    delete from est_fechamento_saldos where empresa_id = p_empresa and mes >= v_mes;
    return 'reaberto';
  end if;
  if v_mes >= date_trunc('month', current_date)::date then raise exception 'Só se fecha um mês que já terminou.'; end if;
  if exists (select 1 from est_ig_inventarios where empresa_id = p_empresa and situacao = 'aberto' and referencia < (v_mes + interval '1 month')::date) then
    raise exception 'Há um inventário geral aberto com data de referência neste mês: aprove ou cancele o inventário antes de fechar.';
  end if;
  perform public._est_fechar(p_empresa, v_mes);
  return 'fechado';
end $$;

-- ------------------------------------------------------------ concessões
do $$ declare r record; begin
  for r in select p.oid::regprocedure f, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname ~ '^_?(est_ig|ig)_' or p.proname in ('_est_fechar', 'g_ig_meu', '_est_mov_ig', 'est_fechar_mes')) loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    if r.proname ~ '^est_ig_' or r.proname = 'est_fechar_mes' then execute format('grant execute on function %s to authenticated', r.f); end if;
  end loop;
end $$;
