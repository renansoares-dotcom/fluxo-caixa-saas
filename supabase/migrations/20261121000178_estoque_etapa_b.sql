-- 178 — estoque, etapa B da avaliação: restante técnico
--  1. Quem consulta saldo, custo e movimentos: perfis do estoque e, por parâmetro, Leitura (ligado, como já era) e Vendas (desligado).
--     Antes qualquer membro lia custo médio e valor do estoque pela API, inclusive motorista e colaborador do portal.
--  2. Recálculo respeita o mês fechado (parte do saldo do fechamento e refaz só o período aberto) e corrige o "saldo no local" do Kardex.
--  3. Movimento com data anterior a outro já lançado recalcula o produto sozinho, uma vez, no fim da transação.
--  4. Lançamento pela tela de entrada que forma custo exige o custo.
--  5. Crachá conferido no banco na entrega e no balcão (o "crachá lido" não é mais um aviso da tela).
--  6. Funções do estoque deixam de ser executáveis por visitante sem login.
-- Aditivo: nada é apagado. alm_entregar e alm_balcao ganham um parâmetro opcional.

-- ------------------------------------------------------------ 1. quem consulta o estoque
alter table public.est_config add column if not exists papeis_consulta text[] not null default '{leitura}';   -- além dos perfis do estoque; o perfil Leitura já consultava
alter table public.est_config drop constraint if exists est_config_papeis_consulta_ok;
alter table public.est_config add constraint est_config_papeis_consulta_ok check (papeis_consulta <@ array['leitura', 'vendas']);
create or replace function public.pode_ver_estoque(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros m where m.empresa_id = p_empresa and m.user_id = auth.uid()
    and (m.papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao')
         or m.papel::text = any(coalesce((select c.papeis_consulta from est_config c where c.empresa_id = p_empresa), '{leitura}'))));
$$;
revoke all on function public.pode_ver_estoque(uuid) from public, anon;
grant execute on function public.pode_ver_estoque(uuid) to authenticated;
do $$ declare t text; r record; begin
  foreach t in array array['est_saldos', 'est_custos', 'est_movimentos'] loop
    for r in select policyname from pg_policies where schemaname = 'public' and tablename = t and cmd = 'SELECT' loop
      execute format('drop policy %I on public.%I', r.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (public.pode_ver_estoque(empresa_id))', t || '_sel', t);
  end loop;
end $$;
create or replace function public.est_consulta_salvar(p_empresa uuid, p_papeis text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(p_empresa) then raise exception 'Só o administrador define quem consulta o estoque.'; end if;
  if not (coalesce(p_papeis, '{}') <@ array['leitura', 'vendas']) then raise exception 'Perfil inválido.'; end if;
  insert into est_config(empresa_id, papeis_consulta) values (p_empresa, coalesce(p_papeis, '{}'))
  on conflict (empresa_id) do update set papeis_consulta = excluded.papeis_consulta, atualizado_em = now(), atualizado_por = auth.uid();
end $$;
revoke all on function public.est_consulta_salvar(uuid, text[]) from public, anon;
grant execute on function public.est_consulta_salvar(uuid, text[]) to authenticated;

-- ------------------------------------------------------------ 2. recálculo que respeita o fechamento
alter table public.est_custos add column if not exists recalcular boolean not null default false;   -- há movimento com data anterior a outro já lançado

create or replace function public._est_recalc(p_empresa uuid, p_produto uuid)
returns int language plpgsql security definer set search_path = public as $$
declare m record; q numeric := 0; v numeric := 0; cm numeric; n int := 0; val numeric; cu numeric; v_fech date; v_ini date := '0001-01-01'; trf jsonb := '{}';
begin
  if not exists (select 1 from produtos where id = p_produto and empresa_id = p_empresa) then raise exception 'Produto não encontrado nesta empresa.'; end if;
  insert into est_custos(produto_id, empresa_id) values (p_produto, p_empresa) on conflict (produto_id) do nothing;
  perform 1 from est_custos where produto_id = p_produto and empresa_id = p_empresa for update;   -- ninguém movimenta o produto durante o recálculo
  if not found then raise exception 'Produto não encontrado nesta empresa.'; end if;
  select max(mes) into v_fech from est_fechamentos where empresa_id = p_empresa;
  if v_fech is not null then v_ini := (v_fech + interval '1 month')::date; end if;
  perform set_config('app.est_recalculo', 'sim', true);
  -- ponto de partida: o que está em mês fechado não muda
  select coalesce(sum(mv.quantidade), 0), coalesce(sum(mv.valor), 0) into q, v
    from est_movimentos mv join est_locais l on l.id = mv.local_id
   where mv.empresa_id = p_empresa and mv.produto_id = p_produto and mv.data < v_ini and l.compoe_custo;
  select mv.custo_medio_apos into cm from est_movimentos mv
   where mv.empresa_id = p_empresa and mv.produto_id = p_produto and mv.data < v_ini
   order by mv.data desc, mv.criado_em desc, mv.quantidade asc limit 1;
  cm := coalesce(case when q > 0 then v / q end, cm, 0);
  delete from est_saldos where produto_id = p_produto and empresa_id = p_empresa;
  insert into est_saldos(empresa_id, produto_id, local_id, lote_id, quantidade, valor, ultimo_movimento)
  select p_empresa, p_produto, mv.local_id, mv.lote_id, sum(mv.quantidade), sum(mv.valor), max(mv.data)
    from est_movimentos mv join est_locais l on l.id = mv.local_id
   where mv.empresa_id = p_empresa and mv.produto_id = p_produto and mv.data < v_ini and l.controla_saldo
   group by mv.local_id, mv.lote_id;
  -- período aberto, em ordem de data
  for m in select mv.*, l.compoe_custo, l.controla_saldo, t.afeta_custo from est_movimentos mv join est_locais l on l.id = mv.local_id join est_tipos_movimento t on t.id = mv.tipo_movimento_id
            where mv.empresa_id = p_empresa and mv.produto_id = p_produto and mv.data >= v_ini order by mv.data, mv.criado_em, mv.quantidade desc loop
    if m.quantidade > 0 and m.afeta_custo and m.estorno_de is null then cu := m.custo_unitario;
    elsif m.estorno_de is not null then cu := m.custo_unitario;
    else cu := case when q > 0 then v / q else cm end; end if;
    cu := coalesce(cu, case when q > 0 then v / q else cm end);
    if m.transferencia_id is not null and m.estorno_de is null then   -- as duas pernas da transferência saem e entram ao mesmo custo
      if trf ? m.transferencia_id::text then cu := (trf ->> m.transferencia_id::text)::numeric;
      else trf := trf || jsonb_build_object(m.transferencia_id::text, cu); end if;
    end if;
    val := round(m.quantidade * cu, 2);
    if m.compoe_custo then q := q + m.quantidade; v := v + val; if q > 0 then cm := v / q; end if; end if;
    if m.controla_saldo then
      insert into est_saldos(empresa_id, produto_id, local_id, lote_id, quantidade, valor, ultimo_movimento)
      values (p_empresa, p_produto, m.local_id, m.lote_id, m.quantidade, val, m.data)
      on conflict (produto_id, local_id, coalesce(lote_id, '00000000-0000-0000-0000-000000000000'::uuid))
      do update set quantidade = est_saldos.quantidade + excluded.quantidade, valor = est_saldos.valor + excluded.valor,
                    ultimo_movimento = greatest(est_saldos.ultimo_movimento, excluded.ultimo_movimento);
    end if;
    update est_movimentos set custo_unitario = cu, valor = val, custo_medio_apos = cm where id = m.id;
    n := n + 1;
  end loop;
  -- "saldo no local" de cada linha do período aberto, na ordem do Kardex
  update est_movimentos mv set saldo_local_apos = x.s
    from (select a.id, sum(a.quantidade) over (partition by a.local_id, coalesce(a.lote_id, '00000000-0000-0000-0000-000000000000'::uuid)
                                               order by a.data, a.criado_em, a.quantidade desc, a.id) s
            from est_movimentos a join est_locais l on l.id = a.local_id
           where a.empresa_id = p_empresa and a.produto_id = p_produto and l.controla_saldo) x
   where mv.id = x.id and mv.data >= v_ini and mv.saldo_local_apos is distinct from x.s;
  update est_custos set quantidade = q, valor = v, custo_medio = cm, recalcular = false where produto_id = p_produto and empresa_id = p_empresa;
  perform set_config('app.est_recalculo', 'nao', true);
  return n;
end $$;
revoke all on function public._est_recalc(uuid, uuid) from public, anon, authenticated;

create or replace function public.est_recalcular(p_empresa uuid, p_produto uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not pode_editar(p_empresa) then raise exception 'Só administrador ou financeiro recalcula o estoque.'; end if;
  return _est_recalc(p_empresa, p_produto);
end $$;

-- ------------------------------------------------------------ 3. movimento com data antiga recalcula sozinho
create or replace function public._est_mov_retro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.est_recalculo', true) = 'sim' then return null; end if;
  if exists (select 1 from est_movimentos x where x.empresa_id = new.empresa_id and x.produto_id = new.produto_id and x.data > new.data) then
    update est_custos set recalcular = true where produto_id = new.produto_id and not recalcular;
  end if;
  return null;
end $$;
revoke all on function public._est_mov_retro() from public, anon, authenticated;
drop trigger if exists est_movimentos_retro on public.est_movimentos;
create trigger est_movimentos_retro after insert on public.est_movimentos for each row execute function public._est_mov_retro();

-- no fim da transação: um recálculo por produto, mesmo que tenham entrado vários movimentos antigos
create or replace function public._est_mov_retro_fim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from est_custos where produto_id = new.produto_id and recalcular) then perform _est_recalc(new.empresa_id, new.produto_id); end if;
  return null;
end $$;
revoke all on function public._est_mov_retro_fim() from public, anon, authenticated;
drop trigger if exists est_movimentos_retro_fim on public.est_movimentos;
create constraint trigger est_movimentos_retro_fim after insert on public.est_movimentos deferrable initially deferred for each row execute function public._est_mov_retro_fim();

-- ------------------------------------------------------------ 4. entrada que forma custo exige o custo (lançamento pela tela)
create or replace function public._est_mov_guarda() returns trigger language plpgsql set search_path = public as $$
declare tm record; v_papel text;
begin
  if new.lote_id is not null and not exists (select 1 from est_lotes l where l.id = new.lote_id and l.produto_id = new.produto_id and l.empresa_id = new.empresa_id) then
    raise exception 'O lote informado não é deste produto.';
  end if;
  if current_user not in ('authenticated', 'anon') then return new; end if;
  -- lançamento direto pela tela
  if new.estorno_de is not null then raise exception 'Estorno só pelo botão Estornar.'; end if;
  if new.transferencia_id is not null then raise exception 'Transferência só pela função de transferência.'; end if;
  if new.nota_id is not null or new.nfe_item_id is not null then raise exception 'Movimento de nota fiscal é lançado pela plataforma.'; end if;
  select t.sentido, t.afeta_custo, t.papeis_manual, t.nome into tm from est_tipos_movimento t where t.id = new.tipo_movimento_id and t.empresa_id = new.empresa_id;
  if not found then raise exception 'Tipo de movimento não encontrado.'; end if;
  if tm.sentido = 'T' then raise exception 'Transferência só pela função de transferência.'; end if;
  if coalesce(cardinality(tm.papeis_manual), 0) > 0 then
    v_papel := papel_em(new.empresa_id);
    if v_papel is distinct from 'admin' and not (v_papel = any(tm.papeis_manual)) then
      raise exception 'Seu perfil não lança "%" à mão. Quem pode está em Estoque › Parâmetros › Tipos de movimento.', tm.nome;
    end if;
  end if;
  if tm.sentido = 'E' and tm.afeta_custo then
    if new.quantidade > 0 and (new.custo_unitario is null or new.custo_unitario < 0) then raise exception 'Informe o custo unitário: "%" forma o custo médio.', tm.nome; end if;
  else new.custo_unitario := null;   -- custo informado só na entrada que forma custo
  end if;
  new.criado_por := auth.uid(); new.criado_em := now();
  new.valor := null; new.custo_medio_apos := null; new.saldo_local_apos := null;
  return new;
end $$;

-- ------------------------------------------------------------ 5. crachá conferido no banco
create or replace function public._alm_cracha_confere(p_empresa uuid, p_codigo text, p_retirou uuid, p_nome text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare c crachas; k rh_colaboradores;
begin
  if nullif(trim(coalesce(p_codigo, '')), '') is null then return false; end if;
  select * into c from crachas where empresa_id = p_empresa and codigo = trim(p_codigo);
  if not found then raise exception 'Crachá não encontrado nesta empresa'; end if;
  if c.status <> 'ativo' then raise exception 'Crachá %', c.status; end if;
  if c.validade is not null and c.validade < current_date then raise exception 'Crachá vencido'; end if;
  if c.colaborador_id is not null then
    select * into k from rh_colaboradores where id = c.colaborador_id;
    if k.situacao = 'desligado' then raise exception 'Pessoa desligada'; end if;
    if p_retirou is distinct from c.colaborador_id then raise exception 'O crachá lido não é de quem está retirando'; end if;
  elsif p_retirou is not null or lower(trim(coalesce(p_nome, ''))) <> lower(trim(c.nome)) then
    raise exception 'O crachá lido não é de quem está retirando';
  end if;
  return true;
end $$;
revoke all on function public._alm_cracha_confere(uuid, text, uuid, text) from public, anon, authenticated;

drop function if exists public.alm_entregar(uuid, jsonb, uuid, text, boolean, text);
create or replace function public.alm_entregar(p_id uuid, p_itens jsonb, p_retirou uuid default null, p_retirou_nome text default null, p_cracha boolean default false, p_obs text default null, p_cracha_codigo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r alm_requisicoes; cfg alm_config; k rh_colaboradores; it jsonb; i alm_requisicao_itens; p produtos; tm uuid; v_ent uuid; v_q numeric; v_loc uuid; v_mov uuid; v_val numeric := 0; v_v numeric;
  v_resta numeric; v_tira numeric; l record; v_nome text; v_hoje date := (now() at time zone 'America/Recife')::date; v_cc uuid; v_n int := 0; v_cracha boolean;
begin
  select * into r from alm_requisicoes where id = p_id for update;
  if not found or not public.alm_almoxarife(r.empresa_id) then raise exception 'Só quem atende o almoxarifado entrega'; end if;
  if r.situacao not in ('aberta', 'parcial') then raise exception 'Esta requisição não está liberada para entrega (%).', r.situacao; end if;
  if jsonb_typeof(coalesce(p_itens, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Informe o que está sendo entregue'; end if;
  select * into cfg from alm_config where empresa_id = r.empresa_id;
  v_cracha := public._alm_cracha_confere(r.empresa_id, p_cracha_codigo, p_retirou, p_retirou_nome);   -- o banco confere o crachá: o aviso da tela não basta
  if coalesce(cfg.exigir_cracha, false) and not v_cracha then raise exception 'A entrega exige a leitura do crachá de quem retira'; end if;
  if p_retirou is not null then
    select * into k from rh_colaboradores where id = p_retirou and empresa_id = r.empresa_id;
    if not found then raise exception 'Quem retira não é colaborador desta empresa'; end if;
  end if;
  v_nome := coalesce(k.nome, nullif(trim(coalesce(p_retirou_nome, '')), ''));
  if v_nome is null then raise exception 'Identifique quem está retirando (crachá ou nome)'; end if;
  select id into tm from est_tipos_movimento where empresa_id = r.empresa_id and codigo = 'REQINT' and ativo;
  if tm is null then select id into tm from est_tipos_movimento where empresa_id = r.empresa_id and sentido = 'S' and documento = 'requisicao' and ativo order by codigo limit 1; end if;
  if tm is null then raise exception 'Falta o tipo de movimento de requisição interna (Estoque › Parâmetros › Tipos de movimento)'; end if;
  v_cc := coalesce(k.centro_custo_id, r.centro_custo_id);
  insert into alm_entregas (empresa_id, requisicao_id, entregue_por, entregue_nome, retirou_colaborador_id, retirou_nome, cracha_lido, observacao)
  values (r.empresa_id, p_id, auth.uid(), public._alm_nome(r.empresa_id), k.id, v_nome, v_cracha, left(nullif(trim(coalesce(p_obs, '')), ''), 300)) returning id into v_ent;
  for it in select * from jsonb_array_elements(p_itens) loop
    v_q := (it ->> 'quantidade')::numeric; if v_q is null or v_q <= 0 then continue; end if;
    select * into i from alm_requisicao_itens where id = (it ->> 'item_id')::uuid and requisicao_id = p_id for update;
    if not found then raise exception 'Item que não é desta requisição'; end if;
    if v_q > i.quantidade - i.qtd_entregue + 0.00005 then raise exception 'Entrega de % maior que o pendente (%).', i.descricao, i.quantidade - i.qtd_entregue; end if;
    v_loc := (it ->> 'local_id')::uuid;
    if not public._alm_local(r.empresa_id, v_loc) then raise exception 'O local de % não é do almoxarifado', i.descricao; end if;
    select * into p from produtos where id = i.produto_id;
    if coalesce(p.controla_lote, false) then
      -- produto com lote: sai do lote mais antigo com saldo no local
      v_resta := v_q;
      for l in select s.lote_id, s.quantidade from est_saldos s join est_lotes lt on lt.id = s.lote_id where s.produto_id = p.id and s.local_id = v_loc and s.quantidade > 0 order by lt.criado_em, lt.codigo loop
        exit when v_resta <= 0; v_tira := least(v_resta, l.quantidade);
        insert into est_movimentos (empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, documento, observacao, centro_custo_id)
        values (r.empresa_id, v_hoje, p.id, v_loc, l.lote_id, tm, -v_tira, 'RM ' || r.numero, 'Requisição ao almoxarifado nº ' || r.numero || ' — ' || v_nome, v_cc) returning id, valor into v_mov, v_v;
        insert into alm_entrega_itens (entrega_id, empresa_id, item_id, produto_id, local_id, lote_id, quantidade, movimento_id) values (v_ent, r.empresa_id, i.id, p.id, v_loc, l.lote_id, v_tira, v_mov);
        v_val := v_val + abs(coalesce(v_v, 0)); v_resta := v_resta - v_tira;
      end loop;
      if v_resta > 0.00005 then raise exception 'Saldo insuficiente de % nos lotes deste local: faltam %.', p.codigo, v_resta; end if;
    else
      insert into est_movimentos (empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, documento, observacao, centro_custo_id)
      values (r.empresa_id, v_hoje, p.id, v_loc, tm, -v_q, 'RM ' || r.numero, 'Requisição ao almoxarifado nº ' || r.numero || ' — ' || v_nome, v_cc) returning id, valor into v_mov, v_v;
      insert into alm_entrega_itens (entrega_id, empresa_id, item_id, produto_id, local_id, quantidade, movimento_id) values (v_ent, r.empresa_id, i.id, p.id, v_loc, v_q, v_mov);
      v_val := v_val + abs(coalesce(v_v, 0));
    end if;
    update alm_requisicao_itens set qtd_entregue = qtd_entregue + v_q where id = i.id; v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Informe a quantidade de pelo menos um item'; end if;
  update alm_entregas set valor = round(v_val, 2) where id = v_ent;
  update alm_requisicoes set situacao = case when exists(select 1 from alm_requisicao_itens where requisicao_id = p_id and qtd_entregue < quantidade - 0.00005) then 'parcial' else 'atendida' end,
    centro_custo_id = coalesce(centro_custo_id, v_cc), atualizado_em = now() where id = p_id returning situacao into r.situacao;
  if r.solicitante_id is not null and r.solicitante_id <> auth.uid() then
    insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id)
    values (r.empresa_id, r.solicitante_id, 'almoxarifado', 'Requisição nº ' || r.numero || case when r.situacao = 'atendida' then ' entregue' else ' entregue em parte' end, 'Retirada por ' || v_nome || '.', '#/almoxarifado?id=' || p_id, p_id);
  end if;
  return jsonb_build_object('entrega_id', v_ent, 'situacao', r.situacao, 'valor', round(v_val, 2));
end $$;
drop function if exists public.alm_balcao(uuid, jsonb, uuid, text, boolean, text);
create or replace function public.alm_balcao(p_empresa uuid, p_itens jsonb, p_retirou uuid default null, p_retirou_nome text default null, p_cracha boolean default false, p_motivo text default null, p_cracha_codigo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg alm_config; v jsonb; e jsonb; v_it jsonb;
begin
  if not public.alm_almoxarife(p_empresa) then raise exception 'Só quem atende o almoxarifado registra retirada no balcão'; end if;
  select * into cfg from alm_config where empresa_id = p_empresa;
  if not coalesce(cfg.permitir_balcao, true) then raise exception 'A retirada no balcão está desligada: é preciso pedir antes'; end if;
  if p_retirou is null and nullif(trim(coalesce(p_retirou_nome, '')), '') is null then raise exception 'Identifique quem está retirando (crachá ou nome)'; end if;
  if coalesce(cfg.exigir_cracha, false) and not public._alm_cracha_confere(p_empresa, p_cracha_codigo, p_retirou, p_retirou_nome) then raise exception 'A entrega exige a leitura do crachá de quem retira'; end if;
  v := public.alm_requisitar(p_empresa, p_itens, p_motivo, p_retirou, p_retirou_nome, 'balcao');
  if v ->> 'situacao' <> 'aberta' then return v || jsonb_build_object('entregue', false); end if;
  select jsonb_agg(jsonb_build_object('item_id', i.id, 'quantidade', i.quantidade, 'local_id', x ->> 'local_id')) into v_it
    from alm_requisicao_itens i join jsonb_array_elements(p_itens) x on (x ->> 'produto_id')::uuid = i.produto_id where i.requisicao_id = (v ->> 'id')::uuid;
  e := public.alm_entregar((v ->> 'id')::uuid, v_it, p_retirou, p_retirou_nome, false, null, p_cracha_codigo);
  return v || e || jsonb_build_object('entregue', true);
end $$;
revoke all on function public.alm_entregar(uuid, jsonb, uuid, text, boolean, text, text), public.alm_balcao(uuid, jsonb, uuid, text, boolean, text, text) from public, anon;
grant execute on function public.alm_entregar(uuid, jsonb, uuid, text, boolean, text, text), public.alm_balcao(uuid, jsonb, uuid, text, boolean, text, text) to authenticated;

-- ------------------------------------------------------------ 6. nada do estoque para visitante sem login
do $$ declare r record; begin
  for r in select p.oid::regprocedure f, p.prorettype = 'trigger'::regtype gat, has_function_privilege('authenticated', p.oid, 'execute') aut
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname ~ '^_?(est|alm|etq)_' or p.proname in ('pode_estoque', 'papel_em', 'pode_ver_estoque')) loop
    if r.aut and not r.gat then execute format('grant execute on function %s to authenticated', r.f); end if;   -- quem já usava logado continua usando
    execute format('revoke execute on function %s from public, anon', r.f);
    if r.gat then execute format('revoke execute on function %s from authenticated', r.f); end if;
  end loop;
end $$;
