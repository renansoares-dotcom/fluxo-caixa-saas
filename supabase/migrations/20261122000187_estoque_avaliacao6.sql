-- 187 — correções da 6ª avaliação do estoque
--   1. Contagem cega: as consultas privilegiadas que devolvem saldo, valor ou custo também escondem os itens do local em contagem
--      de quem conta ou audita (reposição, curva ABC, catálogo e saldos do almoxarifado, peças da manutenção); as consultas
--      agregadas (implantação, prontidão da produção, rastreio, previsão de tintas) ficam indisponíveis para essa pessoa durante a contagem.
--   2. Conferência cega do recebimento: durante a conferência, a nota e os itens dela ficam fora do alcance de quem confere.
--   3. A mesma linha de nota não entra duas vezes no estoque (trava por item).
--   4. Recebimento: a chegada respeita mês fechado, limite de dias para trás e local congelado; se o lançamento não couber, nada é gravado.
--   5. Recebimento: o que chega a mais que a nota não entra no estoque (fica a divergência para Compras).
--   6. Recontagem do inventário barrada depois que o local voltou a movimentar.
--   7. Devolução ao almoxarifado acompanha, no recálculo, o custo recalculado da saída.
--   8. Código de tipo de movimento do sistema não muda.
--   9. Desfazer o inventário informa os meses reabertos. Fila do recebimento sem notas que já entraram pela emissão.
-- Aditivo: nada é apagado.


-- ------------------------------------------------------------ 1. contagem cega nas consultas privilegiadas
create or replace function public._ig_contando() returns boolean language sql stable security definer set search_path = public as $$
  select cardinality(public._ig_ocultos()) > 0;
$$;
grant execute on function public._ig_contando() to authenticated;
do $$
declare r record; v_args text; v_res text; v_names text; v_call text; v_base text;
begin
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('alm_catalogo', 'alm_saldos', 'est_inv_abc', 'est_reposicao', 'man_pecas_situacao',
                                                         'est_implantacao_situacao', 'prod_prontidao', 'prod_rastrear', 'tin_previsao') loop
    v_base := '_' || r.proname || '_base';
    if exists (select 1 from pg_proc p2 join pg_namespace n2 on n2.oid = p2.pronamespace where n2.nspname = 'public' and p2.proname = v_base) then continue; end if;
    v_args := pg_get_function_arguments(r.oid);
    v_res := pg_get_function_result(r.oid);
    select string_agg(format('%1$I => %1$I', a), ', ') into v_names from unnest((select proargnames from pg_proc where oid = r.oid)) a
     where a is not null and a <> '' and a not in (select unnest(proargnames[pronargs + 1:]) from pg_proc where oid = r.oid);
    v_call := format('public.%I(%s)', v_base, coalesce(v_names, ''));
    execute format('alter function public.%I(%s) rename to %I', r.proname, pg_get_function_identity_arguments(r.oid), v_base);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', v_base, pg_get_function_identity_arguments(r.oid));
    if v_res like 'TABLE(produto_id%' or v_res like 'TABLE(id uuid, produto_id%' then
      -- consulta por produto: some a linha do item que a pessoa está contando ou auditando
      execute format('create function public.%I(%s) returns %s language sql stable security definer set search_path = public as $f$ select b.* from %s b where b.produto_id not in (select public._ig_produtos_ocultos()) $f$',
                     r.proname, v_args, v_res, v_call);
    elsif v_res like 'TABLE(%' then
      execute format('create function public.%I(%s) returns %s language plpgsql stable security definer set search_path = public as $f$ begin if public._ig_contando() then raise exception %L; end if; return query select * from %s; end $f$',
                     r.proname, v_args, v_res, 'Durante a contagem do inventário geral, esta consulta fica indisponível para quem conta ou audita.', v_call);
    else
      execute format('create function public.%I(%s) returns %s language plpgsql stable security definer set search_path = public as $f$ begin if public._ig_contando() then raise exception %L; end if; return %s; end $f$',
                     r.proname, v_args, v_res, 'Durante a contagem do inventário geral, esta consulta fica indisponível para quem conta ou audita.', v_call);
    end if;
    execute format('revoke all on function public.%I(%s) from public, anon', r.proname, pg_get_function_identity_arguments(r.oid));
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, pg_get_function_identity_arguments(r.oid));
  end loop;
end $$;

-- ------------------------------------------------------------ 2. conferência cega do recebimento
create or replace function public._receb_notas_ocultas() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(r.nota_id), '{}'::uuid[]) from est_recebimentos r join est_config c on c.empresa_id = r.empresa_id
   where r.situacao = 'conferindo' and c.receb_cega and public._est_receb_pode(r.empresa_id);
$$;
grant execute on function public._receb_notas_ocultas() to authenticated;
drop policy if exists nfe_notas_receb_cega on public.nfe_notas;
create policy nfe_notas_receb_cega on public.nfe_notas as restrictive for select to authenticated using (not (id = any((select public._receb_notas_ocultas())::uuid[])));
drop policy if exists nfe_itens_receb_cega on public.nfe_itens;
create policy nfe_itens_receb_cega on public.nfe_itens as restrictive for select to authenticated using (not (nota_id = any((select public._receb_notas_ocultas())::uuid[])));

-- cabeçalho da conferência (a nota fica escondida de quem confere, então o cabeçalho vem por aqui)
create or replace function public.est_receb_nota(p_receb uuid)
returns table (numero int, serie text, emit_nome text, emissao date) language plpgsql stable security definer set search_path = public as $$
declare r est_recebimentos;
begin
  select * into r from est_recebimentos where id = p_receb;
  if not found or not (public._est_receb_pode(r.empresa_id) or public._est_receb_ve_nota(r.empresa_id)) then raise exception 'Sem acesso ao recebimento.'; end if;
  return query select n.numero, n.serie::text, n.emit_nome::text, n.emissao from nfe_notas n where n.id = r.nota_id;
end $$;

create or replace function public.compras_notas_candidatas(p_pedido uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p compras_pedidos; doc text;
begin
  select * into p from compras_pedidos where id = p_pedido;
  if p.id is null or not pode_comprar(p.empresa_id) then raise exception 'Sem acesso a este pedido.'; end if;
  select regexp_replace(coalesce(documento, ''), '\D', '', 'g') into doc from favorecidos where id = p.favorecido_id;
  return coalesce((select jsonb_agg(x order by x->>'emissao' desc) from (
    select jsonb_build_object('id', n.id, 'emit_doc', n.emit_doc, 'numero', n.numero, 'serie', n.serie, 'emissao', n.emissao, 'emit_nome', n.emit_nome, 'v_nf', n.v_nf,
      'mesmo_fornecedor', (n.favorecido_id = p.favorecido_id or (doc <> '' and n.emit_doc = doc)),
      'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'cprod', i.cprod, 'n_item', i.n_item, 'xprod', i.xprod, 'ucom', i.ucom, 'qcom', i.qcom, 'vuncom', i.vuncom, 'vprod', i.vprod, 'ncm', i.ncm) order by i.n_item)
                         from nfe_itens i where i.nota_id = n.id), '[]'::jsonb),
      'parcelas', coalesce((select jsonb_agg(jsonb_build_object('id', pa.id, 'numero', pa.numero, 'vencimento', pa.vencimento, 'valor', pa.valor,
                         'vinculada', exists(select 1 from nfe_vinculos v where v.parcela_id = pa.id or (v.nota_id = n.id and v.parcela_id is null))) order by pa.numero)
                         from nfe_parcelas pa where pa.nota_id = n.id), '[]'::jsonb),
      'ja_recebida', exists(select 1 from compras_recebimentos r where r.nfe_nota_id = n.id)) x
    from nfe_notas n
    where n.empresa_id = p.empresa_id and n.tipo = 'entrada' and not n.emissao_propria and n.situacao = 'autorizada'
      and not (n.id = any(public._receb_notas_ocultas()))   -- nota em conferência cega: fora do alcance de quem confere
      and n.emissao >= p.data_pedido - 30
      and (n.favorecido_id = p.favorecido_id or (doc <> '' and n.emit_doc = doc))
  ) s), '[]'::jsonb);
end $$;
create or replace function public.est_receb_fila(p_empresa uuid)
returns table (nota_id uuid, numero int, serie text, emit_nome text, emit_doc text, emissao date, v_nf numeric, itens int, recebimento_id uuid, situacao text, conferente_nome text, contados int, dias int)
language plpgsql stable security definer set search_path = public as $$
declare c est_config;
begin
  if not (public._est_receb_pode(p_empresa) or public._est_receb_ve_nota(p_empresa)) then raise exception 'Sem acesso ao recebimento.'; end if;
  select * into c from est_config where empresa_id = p_empresa;
  if c.entrada_por is distinct from 'recebimento' or c.receb_desde is null then return; end if;
  return query
  select n.id, n.numero, n.serie::text, n.emit_nome::text, n.emit_doc::text, n.emissao, case when public._est_receb_ve_nota(p_empresa) and not public._est_receb_pode(p_empresa) then n.v_nf end,
         (select count(*)::int from nfe_itens i where i.nota_id = n.id), r.id, coalesce(r.situacao, 'a_receber'), r.conferente_nome,
         (select count(*)::int from est_recebimento_itens ri where ri.recebimento_id = r.id and ri.contada is not null), (current_date - n.emissao)::int
    from nfe_notas n left join est_recebimentos r on r.nota_id = n.id and r.situacao <> 'cancelado'
   where n.empresa_id = p_empresa and n.tipo = 'entrada' and not n.emissao_propria and n.situacao = 'autorizada' and coalesce(n.finalidade, '1') not in ('2', '3')
     and n.emissao >= c.receb_desde and (r.id is null or r.situacao = 'conferindo')
     and (r.id is not null or not exists (select 1 from est_movimentos m where m.nota_id = n.id))   -- já entrou pela emissão: não é para conferir
   order by n.emissao, n.numero;
end $$;
create or replace function public._est_item(p_item uuid) returns text
language plpgsql security definer set search_path = public as $$
declare i nfe_itens; n nfe_notas; pr produtos; v_fator numeric := 1; reg est_regras_cfop; tm est_tipos_movimento; v_sent text; v_cfop text;
        v_loc uuid; v_qtd numeric; v_cu numeric; ep estoque_parametros; v_lote uuid; v_resta numeric; l record; v_tira numeric; v_doc text; v_pid uuid;
        v_data date; v_qtd_nota numeric; v_ri record;
begin
  perform pg_advisory_xact_lock(hashtext('nfe_item:' || p_item::text));   -- duas chamadas ao mesmo tempo não lançam a mesma linha duas vezes
  select * into i from nfe_itens where id = p_item;
  select * into n from nfe_notas where id = i.nota_id;
  if n.situacao <> 'autorizada' or coalesce(n.finalidade, '1') in ('2', '3') or coalesce(i.qcom, 0) <= 0 then return 'fora'; end if;
  if exists (select 1 from est_movimentos m where m.nfe_item_id = i.id and m.estorno_de is null
              and not exists (select 1 from est_movimentos e where e.estorno_de = m.id)) then return 'ja'; end if;
  if exists (select 1 from est_pendencias where nfe_item_id = i.id and status = 'ignorada') then return 'fora'; end if;
  -- conferido e não chegou nada em bom estado: não entra e não pendura (nem por falta de de-para)
  if n.tipo = 'entrada' and not n.emissao_propria and public._est_receb_ativo(n.empresa_id, n.emissao)
     and exists (select 1 from est_recebimento_itens ri join est_recebimentos r on r.id = ri.recebimento_id where ri.nfe_item_id = i.id and r.situacao = 'conferido' and coalesce(ri.qtd_entra, 0) <= 0) then
    update est_pendencias set status = 'resolvida', resolvido_em = now() where nfe_item_id = i.id and status = 'aberta';
    return 'nao_chegou';
  end if;
  v_sent := n.tipo;
  v_cfop := regexp_replace(coalesce(i.cfop, ''), '\D', '', 'g');
  if not n.emissao_propria and v_sent = 'entrada' and left(v_cfop, 1) in ('5','6','7') then
    v_cfop := translate(left(v_cfop, 1), '567', '123') || substr(v_cfop, 2);
  end if;
  -- produto
  if not n.emissao_propria then
    select pf.produto_id, pf.fator into v_pid, v_fator from produto_fornecedores pf
     where pf.empresa_id = n.empresa_id and pf.emit_doc = n.emit_doc and pf.codigo_fornecedor = i.cprod limit 1;
    if v_pid is not null then select * into pr from produtos where id = v_pid; end if;
  else
    select * into pr from produtos where empresa_id = n.empresa_id and codigo = i.cprod;
  end if;
  -- regra antes do produto: CFOP que não movimenta não precisa de cadastro
  reg := _est_regra(n.empresa_id, v_cfop, v_sent, pr.familia_id, pr.tipo_sped);
  if reg.id is not null and reg.tipo_movimento_id is null then
    update est_pendencias set status = 'resolvida', resolvido_em = now() where nfe_item_id = i.id and status = 'aberta';
    return 'nao_movimenta';
  end if;
  if pr.id is null then
    return _est_pendencia(i, 'sem_produto', case when n.emissao_propria then 'Código ' || coalesce(i.cprod, '?') || ' sem cadastro em Produtos'
      else 'Item ' || coalesce(i.cprod, '?') || ' de ' || coalesce(n.emit_nome, n.emit_doc) || ' sem de-para' end);
  end if;
  if reg.id is null then return _est_pendencia(i, 'sem_regra', 'Sem regra para o CFOP ' || v_cfop || ' (' || v_sent || ')'); end if;
  select * into tm from est_tipos_movimento where id = reg.tipo_movimento_id;
  v_loc := coalesce(reg.local_id, case when tm.sentido = 'S' then tm.local_origem_id else tm.local_destino_id end, pr.local_padrao_id);
  if v_loc is null then return _est_pendencia(i, 'sem_local', 'Produto ' || pr.codigo || ' sem local padrão e regra sem local'); end if;
  v_qtd := round(i.qcom * coalesce(v_fator, 1), 4);
  v_doc := 'NF ' || n.numero || coalesce(' · ' || nullif(n.emit_nome, ''), '');
  v_data := n.emissao; v_qtd_nota := v_qtd;
  -- entrada pelo recebimento conferido (SQL 186): a nota de compra só entra quando o material é conferido na chegada,
  -- com a data da chegada e a quantidade que chegou em bom estado; o custo unitário continua o da nota
  if tm.sentido = 'E' and not n.emissao_propria and n.tipo = 'entrada' and public._est_receb_ativo(n.empresa_id, n.emissao) then
    select r.data, ri.qtd_entra into v_ri from est_recebimento_itens ri join est_recebimentos r on r.id = ri.recebimento_id
     where ri.nfe_item_id = i.id and r.situacao = 'conferido' limit 1;
    if not found then return 'a_receber'; end if;
    v_data := v_ri.data; v_qtd := round(coalesce(v_ri.qtd_entra, 0) * coalesce(v_fator, 1), 4);
    if v_qtd <= 0 then
      update est_pendencias set status = 'resolvida', resolvido_em = now() where nfe_item_id = i.id and status = 'aberta';
      return 'nao_chegou';
    end if;
  end if;
  begin
    if tm.sentido = 'E' then
      if tm.afeta_custo then select * into ep from estoque_parametros where empresa_id = n.empresa_id; v_cu := custo_item_nfe(i, ep) / v_qtd_nota; end if;   -- custo da nota por unidade da nota
      if pr.controla_lote then
        insert into est_lotes(empresa_id, produto_id, codigo, fornecedor_id, origem)
        values (n.empresa_id, pr.id, 'NF' || n.numero || '-' || i.n_item, n.favorecido_id, 'compra')
        on conflict (empresa_id, produto_id, codigo) do update set codigo = excluded.codigo returning id into v_lote;
      end if;
      insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, nota_id, nfe_item_id, documento)
      values (n.empresa_id, v_data, pr.id, v_loc, v_lote, tm.id, v_qtd, v_cu, n.id, i.id, v_doc);
    elsif not pr.controla_lote then
      insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, nota_id, nfe_item_id, documento)
      values (n.empresa_id, n.emissao, pr.id, v_loc, tm.id, -v_qtd, n.id, i.id, v_doc);
    else   -- saída de produto com lote: do lote mais antigo para o mais novo
      v_resta := v_qtd;
      for l in select s.lote_id, s.quantidade from est_saldos s left join est_lotes lt on lt.id = s.lote_id
                where s.produto_id = pr.id and s.local_id = v_loc and s.quantidade > 0 order by lt.criado_em nulls first loop
        exit when v_resta <= 0;
        v_tira := least(v_resta, l.quantidade);
        insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, nota_id, nfe_item_id, documento)
        values (n.empresa_id, n.emissao, pr.id, v_loc, l.lote_id, tm.id, -v_tira, n.id, i.id, v_doc);
        v_resta := v_resta - v_tira;
      end loop;
      if v_resta > 0 then raise exception 'Saldo insuficiente de % no local: faltam %', pr.codigo, v_resta; end if;
    end if;
  exception when others then
    return _est_pendencia(i, case when sqlerrm like 'Saldo insuficiente%' then 'saldo' else 'erro' end, sqlerrm);
  end;
  update est_pendencias set status = 'resolvida', resolvido_em = now() where nfe_item_id = i.id and status = 'aberta';
  return 'ok';
end $$;
create or replace function public.est_receb_concluir(p_receb uuid, p_data date default null, p_observacao text default null, p_zerar_pendentes boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r est_recebimentos; n nfe_notas; c est_config; v_data date := coalesce(p_data, (now() at time zone 'America/Recife')::date); x record; v_div int := 0; v_lanc int := 0; v_res text; v_txt text := '';
begin
  select * into r from est_recebimentos where id = p_receb for update;
  if not found or not public._est_receb_pode(r.empresa_id) then raise exception 'Só quem atende o almoxarifado confere o recebimento.'; end if;
  if r.situacao <> 'conferindo' then raise exception 'Esta conferência já foi concluída.'; end if;
  select * into n from nfe_notas where id = r.nota_id;
  select * into c from est_config where empresa_id = r.empresa_id;
  if v_data > (now() at time zone 'America/Recife')::date then raise exception 'A data da chegada não pode ser futura.'; end if;
  if v_data < n.emissao then raise exception 'O material não pode ter chegado antes da emissão da nota (%).', to_char(n.emissao, 'DD/MM/YYYY'); end if;
  if c.dias_retroativos is not null and v_data < (now() at time zone 'America/Recife')::date - c.dias_retroativos then
    raise exception 'A data da chegada passa do limite de % dias para trás (Estoque › Parâmetros).', c.dias_retroativos;
  end if;
  if exists (select 1 from est_fechamentos where empresa_id = r.empresa_id and mes >= date_trunc('month', v_data)::date) then
    raise exception 'O estoque de % está fechado: informe uma data de chegada em mês aberto, ou peça ao administrador para reabrir o mês.', to_char(v_data, 'MM/YYYY');
  end if;
  if exists (select 1 from est_recebimento_itens where recebimento_id = r.id and contada is null) then
    if not coalesce(p_zerar_pendentes, false) then raise exception 'Há itens sem conferência. Confira-os, ou confirme que não chegaram (ficam com zero).'; end if;
    update est_recebimento_itens set contada = 0, contado_por = auth.uid(), contado_em = now() where recebimento_id = r.id and contada is null;
  end if;
  update est_recebimento_itens set qtd_entra = least(contada - avariada, qtd_nota),   -- o que chega a mais que a nota não entra: fica a divergência
         divergencia = nullif(concat_ws('; ',
           case when contada < qtd_nota and abs(contada - qtd_nota) > qtd_nota * c.receb_tolerancia_pct / 100 then 'faltou ' || trim(to_char(qtd_nota - contada, 'FM999G999G990D####')) end,
           case when contada > qtd_nota and abs(contada - qtd_nota) > qtd_nota * c.receb_tolerancia_pct / 100 then 'sobrou ' || trim(to_char(contada - qtd_nota, 'FM999G999G990D####')) end,
           case when avariada > 0 then 'avariado ' || trim(to_char(avariada, 'FM999G999G990D####')) end), '')
   where recebimento_id = r.id;
  select count(*) into v_div from est_recebimento_itens where recebimento_id = r.id and divergencia is not null;
  update est_recebimentos set situacao = 'conferido', data = v_data, conferido_em = now(), divergencias = v_div, observacao = left(nullif(trim(coalesce(p_observacao, '')), ''), 300) where id = r.id;
  -- lança no estoque o que já pode entrar (estoque implantado e chegada a partir da implantação); o resto entra pelo reprocessamento
  if c.implantado_em is not null and v_data >= c.implantado_em then
    for x in select ri.nfe_item_id from est_recebimento_itens ri join nfe_itens i on i.id = ri.nfe_item_id where ri.recebimento_id = r.id order by i.n_item loop
      v_res := public._est_item(x.nfe_item_id);
      if v_res = 'ok' then v_lanc := v_lanc + 1;
      elsif v_res not in ('ja', 'nao_movimenta', 'fora', 'nao_chegou', 'a_receber', 'sem_produto', 'sem_regra', 'sem_local') then
        -- o lançamento não coube (local congelado, inventariado, saldo): nada é gravado, e a conferência continua aberta para corrigir a data
        raise exception 'O item % da nota não pôde entrar no estoque: %', (select n_item from nfe_itens where id = x.nfe_item_id),
          coalesce((select mensagem from est_pendencias where nfe_item_id = x.nfe_item_id), v_res);
      end if;
    end loop;
  end if;
  if v_div > 0 then
    select string_agg(i.cprod || ' ' || left(i.xprod, 40) || ': ' || ri.divergencia, E'\n' order by i.n_item) into v_txt
      from est_recebimento_itens ri join nfe_itens i on i.id = ri.nfe_item_id where ri.recebimento_id = r.id and ri.divergencia is not null;
    begin
      perform _notificar_u(r.empresa_id, public._usuarios_papel(r.empresa_id, array['compras', 'admin']), 'recebimento',
        'Recebimento com divergência: NF ' || n.numero || ' de ' || coalesce(n.emit_nome, n.emit_doc), left(v_txt, 900), '#/estoque/recebimento?r=' || r.id, r.id, true);
    exception when others then null; end;
  end if;
  return jsonb_build_object('divergencias', v_div, 'lancados', v_lanc, 'data', v_data);
end $$;
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
  if exists (select 1 from est_movimentos m where m.local_id = gl.local_id and m.criado_em > gl.concluido_em) then
    raise exception 'O local já movimentou depois de concluído: a recontagem contaria esse movimento duas vezes. Ajuste o item pelo Kardex depois da aprovação, ou cancele o inventário e conte de novo.';
  end if;
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
    if m.quantidade > 0 and m.estorno_de is null and exists (select 1 from alm_devolucao_itens d where d.movimento_id = m.id) then
      -- devolução ao almoxarifado: acompanha o custo (já recalculado) da saída de onde o material veio
      select s.custo_unitario into cu from alm_devolucao_itens d join alm_entrega_itens e on e.id = d.entrega_item_id join est_movimentos s on s.id = e.movimento_id where d.movimento_id = m.id;
      cu := coalesce(cu, m.custo_unitario);
    elsif m.quantidade > 0 and m.afeta_custo and m.estorno_de is null then cu := m.custo_unitario;
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
create or replace function public._est_param_protege() returns trigger language plpgsql set search_path = public as $$
declare v_adm boolean;
begin
  if tg_table_name = 'est_tipos_movimento' then
    if tg_op = 'DELETE' then
      if old.sistema and exists (select 1 from empresas where id = old.empresa_id) then raise exception 'Tipo de movimento do sistema não se exclui: desative-o.'; end if;
      return old;
    end if;
    v_adm := current_user not in ('authenticated', 'anon') or is_admin(new.empresa_id);
    if tg_op = 'UPDATE' and old.sistema and new.codigo is distinct from old.codigo then
      raise exception 'O código de um tipo de movimento do sistema não muda: a plataforma o usa para reconhecer o tipo.';
    end if;
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
create or replace function public.est_ig_estornar(p_inventario uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g est_ig_inventarios; m record; v_n int := 0; v_mes date; v_reabriu boolean := false; p record; v_meses text;
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
  select string_agg(to_char(mes, 'MM/YYYY'), ', ' order by mes) into v_meses from est_fechamentos where empresa_id = g.empresa_id and mes >= v_mes;
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
  return jsonb_build_object('estornos', v_n, 'mes_reaberto', v_reabriu, 'meses_reabertos', v_meses);
end $$;

do $$ declare r record; begin
  for r in select p.oid::regprocedure f, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('est_receb_nota', 'est_receb_fila', 'est_receb_concluir', 'est_ig_recontar', 'est_ig_estornar', 'compras_notas_candidatas') loop
    execute format('revoke all on function %s from public, anon', r.f);
    execute format('grant execute on function %s to authenticated', r.f);
  end loop;
end $$;
revoke all on function public._est_item(uuid), public._est_recalc(uuid, uuid, date) from public, anon, authenticated;
