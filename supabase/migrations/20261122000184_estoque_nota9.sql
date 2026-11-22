-- 184 — estoque rumo à nota 9: contagem cega de verdade, desfazer inventário aprovado, recontagem pedida pelo aprovador,
--        lote criado na contagem, trava de data por local inventariado e marcação do ajuste na própria linha
-- Aditivo: nada é apagado.

alter table public.est_ig_config add column if not exists esconder_saldo boolean not null default true;   -- quem conta ou audita não lê o saldo do local em andamento
alter table public.est_movimentos add column if not exists ig_inventario_id uuid references public.est_ig_inventarios(id);   -- ajuste (ou estorno) lançado pelo inventário geral
create index if not exists est_mov_ig on public.est_movimentos (ig_inventario_id) where ig_inventario_id is not null;
alter table public.est_ig_inventarios drop constraint if exists est_ig_inventarios_situacao_check;
alter table public.est_ig_inventarios add constraint est_ig_inventarios_situacao_check check (situacao in ('aberto', 'aprovado', 'cancelado', 'estornado'));
alter table public.est_ig_locais add column if not exists recontagens int not null default 0;

create or replace function public._ig_cfg(p_empresa uuid) returns est_ig_config language sql stable security definer set search_path = public as $$
  select coalesce((select c from est_ig_config c where c.empresa_id = p_empresa),
                  (select row(p_empresa, 100, true, true, 2, 100, 0.5, array['admin', 'diretor', 'financeiro'], false, true, now(), null, true)::est_ig_config));
$$;


create or replace function public.est_ig_config_salvar(p_empresa uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare c est_ig_config := public._ig_cfg(p_empresa); v_papeis text[];
begin
  if not is_admin(p_empresa) or not _mfa_ok(p_empresa) then raise exception 'Só o administrador altera os parâmetros do inventário geral.'; end if;
  v_papeis := coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'papeis_aprovacao') x), c.papeis_aprovacao);
  if not (v_papeis <@ array['admin', 'diretor', 'financeiro']) or cardinality(v_papeis) = 0 then raise exception 'Quem aprova: administrador, diretor ou financeiro.'; end if;
  insert into est_ig_config (empresa_id, amostra_pct, amostra_classe_a, amostra_divergentes, tolerancia_pct, tolerancia_valor, dif_auditoria_pct, papeis_aprovacao, aprovar_quem_contou, fechar_mes, esconder_saldo, atualizado_por)
  values (p_empresa, coalesce((p ->> 'amostra_pct')::numeric, c.amostra_pct), coalesce((p ->> 'amostra_classe_a')::boolean, c.amostra_classe_a), coalesce((p ->> 'amostra_divergentes')::boolean, c.amostra_divergentes),
          coalesce((p ->> 'tolerancia_pct')::numeric, c.tolerancia_pct), coalesce((p ->> 'tolerancia_valor')::numeric, c.tolerancia_valor), coalesce((p ->> 'dif_auditoria_pct')::numeric, c.dif_auditoria_pct),
          v_papeis, coalesce((p ->> 'aprovar_quem_contou')::boolean, c.aprovar_quem_contou), coalesce((p ->> 'fechar_mes')::boolean, c.fechar_mes), coalesce((p ->> 'esconder_saldo')::boolean, c.esconder_saldo), auth.uid())
  on conflict (empresa_id) do update set amostra_pct = excluded.amostra_pct, amostra_classe_a = excluded.amostra_classe_a, amostra_divergentes = excluded.amostra_divergentes,
    tolerancia_pct = excluded.tolerancia_pct, tolerancia_valor = excluded.tolerancia_valor, dif_auditoria_pct = excluded.dif_auditoria_pct, papeis_aprovacao = excluded.papeis_aprovacao,
    aprovar_quem_contou = excluded.aprovar_quem_contou, fechar_mes = excluded.fechar_mes, esconder_saldo = excluded.esconder_saldo, atualizado_em = now(), atualizado_por = auth.uid();
end $$;

-- ------------------------------------------------------------ 1. contagem cega de verdade
-- enquanto o local está em contagem, auditoria ou terceira contagem, quem conta e quem audita não leem o saldo nem os movimentos dele
create or replace function public._ig_ocultos() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(l.local_id), '{}'::uuid[]) from est_ig_locais l join est_ig_inventarios g on g.id = l.inventario_id
   where g.situacao = 'aberto' and l.situacao <> 'concluido' and auth.uid() in (l.responsavel_id, l.auditor_id) and (public._ig_cfg(g.empresa_id)).esconder_saldo;
$$;
create or replace function public._ig_produtos_ocultos() returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct i.produto_id from est_ig_itens i where i.local_id = any(public._ig_ocultos())
     and i.ig_local_id in (select l.id from est_ig_locais l join est_ig_inventarios g on g.id = l.inventario_id where g.situacao = 'aberto' and l.situacao <> 'concluido');
$$;
drop policy if exists est_saldos_ig on public.est_saldos;
create policy est_saldos_ig on public.est_saldos as restrictive for select to authenticated using (not (local_id = any((select public._ig_ocultos())::uuid[])));
drop policy if exists est_movimentos_ig on public.est_movimentos;
create policy est_movimentos_ig on public.est_movimentos as restrictive for select to authenticated using (not (local_id = any((select public._ig_ocultos())::uuid[])));
drop policy if exists est_fechamento_saldos_ig on public.est_fechamento_saldos;
create policy est_fechamento_saldos_ig on public.est_fechamento_saldos as restrictive for select to authenticated using (not (local_id = any((select public._ig_ocultos())::uuid[])));
drop policy if exists est_custos_ig on public.est_custos;   -- o total do produto entregaria o saldo de quem só tem um local
create policy est_custos_ig on public.est_custos as restrictive for select to authenticated using (produto_id not in (select public._ig_produtos_ocultos()));


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
         case v_papel when 'contador' then i.contado is not null when 'auditor' then i.auditado is not null else i.situacao = 'resolvido' end,
         i.incluido,
         case when v_papel = 'terceira' and i.situacao = 'divergente' and i.terceira is not null then (case when i.terceira_por = auth.uid() then 'aguarda_outro' else 'confirmar' end) when v_papel = 'contador' then (case when i.contado is null then 'pendente' else 'contado' end) else i.situacao end, v_papel,
         case when v_papel = 'terceira' then i.contado end, case when v_papel = 'terceira' then i.auditado end   -- na terceira contagem os dois veem as duas quantidades
    from est_ig_itens i join produtos p on p.id = i.produto_id left join est_lotes lt on lt.id = i.lote_id
   where i.ig_local_id = p_ig_local
     and (v_papel = 'contador' or (v_papel = 'auditor' and i.na_amostra) or (v_papel = 'terceira' and i.situacao in ('divergente', 'resolvido') and i.na_amostra))
   order by p.descricao, lt.codigo;
end $$;

-- ------------------------------------------------------------ 2. congelamento, ajuste marcado na linha e trava de data do local inventariado
create or replace function public._est_mov_ig() returns trigger language plpgsql set search_path = public as $$
declare v record;
begin
  if new.ig_inventario_id is not null then   -- ajuste ou estorno do próprio inventário: só a plataforma lança
    if current_user in ('authenticated', 'anon') then raise exception 'Movimento de inventário geral é lançado pela plataforma, na aprovação.'; end if;
    return new;
  end if;
  select g.numero, g.referencia, l.situacao into v from est_ig_locais l join est_ig_inventarios g on g.id = l.inventario_id
   where l.local_id = new.local_id and g.situacao = 'aberto' limit 1;
  if found then
    if v.situacao <> 'concluido' then
      raise exception 'Local congelado pelo inventário geral nº %: movimente depois que a contagem e a auditoria deste local terminarem.', v.numero;
    end if;
    if new.data <= v.referencia then
      raise exception 'O inventário geral nº % ainda não foi aprovado: movimento com data até % só depois da aprovação.', v.numero, to_char(v.referencia, 'DD/MM/YYYY');
    end if;
  end if;
  -- local já inventariado: o saldo da data de referência é o inventário, com o mês fechado ou não
  select g.numero, g.referencia into v from est_ig_locais l join est_ig_inventarios g on g.id = l.inventario_id
   where l.local_id = new.local_id and g.situacao = 'aprovado' and g.referencia >= new.data order by g.referencia desc limit 1;
  if found then
    raise exception 'Este local foi inventariado em % (inventário geral nº %): movimento com data até essa data não é aceito.', to_char(v.referencia, 'DD/MM/YYYY'), v.numero;
  end if;
  return new;
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
  if not cfg.aprovar_quem_contou and exists (select 1 from est_ig_itens where inventario_id = g.id and auth.uid() in (contado_por, auditado_por, terceira_por, terceira_conf_por)) then
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
  -- primeiro as sobras, depois as faltas: assim nenhuma falta esbarra em saldo que a sobra de outro lote vai repor
  for it in select i.* from est_ig_itens i where i.inventario_id = g.id and i.final is distinct from i.saldo_ref order by (i.final - i.saldo_ref) desc loop
    v_dif := it.final - it.saldo_ref;
    -- a sobra entra pelo custo médio do produto; produto que ainda não tem custo médio (nunca teve estoque) entra como saldo inicial, pelo custo do inventário
    v_tipo := case when v_dif <= 0 then v_ajn
                   when g.implantacao or coalesce((select c.custo_medio from est_custos c where c.produto_id = it.produto_id), 0) = 0 then v_si else v_ajm end;
    begin
      insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, ig_inventario_id, documento, observacao)
      values (g.empresa_id, g.referencia, it.produto_id, it.local_id, it.lote_id, v_tipo, v_dif, case when v_tipo = v_si then it.custo end, g.id,
              'IG ' || g.numero, left(coalesce(it.justificativa, case when g.implantacao then 'Implantação pelo inventário geral' else 'Inventário geral' end), 200))
      returning id into v_mov;
    exception when others then   -- diz qual item não coube, em vez de devolver só o erro do lançamento
      raise exception 'Item % em %: %', (select codigo from produtos where id = it.produto_id), (select nome from est_locais where id = it.local_id), sqlerrm;
    end;
    update est_ig_itens set movimento_id = v_mov where id = it.id;
    v_n := v_n + 1;
  end loop;
  -- recalcula já os produtos ajustados, desde a referência: o ajuste sai pelo custo da data, e o fechamento guarda esse valor
  for it in select distinct i.produto_id from est_ig_itens i where i.inventario_id = g.id and i.movimento_id is not null loop
    perform public._est_recalc(g.empresa_id, it.produto_id, g.referencia);
  end loop;
  select coalesce(sum(m.valor), 0) into v_valor from est_ig_itens i join est_movimentos m on m.id = i.movimento_id where i.inventario_id = g.id;
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

drop function if exists public.g_ig_meu(uuid);

-- ------------------------------------------------------------ 3. desfazer um inventário aprovado
-- só o administrador, só o último inventário aprovado e sem outro aberto: estorna cada ajuste na data de referência e reabre o mês que o inventário fechou
create or replace function public.est_ig_estornar(p_inventario uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g est_ig_inventarios; m record; v_n int := 0; v_mes date; v_reabriu boolean := false; p record;
begin
  select * into g from est_ig_inventarios where id = p_inventario for update;
  if not found then raise exception 'Inventário não encontrado.'; end if;
  if not is_admin(g.empresa_id) or not _mfa_ok(g.empresa_id) then raise exception 'Só o administrador desfaz um inventário aprovado.'; end if;
  if g.situacao <> 'aprovado' then raise exception 'Só um inventário aprovado pode ser desfeito.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 10 then raise exception 'Informe o motivo (pelo menos 10 letras).'; end if;
  if exists (select 1 from est_ig_inventarios where empresa_id = g.empresa_id and situacao = 'aberto') then raise exception 'Há um inventário geral aberto: conclua ou cancele antes.'; end if;
  if exists (select 1 from est_ig_inventarios where empresa_id = g.empresa_id and situacao = 'aprovado' and numero > g.numero) then raise exception 'Só o último inventário aprovado pode ser desfeito.'; end if;
  perform pg_advisory_xact_lock(hashtext('est_fech:' || g.empresa_id::text));
  v_mes := date_trunc('month', g.referencia)::date;
  if exists (select 1 from est_fechamentos where empresa_id = g.empresa_id and mes >= v_mes) then
    delete from est_fechamentos where empresa_id = g.empresa_id and mes >= v_mes;
    delete from est_fechamento_saldos where empresa_id = g.empresa_id and mes >= v_mes;
    v_reabriu := true;
  end if;
  -- primeiro devolve as faltas (entradas), depois retira as sobras: nenhuma retirada esbarra em saldo que a devolução repõe
  for m in select mv.*, i.id item_id from est_ig_itens i join est_movimentos mv on mv.id = i.movimento_id where i.inventario_id = g.id order by mv.quantidade asc loop
    begin
      insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, estorno_de, ig_inventario_id, documento, observacao)
      values (m.empresa_id, g.referencia, m.produto_id, m.local_id, m.lote_id, m.tipo_movimento_id, -m.quantidade, m.custo_unitario, m.id, g.id, 'IG ' || g.numero, 'Estorno do inventário: ' || left(trim(p_motivo), 170));
    exception when others then
      raise exception 'Item % em %: %', (select codigo from produtos where id = m.produto_id), (select nome from est_locais where id = m.local_id), sqlerrm;
    end;
    v_n := v_n + 1;
  end loop;
  for p in select distinct i.produto_id from est_ig_itens i where i.inventario_id = g.id and i.movimento_id is not null loop
    perform public._est_recalc(g.empresa_id, p.produto_id, g.referencia);
  end loop;
  if g.implantacao then update est_config set implantado_em = null where empresa_id = g.empresa_id and implantado_em = g.referencia; end if;
  update est_ig_inventarios set situacao = 'estornado', motivo = left(trim(p_motivo), 300), decidido_por = auth.uid(), decidido_nome = public._ig_nome(g.empresa_id, auth.uid()), decidido_em = now() where id = g.id;
  return jsonb_build_object('estornos', v_n, 'mes_reaberto', v_reabriu);
end $$;

-- ------------------------------------------------------------ 4. recontagem pedida por quem gerencia ou aprova (sem cancelar o inventário)
-- os itens voltam para a terceira contagem, feita e confirmada pelos dois; local sem auditor volta para a contagem
create or replace function public.est_ig_recontar(p_ig_local uuid, p_itens uuid[], p_motivo text)
returns text language plpgsql security definer set search_path = public as $$
declare gl est_ig_locais; v_n int;
begin
  gl := public._ig_local_aberto(p_ig_local);
  if not (public.est_ig_gerencia(gl.empresa_id) or public._ig_aprova(gl.empresa_id)) then raise exception 'Só quem gerencia ou aprova o inventário pede recontagem.'; end if;
  if auth.uid() in (gl.responsavel_id, gl.auditor_id) then raise exception 'Quem conta ou audita o local não pede a recontagem dele.'; end if;
  if gl.situacao <> 'concluido' then raise exception 'A recontagem é pedida depois que o local termina.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo da recontagem.'; end if;
  if p_itens is null or cardinality(p_itens) = 0 then raise exception 'Escolha os itens.'; end if;
  select count(*) into v_n from est_ig_itens where ig_local_id = gl.id and id = any(p_itens);
  if v_n <> cardinality(p_itens) then raise exception 'Há item que não é deste local.'; end if;
  if gl.auditor_id is null then
    update est_ig_itens set contado = null, contado_por = null, contado_em = null, final = null, situacao = 'pendente', justificativa = left('Recontagem: ' || trim(p_motivo), 300) where id = any(p_itens);
    update est_ig_locais set situacao = 'contando', concluido_em = null, recontagens = recontagens + 1 where id = gl.id;
  else
    update est_ig_itens set terceira = null, terceira_por = null, terceira_em = null, terceira_conf_por = null, terceira_conf_em = null, final = null, na_amostra = true, situacao = 'divergente',
           justificativa = left('Recontagem: ' || trim(p_motivo), 300) where id = any(p_itens);
    update est_ig_locais set situacao = 'terceira', concluido_em = null, recontagens = recontagens + 1 where id = gl.id;
  end if;
  begin
    perform _notificar_u(gl.empresa_id, array_remove(array[gl.responsavel_id, gl.auditor_id], null), 'inventario', 'Inventário geral: recontar ' || v_n || ' item(ns) em ' || (select nome from est_locais where id = gl.local_id),
      left(trim(p_motivo), 200), '#/estoque/inventario-geral?i=' || gl.inventario_id, gl.inventario_id, true);
  exception when others then null; end;
  return (select situacao from est_ig_locais where id = gl.id);
end $$;

-- ------------------------------------------------------------ 5. lote criado na própria contagem (implantação de item com lote ainda sem etiqueta)
create or replace function public.est_ig_incluir_lote(p_ig_local uuid, p_produto uuid, p_codigo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare gl est_ig_locais; v_cod text := upper(left(trim(coalesce(p_codigo, '')), 40)); v_lote uuid;
begin
  gl := public._ig_local_aberto(p_ig_local);
  if gl.situacao <> 'contando' or auth.uid() <> gl.responsavel_id then raise exception 'Só quem conta o local inclui item, e só durante a contagem.'; end if;
  if not exists (select 1 from produtos where id = p_produto and empresa_id = gl.empresa_id and coalesce(controla_lote, false)) then raise exception 'Produto não encontrado, ou que não controla lote.'; end if;
  if length(v_cod) < 2 then raise exception 'Informe o código do lote (o que está escrito na embalagem).'; end if;
  select id into v_lote from est_lotes where empresa_id = gl.empresa_id and produto_id = p_produto and upper(codigo) = v_cod;
  if v_lote is null then
    insert into est_lotes (empresa_id, produto_id, codigo, origem) values (gl.empresa_id, p_produto, v_cod, 'inventario') returning id into v_lote;
  end if;
  return public.est_ig_incluir(p_ig_local, p_produto, v_lote);
end $$;

-- ------------------------------------------------------------ 6. concessões
-- saldo, custo e fechamento só são gravados pela plataforma; o Kardex não se altera nem se apaga
revoke insert, update, delete on public.est_saldos, public.est_custos, public.est_fechamentos, public.est_fechamento_saldos from authenticated, anon;
revoke update, delete on public.est_movimentos from authenticated, anon;
do $$ declare r record; begin
  for r in select p.oid::regprocedure f, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname ~ '^_?(est_ig|ig)_' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    if r.proname ~ '^est_ig_' or r.proname in ('_ig_ocultos', '_ig_produtos_ocultos') then execute format('grant execute on function %s to authenticated', r.f); end if;
  end loop;
end $$;
