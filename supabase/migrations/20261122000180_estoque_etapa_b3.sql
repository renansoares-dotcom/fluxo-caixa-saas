-- 180 — estoque, etapa B3: achados da terceira avaliação (todos reproduzidos pelo avaliador)
--  1. Recálculo: o estorno acompanha o custo recalculado do movimento que ele desfaz (o valor do estoque não se perde).
--  2. Saída com data antiga não deixa o saldo negativo em nenhum dia (não sai a custo zero).
--  3. Verificação em duas etapas na aprovação do inventário, nas etiquetas e nos módulos que lançam no Kardex.
--  4. Leitura do estoque sem função por linha (lista de empresas resolvida uma vez) e índice por empresa e data.
--  5. Fechamento e lançamento não se atropelam (trava por empresa); só se fecha mês que terminou.
--  6. Requisição: só item do catálogo do almoxarifado; valores e custo só para quem atende e quem aprova.
--  7. Perda e requisição direta restritas por perfil; primeiro custo de um produto confirmado por quem responde por ele;
--     transferência respeita o limite de dias.
--  8. Estorno de movimento lançado por outro módulo é barrado; atalhos por variável de sessão só valem para a plataforma;
--     lote e tipo conferem a empresa; parâmetros de segregação do inventário só pelo administrador; privilégios sobrando revogados.
-- Aditivo: nada é apagado.

-- ------------------------------------------------------------ 4. leitura sem função por linha
create or replace function public.est_empresas_que_vejo() returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.empresa_id from membros m
   where m.user_id = auth.uid()
     and (m.papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao')
          or m.papel::text = any(coalesce((select c.papeis_consulta from est_config c where c.empresa_id = m.empresa_id), '{leitura}')))
     and public._mfa_ok(m.empresa_id);
$$;
revoke all on function public.est_empresas_que_vejo() from public, anon;
grant execute on function public.est_empresas_que_vejo() to authenticated;
do $$ declare t text; r record; begin
  foreach t in array array['est_movimentos', 'est_saldos', 'est_custos', 'est_inv_contagens', 'est_inv_itens', 'est_fechamento_saldos'] loop
    for r in select policyname from pg_policies where schemaname = 'public' and tablename = t and cmd = 'SELECT' loop
      execute format('drop policy %I on public.%I', r.policyname, t);
    end loop;
    -- a subconsulta é resolvida uma vez por consulta, e não uma vez por linha
    execute format('create policy %I on public.%I for select to authenticated using (empresa_id in (select public.est_empresas_que_vejo()))', t || '_sel', t);
  end loop;
end $$;
create index if not exists est_mov_emp_data on public.est_movimentos (empresa_id, data desc, criado_em desc);

-- ------------------------------------------------------------ 2, 5 e 7. guarda do lançamento
create or replace function public._est_mov_guarda() returns trigger language plpgsql set search_path = public as $$
declare tm record; v_papel text; cfg record; v_cm numeric; v_inv int; v_base numeric; v_min numeric;
begin
  -- quem lança espera o fechamento em andamento terminar (e o fechamento espera os lançamentos em andamento): a posição guardada bate com o Kardex
  perform pg_advisory_xact_lock_shared(hashtext('est_fech:' || new.empresa_id::text));
  -- valem para todo movimento, venha da tela ou da plataforma
  if new.lote_id is not null and not exists (select 1 from est_lotes l where l.id = new.lote_id and l.produto_id = new.produto_id and l.empresa_id = new.empresa_id) then
    raise exception 'O lote informado não é deste produto.';
  end if;
  if new.centro_custo_id is not null and not exists (select 1 from centros_custo c where c.id = new.centro_custo_id and c.empresa_id = new.empresa_id) then
    raise exception 'Centro de custo de outra empresa.';
  end if;
  -- item em contagem com o bloqueio ligado: só o ajuste da própria contagem passa
  select g.numero into v_inv from est_inv_contagens g join est_inv_itens i on i.contagem_id = g.id join est_inv_config f on f.empresa_id = g.empresa_id
   where g.empresa_id = new.empresa_id and g.local_id = new.local_id and g.situacao in ('aberta', 'em_aprovacao') and f.bloquear_movimento
     and i.produto_id = new.produto_id and i.lote_id is not distinct from new.lote_id
     and not (current_user not in ('authenticated', 'anon') and g.id::text = current_setting('app.est_inventario', true)) limit 1;
  if v_inv is not null then raise exception 'Item em contagem no inventário nº %: movimente depois que a contagem for concluída.', v_inv; end if;

  -- saída com data anterior a outros movimentos: o saldo do local não pode ficar negativo em nenhum dia dali em diante
  if new.quantidade < 0
     and exists (select 1 from est_movimentos x where x.empresa_id = new.empresa_id and x.produto_id = new.produto_id and x.local_id = new.local_id
                   and x.lote_id is not distinct from new.lote_id and x.data > new.data)
     and exists (select 1 from est_locais l where l.id = new.local_id and l.controla_saldo and not l.permite_negativo) then
    select coalesce(sum(a.quantidade), 0) + new.quantidade into v_base from est_movimentos a
     where a.empresa_id = new.empresa_id and a.produto_id = new.produto_id and a.local_id = new.local_id and a.lote_id is not distinct from new.lote_id and a.data <= new.data;
    select min(z.c) into v_min from (select sum(b.quantidade) over (order by b.data, b.criado_em, b.quantidade desc, b.id) c from est_movimentos b
     where b.empresa_id = new.empresa_id and b.produto_id = new.produto_id and b.local_id = new.local_id and b.lote_id is not distinct from new.lote_id and b.data > new.data) z;
    if v_base + least(coalesce(v_min, 0), 0) < -0.00005 then
      raise exception 'Saldo insuficiente em %: com esta saída o saldo do local ficaria negativo nessa data ou em data posterior.', to_char(new.data, 'DD/MM/YYYY');
    end if;
  end if;

  if current_user not in ('authenticated', 'anon') then return new; end if;
  -- lançamento direto pela tela
  if new.data > current_date then raise exception 'Movimento com data futura (%).', to_char(new.data, 'DD/MM/YYYY'); end if;
  if new.estorno_de is not null then raise exception 'Estorno só pelo botão Estornar.'; end if;
  if new.transferencia_id is not null then raise exception 'Transferência só pela função de transferência.'; end if;
  if new.nota_id is not null or new.nfe_item_id is not null then raise exception 'Movimento de nota fiscal é lançado pela plataforma.'; end if;
  select t.sentido, t.afeta_custo, t.papeis_manual, t.nome, t.documento into tm from est_tipos_movimento t where t.id = new.tipo_movimento_id and t.empresa_id = new.empresa_id;
  if not found then raise exception 'Tipo de movimento não encontrado.'; end if;
  if tm.sentido = 'T' then raise exception 'Transferência só pela função de transferência.'; end if;
  v_papel := papel_em(new.empresa_id);
  if not pode_estoque(new.empresa_id) then return new; end if;   -- quem não movimenta o estoque é barrado logo adiante, pela regra de acesso da tabela
  if coalesce(cardinality(tm.papeis_manual), 0) > 0 and v_papel is distinct from 'admin' and not (v_papel = any(tm.papeis_manual)) then
    raise exception 'Seu perfil não lança "%" à mão. Quem pode está em Estoque › Parâmetros › Tipos de movimento.', tm.nome;
  end if;
  -- empresa sem configuração gravada usa o padrão (60 dias, 50 %); com configuração, nulo desliga a trava
  select case when c.empresa_id is null then 60 else c.dias_retroativos end dias, case when c.empresa_id is null then 50 else c.custo_desvio_pct end desvio, coalesce(c.exigir_documento, true) doc into cfg
    from (select 1) x left join est_config c on c.empresa_id = new.empresa_id;
  if v_papel is distinct from 'admin' and cfg.dias is not null and cfg.dias >= 0 and new.data < current_date - cfg.dias then
    raise exception 'Data anterior ao limite de % dias para lançamento à mão. O administrador pode lançar, ou ajuste o limite em Estoque › Parâmetros › Acesso.', cfg.dias;
  end if;
  if tm.sentido = 'E' and tm.afeta_custo then
    if new.quantidade > 0 and (new.custo_unitario is null or new.custo_unitario < 0) then raise exception 'Informe o custo unitário: "%" forma o custo médio.', tm.nome; end if;
    if new.quantidade > 0 and cfg.doc and tm.documento <> 'nenhum' and nullif(trim(coalesce(new.documento, '')), '') is null then
      raise exception 'Informe o documento (nota, ordem ou inventário): "%" forma o custo médio.', tm.nome;
    end if;
    -- custo muito diferente do custo médio do produto: só administrador, financeiro ou diretor confirma
    if new.quantidade > 0 and cfg.desvio is not null and v_papel not in ('admin', 'financeiro', 'diretor') then
      select custo_medio into v_cm from est_custos where produto_id = new.produto_id and quantidade > 0;
      if coalesce(v_cm, 0) = 0 and new.custo_unitario > 0 then   -- sem custo médio para comparar: o primeiro custo do produto é confirmado por quem responde por ele
        raise exception 'Este produto ainda não tem custo médio: o primeiro custo lançado à mão é confirmado por administrador, financeiro ou diretor.';
      end if;
      if coalesce(v_cm, 0) > 0 and abs(new.custo_unitario - v_cm) / v_cm * 100 > cfg.desvio then
        raise exception 'Custo de R$ % difere mais de % %% do custo médio (R$ %). Confira o valor; se estiver certo, o lançamento é feito por administrador, financeiro ou diretor.',
          trim(to_char(new.custo_unitario, 'FM999G999G990D0000')), cfg.desvio, trim(to_char(v_cm, 'FM999G999G990D0000'));
      end if;
    end if;
  else new.custo_unitario := null;   -- custo informado só na entrada que forma custo
  end if;
  new.criado_por := auth.uid(); new.criado_em := now();
  new.valor := null; new.custo_medio_apos := null; new.saldo_local_apos := null;
  return new;
end $$;

create or replace function public._est_mov_imutavel() returns trigger language plpgsql set search_path = public as $$
begin
  -- só o recálculo da própria plataforma regrava custo e saldo de um movimento; a variável sozinha não basta
  if current_setting('app.est_recalculo', true) = 'sim' and current_user not in ('authenticated', 'anon') then return coalesce(new, old); end if;
  raise exception 'Movimento de estoque não se altera nem se exclui: use o estorno.';
end $$;

update public.est_tipos_movimento set papeis_manual = case codigo
    when 'PERDA' then '{financeiro,diretor}'::text[] when 'REQPROD' then '{financeiro,diretor,producao}'::text[] else '{financeiro,diretor,compras}'::text[] end
 where sistema and papeis_manual is null and codigo in ('PERDA', 'REQPROD', 'REQINT');
create or replace function public._est_tipo_padrao() returns trigger language plpgsql set search_path = public as $$
begin
  if new.papeis_manual is null and new.sistema then
    new.papeis_manual := case when new.codigo in ('SI', 'AJ+', 'AJ-', 'PERDA') then '{financeiro,diretor}'::text[]
                              when new.codigo in ('PROD', 'APARA', 'REQPROD') then '{financeiro,diretor,producao}'::text[]
                              when new.codigo in ('COMPRA', 'REQINT') or new.documento = 'nf' then '{financeiro,diretor,compras}'::text[] end;
  end if;
  return new;
end $$;

-- ------------------------------------------------------------ 1. recálculo
create or replace function public._est_recalc(p_empresa uuid, p_produto uuid, p_desde date default null)
returns int language plpgsql security definer set search_path = public as $$
declare m record; q numeric := 0; v numeric := 0; cm numeric; n int := 0; val numeric; cu numeric; v_fech date; v_ini date := '0001-01-01'; trf jsonb := '{}';
begin
  if not exists (select 1 from produtos where id = p_produto and empresa_id = p_empresa) then raise exception 'Produto não encontrado nesta empresa.'; end if;
  insert into est_custos(produto_id, empresa_id) values (p_produto, p_empresa) on conflict (produto_id) do nothing;
  perform 1 from est_custos where produto_id = p_produto and empresa_id = p_empresa for update;   -- ninguém movimenta o produto durante o recálculo
  if not found then raise exception 'Produto não encontrado nesta empresa.'; end if;
  select max(mes) into v_fech from est_fechamentos where empresa_id = p_empresa;
  if v_fech is not null then v_ini := (v_fech + interval '1 month')::date; end if;
  if p_desde is not null and p_desde > v_ini then v_ini := p_desde; end if;   -- o que veio antes da data do movimento não muda
  perform set_config('app.est_recalculo', 'sim', true);
  -- ponto de partida: o que está antes de v_ini (mês fechado ou anterior ao movimento) fica como está
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
  for m in select mv.*, l.compoe_custo, l.controla_saldo, t.afeta_custo from est_movimentos mv join est_locais l on l.id = mv.local_id join est_tipos_movimento t on t.id = mv.tipo_movimento_id
            where mv.empresa_id = p_empresa and mv.produto_id = p_produto and mv.data >= v_ini order by mv.data, mv.criado_em, mv.quantidade desc loop
    if m.quantidade > 0 and m.afeta_custo and m.estorno_de is null then cu := m.custo_unitario;
    elsif m.estorno_de is not null then   -- o estorno acompanha o custo (já recalculado) do movimento que ele desfaz
      select coalesce(o.custo_unitario, m.custo_unitario) into cu from est_movimentos o where o.id = m.estorno_de;
      cu := coalesce(cu, m.custo_unitario);
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
    if m.custo_unitario is distinct from cu or m.valor is distinct from val or m.custo_medio_apos is distinct from cm then   -- só regrava o que mudou
      update est_movimentos set custo_unitario = cu, valor = val, custo_medio_apos = cm where id = m.id;
    end if;
    n := n + 1;
  end loop;
  update est_movimentos mv set saldo_local_apos = x.s
    from (select a.id, sum(a.quantidade) over (partition by a.local_id, coalesce(a.lote_id, '00000000-0000-0000-0000-000000000000'::uuid)
                                               order by a.data, a.criado_em, a.quantidade desc, a.id) s
            from est_movimentos a join est_locais l on l.id = a.local_id
           where a.empresa_id = p_empresa and a.produto_id = p_produto and l.controla_saldo) x
   where mv.id = x.id and mv.data >= v_ini and mv.saldo_local_apos is distinct from x.s;
  update est_custos set quantidade = q, valor = v, custo_medio = cm, recalcular = false, recalcular_desde = null where produto_id = p_produto and empresa_id = p_empresa;
  perform set_config('app.est_recalculo', 'nao', true);
  return n;
end $$;

-- ------------------------------------------------------------ 8. estorno
create or replace function public.est_estornar(p_mov uuid, p_data date default current_date, p_motivo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare fk record; v_tem boolean; v_pilha text; v_direto boolean; m est_movimentos; x est_movimentos; v uuid; v_primeiro uuid; v_papel text; tm record; ei record; v_data date := coalesce(p_data, current_date); v_req uuid;
begin
  -- chamado direto pela tela do Kardex, ou por outra função da plataforma (pesagem de tinta, ordem de serviço...) que está desfazendo o próprio documento?
  get diagnostics v_pilha = pg_context;
  v_direto := (length(v_pilha) - length(replace(v_pilha, 'function ', ''))) / length('function ') <= 1;
  select * into m from est_movimentos where id = p_mov for update;
  if not found then raise exception 'Movimento não encontrado'; end if;
  if not pode_estoque(m.empresa_id) then raise exception 'Sem permissão para movimentar o estoque.'; end if;
  if m.estorno_de is not null then raise exception 'Um estorno não se estorna: lance o movimento de novo.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do estorno.'; end if;
  if v_data < m.data then raise exception 'O estorno não pode ter data anterior à do movimento (%).', to_char(m.data, 'DD/MM/YYYY'); end if;
  if v_data > current_date then raise exception 'O estorno não pode ter data futura.'; end if;
  v_papel := papel_em(m.empresa_id);
  -- a transferência é estornada inteira: primeiro a entrada (devolve do destino), depois a saída (repõe na origem)
  for x in select * from est_movimentos where id = m.id or (m.transferencia_id is not null and transferencia_id = m.transferencia_id and empresa_id = m.empresa_id and estorno_de is null)
            order by quantidade desc for update loop
    if exists (select 1 from est_movimentos where estorno_de = x.id) then
      if x.id = m.id then raise exception 'Movimento já estornado.'; end if;
      continue;
    end if;
    -- quem não pode lançar o tipo também não o estorna; movimento de nota fiscal, só administrador, financeiro ou diretor
    select t.papeis_manual, t.nome into tm from est_tipos_movimento t where t.id = x.tipo_movimento_id;
    if v_papel is distinct from 'admin' then
      if coalesce(cardinality(tm.papeis_manual), 0) > 0 and not (v_papel = any(tm.papeis_manual)) then raise exception 'Seu perfil não estorna "%".', tm.nome; end if;
      if x.nota_id is not null and v_papel not in ('financeiro', 'diretor') then raise exception 'Movimento de nota fiscal: o estorno é feito por administrador, financeiro ou diretor.'; end if;
    end if;
    -- movimento lançado por outro módulo (pesagem de tinta, peça de ordem de serviço, aditivo da recuperadora...): desfaz-se pelo documento de origem
    if v_direto then for fk in select c.conrelid::regclass tab, a.attname col,
                  case c.conrelid::regclass::text when 'tin_pesagens' then 'pesagem de tinta' when 'man_os_pecas' then 'peça de ordem de serviço da manutenção'
                       when 'rec_ordem_aditivos' then 'aditivo de ordem da recuperadora' else c.conrelid::regclass::text end nome
                from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
               where c.contype = 'f' and c.confrelid = 'public.est_movimentos'::regclass
                 and c.conrelid not in ('public.est_movimentos'::regclass, 'public.alm_entrega_itens'::regclass, 'public.est_inv_itens'::regclass) loop
      execute format('select exists (select 1 from %s where %I = $1)', fk.tab, fk.col) into v_tem using x.id;
      if v_tem then raise exception 'Este movimento foi lançado por outro documento (%): desfaça por lá, para o documento e o estoque ficarem iguais.', fk.nome; end if;
    end loop; end if;
    if exists (select 1 from alm_entrega_itens where movimento_id = x.id) and not alm_almoxarife(x.empresa_id) then
      raise exception 'Saída de requisição de material: o estorno é feito por quem atende o almoxarifado.';
    end if;
    insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, estorno_de, documento, observacao, centro_custo_id)
    values (x.empresa_id, v_data, x.produto_id, x.local_id, x.lote_id, x.tipo_movimento_id, -x.quantidade, x.custo_unitario, x.id, x.documento,
            'Estorno: ' || left(trim(p_motivo), 180), x.centro_custo_id)
    returning id into v;
    if x.id = m.id then v_primeiro := v; end if;
    -- saída de requisição: o material voltou, então a requisição deixa de constar como entregue
    for ei in select e.*, n.requisicao_id from alm_entrega_itens e join alm_entregas n on n.id = e.entrega_id where e.movimento_id = x.id and e.estornado_em is null loop
      update alm_entrega_itens set estornado_em = now(), estornado_por = auth.uid() where id = ei.id;
      update alm_requisicao_itens set qtd_entregue = greatest(qtd_entregue - ei.quantidade, 0) where id = ei.item_id;
      update alm_entregas n set valor = greatest(n.valor - abs(coalesce(x.valor, 0)), 0),
             estornada_em = case when not exists (select 1 from alm_entrega_itens o where o.entrega_id = n.id and o.estornado_em is null) then now() end
       where n.id = ei.entrega_id;
      v_req := ei.requisicao_id;
      update alm_requisicoes r set atualizado_em = now(),
             situacao = case when r.situacao in ('parcial', 'atendida') then
                               case when exists (select 1 from alm_requisicao_itens i where i.requisicao_id = r.id and i.qtd_entregue > 0) then 'parcial' else 'aberta' end
                             else r.situacao end
       where r.id = v_req;
    end loop;
  end loop;
  return v_primeiro;
end $$;

create or replace function public.est_transferir(p_empresa uuid, p_data date, p_produto uuid, p_origem uuid, p_destino uuid, p_qtd numeric,
  p_lote uuid default null, p_tipo uuid default null, p_obs text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare g uuid := gen_random_uuid(); t uuid; v_dias int;
begin
  if not pode_estoque(p_empresa) then raise exception 'Sem permissão para movimentar o estoque.'; end if;
  if p_qtd <= 0 then raise exception 'Quantidade da transferência deve ser positiva.'; end if;
  if p_origem = p_destino then raise exception 'Origem e destino iguais.'; end if;
  if p_data > current_date then raise exception 'Transferência com data futura.'; end if;
  select case when c.empresa_id is null then 60 else c.dias_retroativos end into v_dias from (select 1) x left join est_config c on c.empresa_id = p_empresa;
  if v_dias is not null and p_data < current_date - v_dias and papel_em(p_empresa) is distinct from 'admin' then
    raise exception 'Data anterior ao limite de % dias para lançamento à mão. O administrador pode lançar, ou ajuste o limite em Estoque › Parâmetros › Acesso.', v_dias;
  end if;
  if (select count(*) from est_locais where id in (p_origem, p_destino) and empresa_id = p_empresa) <> 2 then raise exception 'Local não encontrado nesta empresa.'; end if;
  if (select count(distinct compoe_custo) from est_locais where id in (p_origem, p_destino)) > 1 then
    raise exception 'Transferência entre um local que compõe o custo e outro que não compõe muda o valor do estoque: use um tipo de saída ou de entrada.';
  end if;
  t := coalesce(p_tipo, (select id from est_tipos_movimento where empresa_id = p_empresa and codigo = 'TRF'));
  if t is null then raise exception 'Cadastre o tipo de movimento TRF (transferência).'; end if;
  insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, transferencia_id, observacao)
  values (p_empresa, p_data, p_produto, p_origem, p_lote, t, -p_qtd, g, p_obs);
  insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, transferencia_id, observacao)
  values (p_empresa, p_data, p_produto, p_destino, p_lote, t, p_qtd, g, p_obs);
  return g;
end $$;

-- ------------------------------------------------------------ 5. fechamento
create or replace function public.est_fechar_mes(p_empresa uuid, p_mes date, p_reabrir boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_mes)::date; v_fim date;
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
  v_fim := (v_mes + interval '1 month')::date;
  insert into est_fechamentos(empresa_id, mes) values (p_empresa, v_mes) on conflict do nothing;
  -- posição do estoque no último dia do mês: é o que o inventário de fim de mês (e o Bloco H) vai usar
  delete from est_fechamento_saldos where empresa_id = p_empresa and mes = v_mes;
  insert into est_fechamento_saldos(empresa_id, mes, produto_id, local_id, lote_id, quantidade, valor)
  select p_empresa, v_mes, m.produto_id, m.local_id, m.lote_id, sum(m.quantidade), sum(m.valor)
    from est_movimentos m join est_locais l on l.id = m.local_id
   where m.empresa_id = p_empresa and m.data < v_fim and l.controla_saldo
   group by m.produto_id, m.local_id, m.lote_id
  having sum(m.quantidade) <> 0 or sum(m.valor) <> 0;
  return 'fechado';
end $$;

-- ------------------------------------------------------------ 3. segunda etapa e inventário
create or replace function public.est_inv_aprovar(p_contagem uuid, p_aprovar boolean, p_motivo text default null)
returns int language plpgsql security definer set search_path = public as $$
declare c est_inv_contagens; cfg est_inv_config; it record; v_tipo uuid; v_mov uuid; v_n int := 0; v_q numeric; v_dif numeric; v_mexeu int;
begin
  select * into c from est_inv_contagens where id = p_contagem for update;
  if c.id is null then raise exception 'Contagem não encontrada.'; end if;
  cfg := _inv_cfg(c.empresa_id);
  if not exists (select 1 from membros where empresa_id = c.empresa_id and user_id = auth.uid() and papel::text = any(cfg.papeis_aprovacao)) or not _mfa_ok(c.empresa_id) then raise exception 'Sem permissão para aprovar.'; end if;
  if c.situacao <> 'em_aprovacao' then raise exception 'Contagem não está em aprovação.'; end if;
  if p_aprovar and not cfg.aprovar_propria and exists (select 1 from est_inv_itens i where i.contagem_id = c.id
       and lower(coalesce(auth.jwt() ->> 'email', '')) = lower(coalesce(i.contado_por, '-'))) then
    raise exception 'Quem contou não aprova a própria contagem. Peça a outro aprovador ou libere em Parâmetros do inventário.';
  end if;
  if not p_aprovar then
    if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Informe o motivo.'; end if;
    update est_inv_contagens set situacao = 'aberta', decidida_por = auth.jwt() ->> 'email', decidida_em = now(), motivo = p_motivo where id = c.id;
    update est_inv_itens set situacao = 'recontar' where contagem_id = c.id and situacao = 'divergente';
    return 0;
  end if;
  -- item movimentado depois de contado: o saldo guardado na contagem já não vale. Volta para recontar (ou ajusta pela diferença, por parâmetro).
  if cfg.apos_contagem = 'recontar' then
    update est_inv_itens i set situacao = 'recontar'
     where i.contagem_id = c.id and i.situacao = 'divergente'
       and exists (select 1 from est_movimentos m where m.empresa_id = c.empresa_id and m.produto_id = i.produto_id and m.local_id = c.local_id
                     and m.lote_id is not distinct from i.lote_id and m.criado_em > i.contado_em);
    get diagnostics v_mexeu = row_count;
    if v_mexeu > 0 then
      update est_inv_contagens set situacao = 'aberta', decidida_por = auth.jwt() ->> 'email', decidida_em = now(),
             motivo = v_mexeu || ' item(ns) movimentado(s) depois da contagem: reconte antes de aprovar.' where id = c.id;
      return -v_mexeu;
    end if;
  end if;
  perform set_config('app.est_inventario', c.id::text, true);   -- os ajustes desta contagem passam pelo bloqueio de item em contagem
  for it in select * from est_inv_itens where contagem_id = c.id and situacao = 'divergente' loop
    v_q := coalesce(it.recontado, it.contado);
    v_dif := v_q - it.saldo_sistema;
    continue when v_dif = 0;
    select id into v_tipo from est_tipos_movimento where empresa_id = c.empresa_id and codigo = case when v_dif > 0 then 'AJ+' else 'AJ-' end and ativo;
    if v_tipo is null then raise exception 'Tipo de movimento % não configurado.', case when v_dif > 0 then 'AJ+' else 'AJ-' end; end if;
    insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao)
    values (c.empresa_id, current_date, it.produto_id, c.local_id, it.lote_id, v_tipo, v_dif, case when v_dif > 0 then nullif(it.custo, 0) end,
            'INV ' || c.numero, left(coalesce(it.justificativa, 'Inventário cíclico'), 200))
    returning id into v_mov;
    update est_inv_itens set situacao = 'ajustado', movimento_id = v_mov where id = it.id;
    v_n := v_n + 1;
  end loop;
  update est_inv_contagens set situacao = 'aprovada', decidida_por = auth.jwt() ->> 'email', decidida_em = now(), motivo = p_motivo where id = c.id;
  return v_n;
end $$;

create or replace function public.est_inv_gerar(p_empresa uuid, p_local uuid, p_qtd int default null, p_produtos uuid[] default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cfg est_inv_config; v_id uuid; v_num int; v_n int;
begin
  if not public.pode_estoque(p_empresa) then raise exception 'Sem permissão.'; end if;
  if not exists (select 1 from est_locais where id = p_local and empresa_id = p_empresa and ativo) then raise exception 'Local inválido.'; end if;
  if (select implantado_em from est_config where empresa_id = p_empresa) is null then raise exception 'Implante o saldo inicial do estoque antes do inventário cíclico.'; end if;
  if exists (select 1 from est_inv_contagens where empresa_id = p_empresa and local_id = p_local and situacao in ('aberta', 'em_aprovacao')) then raise exception 'Já há uma contagem aberta ou aguardando aprovação neste local.'; end if;
  cfg := _inv_cfg(p_empresa);
  select coalesce(max(numero), 0) + 1 into v_num from est_inv_contagens where empresa_id = p_empresa;
  insert into est_inv_contagens(empresa_id, numero, local_id) values (p_empresa, v_num, p_local) returning id into v_id;
  insert into est_inv_itens(empresa_id, contagem_id, produto_id, lote_id, classe)
  select p_empresa, v_id, s.produto_id, s.lote_id, coalesce(abc.classe, 'C')
    from est_saldos s left join est_inv_abc(p_empresa) abc on abc.produto_id = s.produto_id
   where s.empresa_id = p_empresa and s.local_id = p_local and s.quantidade > 0
     and (p_produtos is null or s.produto_id = any(p_produtos))
     and (p_produtos is not null or abc.ultima_contagem is null
          or abc.ultima_contagem < now() - make_interval(days => case coalesce(abc.classe, 'C') when 'A' then cfg.dias_a when 'B' then cfg.dias_b else cfg.dias_c end))
   order by case coalesce(abc.classe, 'C') when 'A' then 1 when 'B' then 2 else 3 end, abc.ultima_contagem nulls first, abc.valor desc nulls last
   limit coalesce(p_qtd, cfg.itens_por_contagem);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Nenhum item a contar neste local agora (todos dentro da frequência).'; end if;
  return v_id;
end $$;

create or replace function public._est_inv_cfg_protege() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and not is_admin(new.empresa_id)
     and (tg_op = 'INSERT' and (new.aprovar_propria or new.apos_contagem <> 'recontar')
          or tg_op = 'UPDATE' and (new.aprovar_propria is distinct from old.aprovar_propria or new.apos_contagem is distinct from old.apos_contagem
                                   or new.papeis_aprovacao is distinct from old.papeis_aprovacao)) then
    raise exception 'Quem aprova e as exceções de aprovação do inventário só o administrador altera.';
  end if;
  return new;
end $$;
revoke all on function public._est_inv_cfg_protege() from public, anon, authenticated;
drop trigger if exists est_inv_config_protege on public.est_inv_config;
create trigger est_inv_config_protege before insert or update on public.est_inv_config for each row execute function public._est_inv_cfg_protege();

create or replace function public.etq_config_salvar(p_empresa uuid, p_codigo text, p_largura int, p_altura int, p_copias int, p_fornecedor boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'diretor')) or not public._mfa_ok(p_empresa) then
    raise exception 'Só o administrador ou o diretor muda os parâmetros da etiqueta';
  end if;
  if p_codigo not in ('barras', 'qr', 'ambos') then raise exception 'Tipo de código inválido'; end if;
  if p_largura is null or p_largura < 30 or p_largura > 210 or p_altura is null or p_altura < 20 or p_altura > 297 then raise exception 'Tamanho da etiqueta fora da faixa (largura 30 a 210 mm, altura 20 a 297 mm)'; end if;
  if p_copias is null or p_copias < 1 or p_copias > 200 then raise exception 'Cópias: de 1 a 200'; end if;
  insert into etq_config (empresa_id, codigo, largura_mm, altura_mm, copias, mostrar_fornecedor)
    values (p_empresa, p_codigo, p_largura, p_altura, p_copias, coalesce(p_fornecedor, true))
  on conflict (empresa_id) do update set codigo = excluded.codigo, largura_mm = excluded.largura_mm, altura_mm = excluded.altura_mm,
    copias = excluded.copias, mostrar_fornecedor = excluded.mostrar_fornecedor, atualizado_em = now();
end $$;

create or replace function public.pode_manutencao(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'producao')) and public._mfa_ok(p_empresa);
$$;
create or replace function public.pode_qualidade(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao')) and public._mfa_ok(p_empresa);
$$;
create or replace function public.pode_tintas(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'producao')) and public._mfa_ok(p_empresa);
$$;

-- ------------------------------------------------------------ 8. lote e tipo conferem a empresa
create or replace function public._est_lote_protege() returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from produtos p where p.id = new.produto_id and p.empresa_id = new.empresa_id) then raise exception 'O produto do lote é de outra empresa.'; end if;
  if tg_op = 'INSERT' then return new; end if;
  if new.produto_id is distinct from old.produto_id or new.empresa_id is distinct from old.empresa_id then raise exception 'O produto do lote não muda: crie outro lote.'; end if;
  if current_user in ('authenticated', 'anon') then
    if new.bloqueado is distinct from old.bloqueado or new.bloqueio_motivo is distinct from old.bloqueio_motivo then raise exception 'O bloqueio e a liberação de lote são feitos pela Qualidade.'; end if;
    if new.codigo is distinct from old.codigo and not pode_editar(new.empresa_id) and exists (select 1 from est_movimentos where lote_id = old.id) then
      raise exception 'O lote já tem movimentos: o código só é corrigido por administrador ou financeiro.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists est_lotes_protege on public.est_lotes;
create trigger est_lotes_protege before insert or update on public.est_lotes for each row execute function public._est_lote_protege();

create or replace function public._est_param_protege() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'est_tipos_movimento' then
    if tg_op = 'DELETE' then
      if old.sistema and exists (select 1 from empresas where id = old.empresa_id) then raise exception 'Tipo de movimento do sistema não se exclui: desative-o.'; end if;
      return old;
    end if;
    if (new.local_origem_id is not null and not exists (select 1 from est_locais l where l.id = new.local_origem_id and l.empresa_id = new.empresa_id))
       or (new.local_destino_id is not null and not exists (select 1 from est_locais l where l.id = new.local_destino_id and l.empresa_id = new.empresa_id)) then
      raise exception 'Local padrão de outra empresa.';
    end if;
    if tg_op = 'UPDATE' and (new.sentido is distinct from old.sentido or new.afeta_custo is distinct from old.afeta_custo)
       and exists (select 1 from est_movimentos where tipo_movimento_id = old.id) then
      raise exception 'O tipo "%" já tem movimentos: sentido e "forma custo" não mudam. Crie outro tipo e desative este.', old.nome;
    end if;
  else
    if (new.compoe_custo is distinct from old.compoe_custo or new.controla_saldo is distinct from old.controla_saldo or new.posse is distinct from old.posse)
       and exists (select 1 from est_movimentos where local_id = old.id) then
      raise exception 'O local "%" já tem movimentos: posse, "compõe custo" e "controla saldo" não mudam. Crie outro local e transfira o saldo.', old.nome;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists est_tipos_protege on public.est_tipos_movimento;
create trigger est_tipos_protege before insert or update or delete on public.est_tipos_movimento for each row execute function public._est_param_protege();

-- ------------------------------------------------------------ 6. requisição: catálogo e valores
alter table public.alm_requisicoes add column if not exists motivo_detalhe text;   -- motivo da aprovação com os valores; só quem atende e quem aprova lê
create or replace function public.alm_requisitar(p_empresa uuid, p_itens jsonb, p_motivo text default null, p_colaborador uuid default null, p_para_nome text default null, p_origem text default 'pedido')
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg alm_config; k rh_colaboradores; it jsonb; p produtos; v_id uuid; v_num int; v_valor numeric := 0; v_dia numeric := 0; v_q numeric; v_cu numeric; v_ctrl text[] := '{}'; v_mot text; v_det text; v_sit text;
  v_eu text := public._alm_nome(p_empresa); v_almox boolean := public.alm_almoxarife(p_empresa);
begin
  if not public.alm_membro(p_empresa) then raise exception 'Sem acesso a esta empresa'; end if;
  if p_origem not in ('pedido', 'balcao') then raise exception 'Origem inválida'; end if;
  if jsonb_typeof(coalesce(p_itens, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Inclua pelo menos um item'; end if;
  if jsonb_array_length(p_itens) > 60 then raise exception 'Muitos itens numa requisição só (máximo 60)'; end if;
  if length(coalesce(p_motivo, '')) > 500 then raise exception 'Motivo muito longo'; end if;
  select * into cfg from alm_config where empresa_id = p_empresa;
  if p_colaborador is not null then
    select * into k from rh_colaboradores where id = p_colaborador and empresa_id = p_empresa;
    if not found then raise exception 'Colaborador não encontrado'; end if;
    if k.user_id is distinct from auth.uid() and not v_almox then raise exception 'Só quem atende o almoxarifado pede em nome de outra pessoa'; end if;
  else
    select * into k from rh_colaboradores where empresa_id = p_empresa and user_id = auth.uid();
    if not found and nullif(trim(coalesce(p_para_nome, '')), '') is not null and not v_almox then raise exception 'Só quem atende o almoxarifado pede em nome de outra pessoa'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('alm_requisicoes:' || p_empresa::text));
  select coalesce(max(numero), 0) + 1 into v_num from alm_requisicoes where empresa_id = p_empresa;
  insert into alm_requisicoes (empresa_id, numero, origem, solicitante_id, solicitante_nome, colaborador_id, para_nome, setor, centro_custo_id, motivo)
  values (p_empresa, v_num, p_origem, auth.uid(), v_eu, k.id, coalesce(k.nome, nullif(trim(coalesce(p_para_nome, '')), ''), v_eu), k.setor, k.centro_custo_id, nullif(trim(coalesce(p_motivo, '')), ''))
  returning id into v_id;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into p from produtos where id = (it ->> 'produto_id')::uuid and empresa_id = p_empresa;
    if not found then raise exception 'Item que não é desta empresa'; end if;
    -- só o que está no catálogo do almoxarifado: produto acabado e matéria-prima não se pedem por aqui
    if not (exists(select 1 from est_saldos s where s.produto_id = p.id and s.quantidade <> 0 and public._alm_local(p_empresa, s.local_id))
            or (p.local_padrao_id is not null and public._alm_local(p_empresa, p.local_padrao_id))) then
      raise exception '% não é item do almoxarifado', p.descricao;
    end if;
    v_q := (it ->> 'quantidade')::numeric;
    if v_q is null or v_q <= 0 then raise exception 'Quantidade inválida em %', p.descricao; end if;
    if exists(select 1 from alm_requisicao_itens where requisicao_id = v_id and produto_id = p.id) then raise exception 'O item % está repetido', p.descricao; end if;
    select case when c.quantidade > 0 then c.valor / c.quantidade else 0 end into v_cu from est_custos c where c.produto_id = p.id;
    v_valor := v_valor + v_q * coalesce(v_cu, 0);
    insert into alm_requisicao_itens (requisicao_id, empresa_id, produto_id, codigo, descricao, unidade, quantidade, controlado, observacao)
    values (v_id, p_empresa, p.id, p.codigo, p.descricao, p.unidade, v_q, exists(select 1 from alm_controlados where produto_id = p.id), left(nullif(trim(coalesce(it ->> 'observacao', '')), ''), 200));
    if exists(select 1 from alm_controlados where produto_id = p.id) then v_ctrl := v_ctrl || p.descricao; end if;
  end loop;
  -- o limite vale para o dia: fatiar o pedido em vários não foge da aprovação
  if cfg.valor_aprovacao is not null then
    select coalesce(sum(q.valor_estimado), 0) into v_dia from alm_requisicoes q
     where q.empresa_id = p_empresa and q.id <> v_id and q.situacao not in ('cancelada', 'recusada')
       and (q.criado_em at time zone 'America/Recife')::date = (now() at time zone 'America/Recife')::date
       and (q.solicitante_id = auth.uid() or (q.colaborador_id is not null and q.colaborador_id = (select colaborador_id from alm_requisicoes where id = v_id)));
  end if;
  -- o motivo que quem pediu enxerga não traz valores; o detalhe com os valores é só de quem atende e de quem aprova
  v_mot := nullif(concat_ws('; ',
    case when array_length(v_ctrl, 1) > 0 then 'item controlado: ' || array_to_string(v_ctrl, ', ') end,
    case when cfg.valor_aprovacao is not null and v_valor > cfg.valor_aprovacao then 'valor acima do limite'
         when cfg.valor_aprovacao is not null and v_valor + v_dia > cfg.valor_aprovacao then 'pedidos do dia acima do limite' end), '');
  v_det := nullif(concat_ws('; ',
    case when array_length(v_ctrl, 1) > 0 then 'item controlado: ' || array_to_string(v_ctrl, ', ') end,
    case when cfg.valor_aprovacao is not null and v_valor > cfg.valor_aprovacao then 'valor estimado de R$ ' || public._alm_reais(v_valor) || ' acima do limite de R$ ' || public._alm_reais(cfg.valor_aprovacao)
         when cfg.valor_aprovacao is not null and v_valor + v_dia > cfg.valor_aprovacao then 'pedidos do dia somam R$ ' || public._alm_reais(v_valor + v_dia) || ', acima do limite de R$ ' || public._alm_reais(cfg.valor_aprovacao) end), '');
  v_sit := case when v_mot is null then 'aberta' else 'aprovacao' end;
  update alm_requisicoes set situacao = v_sit, valor_estimado = round(v_valor, 2), motivo_aprovacao = v_mot, motivo_detalhe = v_det where id = v_id;
  if v_sit = 'aprovacao' then
    perform public._alm_avisar(p_empresa, 'aprovador', 'Requisição nº ' || v_num || ' aguarda aprovação', coalesce(v_eu, '') || ': ' || v_det, v_id);
  elsif p_origem = 'pedido' then
    perform public._alm_avisar(p_empresa, 'almoxarife', 'Nova requisição nº ' || v_num, coalesce(v_eu, '') || ' pediu ' || jsonb_array_length(p_itens) || ' item(ns)', v_id);
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'situacao', v_sit, 'motivo_aprovacao', v_mot);
end $$;

-- quem pediu lê a requisição e as entregas, mas não os valores (custo): leitura por coluna
do $$ declare c text; begin
  revoke select on public.alm_requisicoes, public.alm_entregas from authenticated;
  select string_agg(quote_ident(column_name), ', ') into c from information_schema.columns
   where table_schema = 'public' and table_name = 'alm_requisicoes' and column_name not in ('valor_estimado', 'motivo_detalhe');
  execute 'grant select (' || c || ') on public.alm_requisicoes to authenticated';
  select string_agg(quote_ident(column_name), ', ') into c from information_schema.columns
   where table_schema = 'public' and table_name = 'alm_entregas' and column_name <> 'valor';
  execute 'grant select (' || c || ') on public.alm_entregas to authenticated';
end $$;
comment on table public.alm_requisicoes is 'Requisição de material. Coluna nova precisa de grant select (coluna) para authenticated; valor_estimado e motivo_detalhe ficam de fora (ver alm_valores).';
comment on table public.alm_entregas is 'Entrega de requisição. Coluna nova precisa de grant select (coluna) para authenticated; valor fica de fora (ver alm_valores).';

create or replace function public.alm_valores(p_empresa uuid, p_ids uuid[])
returns table (requisicao_id uuid, valor_estimado numeric, motivo_detalhe text, entregas jsonb)
language sql stable security definer set search_path = public as $$
  select r.id, r.valor_estimado, r.motivo_detalhe,
         coalesce((select jsonb_object_agg(e.id::text, e.valor) from alm_entregas e where e.requisicao_id = r.id), '{}'::jsonb)
    from alm_requisicoes r
   where r.empresa_id = p_empresa and r.id = any(p_ids)
     and (public.alm_almoxarife(p_empresa) or public.alm_aprovador(p_empresa) or public.alm_gerencia(p_empresa));
$$;
revoke all on function public.alm_valores(uuid, uuid[]) from public, anon;
grant execute on function public.alm_valores(uuid, uuid[]) to authenticated;

-- ------------------------------------------------------------ 8. privilégios sobrando e funções novas
do $$ declare r record; begin
  for r in select c.oid::regclass t from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname ~ '^(est|alm|etq)_' loop
    execute format('revoke all on table %s from anon', r.t);                                   -- visitante sem login não toca em nada do estoque
    execute format('revoke truncate, references, trigger on table %s from authenticated', r.t);   -- o que a plataforma não usa
  end loop;
  for r in select p.oid::regprocedure f, p.prorettype = 'trigger'::regtype gat, has_function_privilege('authenticated', p.oid, 'execute') aut
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname ~ '^_?(est|alm|etq)_' or p.proname in ('pode_estoque', 'papel_em', 'pode_ver_estoque')) loop
    if r.aut and not r.gat then execute format('grant execute on function %s to authenticated', r.f); end if;
    execute format('revoke execute on function %s from public, anon', r.f);
    if r.gat then execute format('revoke execute on function %s from authenticated', r.f); end if;
  end loop;
end $$;
revoke execute on function public._est_recalc(uuid, uuid, date) from authenticated;
