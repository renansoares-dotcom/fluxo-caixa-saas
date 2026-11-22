-- 181 — estoque, etapa B4: achados da quarta avaliação (reproduzidos pelo avaliador no padrão de empresa nova)
--  1. _custo_unit e toda função que lê o estoque deixam de ser executáveis por visitante sem login; _custo_unit fica só para a plataforma.
--  2. Estorno de entrada já consumida em parte sai ao custo médio corrente: valor do estoque e custo médio nunca ficam negativos.
--  3. Bloqueio do item em contagem vale para todo movimento (transferência, requisição, nota, estorno), não só para o lançamento direto.
--  4. Um movimento por vez em cada produto desde as conferências (corrida na saída com data antiga).
--  5. Transferência: a segunda perna usa o custo da primeira.
--  6. Toda entrada à mão exige documento; tipos de movimento: criação e campos sensíveis só pelo administrador.
--  7. Inventário: quem contou é guardado por usuário (todos os que contaram), não só pelo e-mail do último.
--  8. Almoxarifado: sem parâmetros definidos não se entrega; quem entrega não retira para si mesmo; pendência de nota com trilha.
-- Aditivo: nada é apagado.

-- ------------------------------------------------------------ 2 e 5. motor do Kardex
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
    new.custo_unitario := coalesce(case when new.estorno_de is not null then new.custo_unitario end,
      -- a segunda perna da transferência usa o custo da primeira: transferir não muda o valor do produto nem em um centavo
      case when new.transferencia_id is not null then (select t.custo_unitario from est_movimentos t where t.transferencia_id = new.transferencia_id and t.produto_id = new.produto_id limit 1) end,
      v_cm);
    -- estorno de uma entrada já consumida em parte a outro custo: sai ao custo médio de agora, para o valor do estoque nunca ficar negativo
    if new.estorno_de is not null and new.quantidade < 0 and loc.compoe_custo and c.quantidade > 0 and c.valor + round(new.quantidade * new.custo_unitario, 2) < -0.005 then
      new.custo_unitario := v_cm;
    end if;
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
      if m.quantidade < 0 and m.compoe_custo and q > 0 and v + round(m.quantidade * cu, 2) < -0.005 then cu := v / q; end if;   -- mesma regra do lançamento: o valor não fica negativo
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

-- ------------------------------------------------------------ 3, 4 e 6. guarda
create or replace function public._est_mov_guarda() returns trigger language plpgsql set search_path = public as $$
declare tm record; v_papel text; cfg record; v_cm numeric; v_inv int; v_base numeric; v_min numeric;
begin
  -- quem lança espera o fechamento em andamento terminar (e o fechamento espera os lançamentos em andamento): a posição guardada bate com o Kardex
  perform pg_advisory_xact_lock_shared(hashtext('est_fech:' || new.empresa_id::text));
  -- um movimento por vez em cada produto, já a partir das conferências abaixo (antes, duas saídas com data antiga ao mesmo tempo passavam juntas)
  perform pg_advisory_xact_lock(hashtext('est_prod:' || new.produto_id::text));
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
     and not (current_user not in ('authenticated', 'anon') and g.id::text = coalesce(current_setting('app.est_inventario', true), '')) limit 1;
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
  -- toda entrada lançada à mão traz o documento que a justifica (nota, ordem, inventário), forme custo ou não
  if tm.sentido = 'E' and new.quantidade > 0 and cfg.doc and tm.documento <> 'nenhum' and nullif(trim(coalesce(new.documento, '')), '') is null then
    raise exception 'Informe o documento (nota, ordem ou inventário) da entrada "%".', tm.nome;
  end if;
  if tm.sentido = 'E' and tm.afeta_custo then
    if new.quantidade > 0 and (new.custo_unitario is null or new.custo_unitario < 0) then raise exception 'Informe o custo unitário: "%" forma o custo médio.', tm.nome; end if;
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

create or replace function public._est_param_protege() returns trigger language plpgsql set search_path = public as $$
declare v_adm boolean;
begin
  if tg_table_name = 'est_tipos_movimento' then
    if tg_op = 'DELETE' then
      if old.sistema and exists (select 1 from empresas where id = old.empresa_id) then raise exception 'Tipo de movimento do sistema não se exclui: desative-o.'; end if;
      return old;
    end if;
    v_adm := current_user not in ('authenticated', 'anon') or is_admin(new.empresa_id);
    if tg_op = 'INSERT' and not v_adm then raise exception 'Só o administrador cria tipo de movimento.'; end if;
    if tg_op = 'UPDATE' and not v_adm and (new.papeis_manual is distinct from old.papeis_manual or new.afeta_custo is distinct from old.afeta_custo
        or new.documento is distinct from old.documento or new.sentido is distinct from old.sentido or new.sistema is distinct from old.sistema) then
      raise exception 'Sentido, "forma custo", documento e quem lança à mão só o administrador altera.';
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

-- ------------------------------------------------------------ 7. inventário: quem contou, por usuário
alter table public.est_inv_itens add column if not exists contadores uuid[] not null default '{}';   -- todos os usuários que contaram ou recontaram o item
create or replace function public.est_inv_contar(p_item uuid, p_qtd numeric, p_justificativa text default null)
returns text language plpgsql security definer set search_path = public as $$
declare it est_inv_itens; c est_inv_contagens; cfg est_inv_config; v_sis numeric; v_custo numeric; v_dif numeric; v_q numeric; v_sit text;
begin
  select * into it from est_inv_itens where id = p_item;
  select * into c from est_inv_contagens where id = it.contagem_id;
  if c.id is null or not public.pode_estoque(c.empresa_id) then raise exception 'Sem permissão.'; end if;
  if c.situacao <> 'aberta' then raise exception 'Contagem % não está aberta.', c.numero; end if;
  if p_qtd is null or p_qtd < 0 then raise exception 'Quantidade inválida.'; end if;
  cfg := _inv_cfg(c.empresa_id);
  select coalesce(sum(quantidade), 0) into v_sis from est_saldos where produto_id = it.produto_id and local_id = c.local_id and lote_id is not distinct from it.lote_id;
  select coalesce(custo_medio, 0) into v_custo from est_custos where produto_id = it.produto_id;
  if it.situacao = 'recontar' then v_q := p_qtd; else v_q := p_qtd; end if;
  v_dif := v_q - v_sis;
  v_sit := case when abs(v_dif) <= greatest(abs(v_sis) * cfg.tolerancia_pct / 100, 0) and abs(v_dif * coalesce(v_custo, 0)) <= cfg.tolerancia_valor then 'ok'
                when it.situacao = 'pendente' and cfg.recontar then 'recontar'
                else 'divergente' end;
  update est_inv_itens set saldo_sistema = v_sis, custo = v_custo,
         contado = case when it.situacao = 'recontar' then contado else p_qtd end,
         recontado = case when it.situacao = 'recontar' then p_qtd else recontado end,
         contado_por = auth.jwt() ->> 'email', contado_em = now(), situacao = v_sit,
         contadores = case when auth.uid() is null or auth.uid() = any(contadores) then contadores else contadores || auth.uid() end,
         justificativa = coalesce(nullif(trim(p_justificativa), ''), justificativa)
   where id = p_item;
  return v_sit;
end $$;

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
       and (auth.uid() = any(i.contadores) or lower(coalesce(auth.jwt() ->> 'email', '')) = lower(coalesce(i.contado_por, '-')))) then
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

-- ------------------------------------------------------------ 8. almoxarifado e pendências
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
  if not found then raise exception 'Defina os parâmetros do almoxarifado antes da primeira entrega (quem atende, quem aprova, valor que pede aprovação e crachá), em Requisição de Material › Parâmetros.'; end if;
  -- quem entrega não retira para si mesmo, a não ser que a exceção de aprovar o próprio pedido esteja ligada
  if p_retirou is not null and not coalesce(cfg.aprovar_proprio, false)
     and exists (select 1 from rh_colaboradores k2 where k2.id = p_retirou and k2.user_id = auth.uid()) then
    raise exception 'Quem entrega não retira para si mesmo: peça a outra pessoa do almoxarifado para registrar a entrega.';
  end if;
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

drop trigger if exists zz_auditoria on public.est_pendencias;
create trigger zz_auditoria after update or delete on public.est_pendencias for each row execute function public._auditar();

-- ------------------------------------------------------------ 1. nada que lê o estoque para visitante sem login
do $$ declare r record; begin
  for r in select p.oid::regprocedure f, p.prorettype = 'trigger'::regtype gat, has_function_privilege('authenticated', p.oid, 'execute') aut
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and (p.proname ~ '^_?(est|alm|etq)_' or p.proname in ('pode_estoque', 'papel_em', 'pode_ver_estoque', '_custo_unit')
                   or p.prosrc ~ '\m(est_custos|est_saldos|est_movimentos|est_fechamento_saldos|produto_fornecedores)\M') loop
    if r.aut and not r.gat then execute format('grant execute on function %s to authenticated', r.f); end if;   -- quem já usava logado continua usando
    execute format('revoke execute on function %s from public, anon', r.f);
  end loop;
end $$;
-- funções internas: só a plataforma chama (por dentro das outras funções)
revoke execute on function public._custo_unit(uuid) from authenticated;
revoke execute on function public._est_recalc(uuid, uuid, date) from authenticated;
do $$ declare r record; begin
  for r in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prorettype = 'trigger'::regtype and p.proname ~ '^_?(est|alm|etq)_' loop
    execute format('revoke execute on function %s from authenticated', r.f);
  end loop;
end $$;
