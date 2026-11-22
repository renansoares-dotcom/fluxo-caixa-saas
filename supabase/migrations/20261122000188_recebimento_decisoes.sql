-- 188 — recebimento e devolução: decisões do Renan sobre a 6ª avaliação (22/11/2026)
--   1. Nota "sem material": quem confere só PEDE a dispensa; administrador, financeiro ou diretor aprovam (nunca quem pediu).
--   2. Compras não confere o recebimento, a não ser que a pessoa esteja nomeada entre quem atende o almoxarifado.
--   3. Material avariado (no recebimento e na devolução) entra num local "Avariados", fora do custo médio, até ser devolvido
--      ao fornecedor ou descartado pelo Kardex.
-- Aditivo: nada é apagado.

alter table public.est_recebimentos drop constraint if exists est_recebimentos_situacao_check;
alter table public.est_recebimentos add constraint est_recebimentos_situacao_check check (situacao in ('conferindo', 'conferido', 'dispensa_pedida', 'dispensado', 'cancelado'));
alter table public.est_recebimentos add column if not exists dispensa_pedida_por uuid, add column if not exists dispensa_decidida_por uuid, add column if not exists dispensa_decidida_nome text,
  add column if not exists dispensa_decidida_em timestamptz, add column if not exists dispensa_motivo text;

-- local dos avariados: guarda o material, fora do custo médio, até a decisão (devolver ao fornecedor ou descartar)
create or replace function public._est_local_avariados(p_empresa uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from est_locais where empresa_id = p_empresa and codigo = 'AVA';
  if v is null then
    insert into est_locais (empresa_id, codigo, nome, finalidade, posse, controla_saldo, compoe_custo, permite_negativo, ordem)
    values (p_empresa, 'AVA', 'Avariados (aguardando devolução ao fornecedor ou descarte)', 'outro', 'propria', true, false, false, 125)
    on conflict (empresa_id, codigo) do nothing returning id into v;
    if v is null then select id into v from est_locais where empresa_id = p_empresa and codigo = 'AVA'; end if;
  end if;
  return v;
end $$;
revoke all on function public._est_local_avariados(uuid) from public, anon, authenticated;
select public._est_local_avariados(empresa_id) from (select distinct empresa_id from est_tipos_movimento) e;

-- quem confere o recebimento: quem atende o almoxarifado, menos o perfil Compras (quem compra conhece o pedido),
-- a não ser que a pessoa esteja nomeada entre os almoxarifes nos parâmetros da Requisição de Material
create or replace function public._est_receb_pode(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.alm_almoxarife(p_empresa) and public._mfa_ok(p_empresa)
     and (not exists (select 1 from membros m where m.empresa_id = p_empresa and m.user_id = auth.uid() and m.papel::text = 'compras')
          or exists (select 1 from alm_config c where c.empresa_id = p_empresa and auth.uid() = any(c.almoxarifes)));
$$;
create or replace function public._est_receb_aprova(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor')) and public._mfa_ok(p_empresa);
$$;
revoke all on function public._est_receb_aprova(uuid) from public, anon, authenticated;


create or replace function public._est_item(p_item uuid) returns text
language plpgsql security definer set search_path = public as $$
declare i nfe_itens; n nfe_notas; pr produtos; v_fator numeric := 1; reg est_regras_cfop; tm est_tipos_movimento; v_sent text; v_cfop text;
        v_loc uuid; v_qtd numeric; v_cu numeric; ep estoque_parametros; v_lote uuid; v_resta numeric; l record; v_tira numeric; v_doc text; v_pid uuid;
        v_data date; v_qtd_nota numeric; v_ri record; v_av numeric := 0;
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
     and exists (select 1 from est_recebimento_itens ri join est_recebimentos r on r.id = ri.recebimento_id where ri.nfe_item_id = i.id and r.situacao = 'conferido' and coalesce(ri.qtd_entra, 0) <= 0 and coalesce(ri.avariada, 0) <= 0) then
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
    select r.data, ri.qtd_entra, ri.avariada into v_ri from est_recebimento_itens ri join est_recebimentos r on r.id = ri.recebimento_id
     where ri.nfe_item_id = i.id and r.situacao = 'conferido' limit 1;
    if not found then return 'a_receber'; end if;
    v_data := v_ri.data; v_qtd := round(coalesce(v_ri.qtd_entra, 0) * coalesce(v_fator, 1), 4);
    v_av := round(coalesce(v_ri.avariada, 0) * coalesce(v_fator, 1), 4);
    if v_qtd <= 0 and v_av <= 0 then
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
      if v_qtd > 0 then
        insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, nota_id, nfe_item_id, documento)
        values (n.empresa_id, v_data, pr.id, v_loc, v_lote, tm.id, v_qtd, v_cu, n.id, i.id, v_doc);
      end if;
      if v_av > 0 then   -- o que chegou avariado fica no local de avariados, fora do custo médio, até devolver ao fornecedor ou descartar
        insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, nota_id, nfe_item_id, documento, observacao)
        values (n.empresa_id, v_data, pr.id, public._est_local_avariados(n.empresa_id), v_lote, tm.id, v_av, v_cu, n.id, i.id, v_doc, 'Chegou avariado: aguardando devolução ao fornecedor ou descarte');
      end if;
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

-- quem confere pede a dispensa; a nota sai da conferência e espera a decisão
create or replace function public.est_receb_dispensar(p_nota uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare n nfe_notas; v_num int; v_id uuid;
begin
  select * into n from nfe_notas where id = p_nota;
  if not found or not public._est_receb_pode(n.empresa_id) then raise exception 'Só quem confere o recebimento pede a dispensa.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe por que esta nota não tem material para receber.'; end if;
  if exists (select 1 from est_recebimentos where nota_id = n.id and situacao in ('conferido', 'dispensado', 'dispensa_pedida')) then raise exception 'Esta nota já foi recebida, dispensada ou está com a dispensa pedida.'; end if;
  perform pg_advisory_xact_lock(hashtext('est_receb:' || n.empresa_id::text));
  update est_recebimentos set situacao = 'cancelado' where nota_id = n.id and situacao = 'conferindo';
  select coalesce(max(numero), 0) + 1 into v_num from est_recebimentos where empresa_id = n.empresa_id;
  insert into est_recebimentos (empresa_id, numero, nota_id, situacao, conferente_nome, dispensa_pedida_por, observacao)
  values (n.empresa_id, v_num, n.id, 'dispensa_pedida', public._alm_nome(n.empresa_id), auth.uid(), 'Dispensa pedida: ' || left(trim(p_motivo), 280)) returning id into v_id;
  begin
    perform _notificar_u(n.empresa_id, public._usuarios_papel(n.empresa_id, array['admin', 'financeiro', 'diretor']), 'recebimento',
      'Aprovar dispensa de recebimento: NF ' || n.numero || ' de ' || coalesce(n.emit_nome, n.emit_doc), 'Motivo: ' || left(trim(p_motivo), 280), '#/estoque/recebimento', v_id, true);
  exception when others then null; end;
end $$;

-- administrador, financeiro ou diretor decide; quem pediu não decide
create or replace function public.est_receb_dispensa_decidir(p_receb uuid, p_aprova boolean, p_motivo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare r est_recebimentos;
begin
  select * into r from est_recebimentos where id = p_receb for update;
  if not found or not public._est_receb_aprova(r.empresa_id) then raise exception 'Só administrador, financeiro ou diretor decide a dispensa.'; end if;
  if r.situacao <> 'dispensa_pedida' then raise exception 'Esta dispensa já foi decidida.'; end if;
  if r.dispensa_pedida_por = auth.uid() then raise exception 'Quem pediu a dispensa não a aprova.'; end if;
  if not coalesce(p_aprova, false) and length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe por que a dispensa foi recusada.'; end if;
  update est_recebimentos set situacao = case when p_aprova then 'dispensado' else 'cancelado' end, conferido_em = case when p_aprova then now() end,
         dispensa_decidida_por = auth.uid(), dispensa_decidida_nome = public._alm_nome(r.empresa_id), dispensa_decidida_em = now(), dispensa_motivo = left(nullif(trim(coalesce(p_motivo, '')), ''), 300)
   where id = r.id;
  return case when p_aprova then 'dispensado' else 'recusado' end;
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
     and n.emissao >= c.receb_desde and (r.id is null or r.situacao in ('conferindo', 'dispensa_pedida'))
     and (r.id is not null or not exists (select 1 from est_movimentos m where m.nota_id = n.id))   -- já entrou pela emissão: não é para conferir
   order by n.emissao, n.numero;
end $$;

create or replace function public.est_receb_iniciar(p_nota uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare n nfe_notas; v_id uuid; v_num int;
begin
  select * into n from nfe_notas where id = p_nota;
  if not found or not public._est_receb_pode(n.empresa_id) then raise exception 'Só quem atende o almoxarifado confere o recebimento (o perfil Compras confere só se estiver nomeado entre os almoxarifes).'; end if;
  if n.tipo <> 'entrada' or n.emissao_propria or n.situacao <> 'autorizada' or not public._est_receb_ativo(n.empresa_id, n.emissao) then raise exception 'Esta nota não passa pela conferência de recebimento.'; end if;
  perform pg_advisory_xact_lock(hashtext('est_receb:' || n.empresa_id::text));
  select id into v_id from est_recebimentos where nota_id = n.id and situacao <> 'cancelado';
  if v_id is not null then
    if (select situacao from est_recebimentos where id = v_id) <> 'conferindo' then raise exception 'Esta nota já foi recebida, dispensada ou está com a dispensa pedida.'; end if;
    return v_id;
  end if;
  select coalesce(max(numero), 0) + 1 into v_num from est_recebimentos where empresa_id = n.empresa_id;
  insert into est_recebimentos (empresa_id, numero, nota_id, conferente_nome) values (n.empresa_id, v_num, n.id, public._alm_nome(n.empresa_id)) returning id into v_id;
  insert into est_recebimento_itens (recebimento_id, empresa_id, nfe_item_id, qtd_nota)
  select v_id, n.empresa_id, i.id, coalesce(i.qcom, 0) from nfe_itens i where i.nota_id = n.id and coalesce(i.qcom, 0) > 0;
  return v_id;
end $$;

create or replace function public.alm_devolver(p_requisicao uuid, p_itens jsonb, p_motivo text, p_devolveu uuid default null, p_devolveu_nome text default null, p_cracha_codigo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r alm_requisicoes; cfg alm_config; k rh_colaboradores; it jsonb; ei alm_entrega_itens; en alm_entregas; om est_movimentos; v_q numeric; v_est text; v_dev uuid; v_num int;
  v_tm uuid; v_mov uuid; v_nome text; v_cracha boolean; v_hoje date := (now() at time zone 'America/Recife')::date; v_n int := 0; v_val numeric := 0; v_v numeric; v_dias int;
begin
  select * into r from alm_requisicoes where id = p_requisicao;
  if not found or not public.alm_almoxarife(r.empresa_id) then raise exception 'Só quem atende o almoxarifado recebe a devolução.'; end if;
  select * into cfg from alm_config where empresa_id = r.empresa_id;
  if jsonb_typeof(coalesce(p_itens, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Informe o que está sendo devolvido.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo da devolução.'; end if;
  if p_devolveu is not null then
    select * into k from rh_colaboradores where id = p_devolveu and empresa_id = r.empresa_id;
    if not found then raise exception 'Quem devolve não é colaborador desta empresa.'; end if;
  end if;
  v_nome := coalesce(k.nome, nullif(trim(coalesce(p_devolveu_nome, '')), ''));
  if v_nome is null then raise exception 'Identifique quem está devolvendo (crachá ou nome).'; end if;
  v_cracha := public._alm_cracha_confere(r.empresa_id, p_cracha_codigo, p_devolveu, p_devolveu_nome);
  v_tm := public._alm_tipo_devolucao(r.empresa_id);
  perform pg_advisory_xact_lock(hashtext('alm_dev:' || r.empresa_id::text));
  select coalesce(max(numero), 0) + 1 into v_num from alm_devolucoes where empresa_id = r.empresa_id;
  insert into alm_devolucoes (empresa_id, numero, requisicao_id, recebido_nome, devolveu_colaborador_id, devolveu_nome, cracha_lido, motivo)
  values (r.empresa_id, v_num, r.id, public._alm_nome(r.empresa_id), k.id, v_nome, v_cracha, left(trim(p_motivo), 300)) returning id into v_dev;
  for it in select * from jsonb_array_elements(p_itens) loop
    v_q := (it ->> 'quantidade')::numeric;
    if v_q is null or v_q = 'NaN'::numeric then raise exception 'Quantidade inválida.'; end if;
    if v_q <= 0 then continue; end if;
    v_est := coalesce(it ->> 'estado', 'boa');
    if v_est not in ('boa', 'avariada') then raise exception 'Estado inválido: boa ou avariada.'; end if;
    select * into ei from alm_entrega_itens where id = (it ->> 'entrega_item_id')::uuid for update;
    select * into en from alm_entregas where id = ei.entrega_id;
    if ei.id is null or en.requisicao_id <> r.id then raise exception 'Item que não foi entregue nesta requisição.'; end if;
    if ei.estornado_em is not null then raise exception 'Esta entrega foi estornada: não há o que devolver.'; end if;
    if v_q > ei.quantidade - ei.qtd_devolvida + 0.00005 then
      raise exception 'Devolução de % maior que o entregue e ainda não devolvido (%).', (select codigo from produtos where id = ei.produto_id), ei.quantidade - ei.qtd_devolvida;
    end if;
    v_dias := cfg.devolucao_dias;
    if v_dias is not null and (en.entregue_em at time zone 'America/Recife')::date + v_dias < v_hoje then
      raise exception 'O prazo de devolução de % dias terminou para %, entregue em %.', v_dias, (select codigo from produtos where id = ei.produto_id), to_char(en.entregue_em at time zone 'America/Recife', 'DD/MM/YYYY');
    end if;
    v_mov := null;
    if v_est = 'avariada' then   -- avariado: fica no local de avariados, sem valor (o consumo do setor continua), até o descarte
      insert into est_movimentos (empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao, centro_custo_id)
      values (r.empresa_id, v_hoje, ei.produto_id, public._est_local_avariados(r.empresa_id), ei.lote_id, v_tm, v_q, 0, 'DV ' || v_num,
              left('Devolvido avariado, requisição nº ' || r.numero || ' — ' || v_nome || ': ' || trim(p_motivo), 200), null)
      returning id into v_mov;
    end if;
    if v_est = 'boa' then   -- volta ao mesmo local e lote, ao custo em que saiu, no centro de custo que consumiu
      select * into om from est_movimentos where id = ei.movimento_id;
      begin
        insert into est_movimentos (empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao, centro_custo_id)
        values (r.empresa_id, v_hoje, ei.produto_id, ei.local_id, ei.lote_id, v_tm, v_q, coalesce(om.custo_unitario, 0), 'DV ' || v_num,
                left('Devolução da requisição nº ' || r.numero || ' — ' || v_nome || ': ' || trim(p_motivo), 200), om.centro_custo_id)
        returning id, valor into v_mov, v_v;
      exception when others then
        raise exception 'Item %: %', (select codigo from produtos where id = ei.produto_id), sqlerrm;
      end;
      v_val := v_val + coalesce(v_v, 0);
    end if;
    insert into alm_devolucao_itens (devolucao_id, empresa_id, entrega_item_id, produto_id, local_id, lote_id, quantidade, estado, movimento_id)
    values (v_dev, r.empresa_id, ei.id, ei.produto_id, ei.local_id, ei.lote_id, v_q, v_est, v_mov);
    update alm_entrega_itens set qtd_devolvida = qtd_devolvida + v_q where id = ei.id;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Informe a quantidade devolvida de pelo menos um item.'; end if;
  return jsonb_build_object('devolucao_id', v_dev, 'numero', v_num, 'itens', v_n, 'valor', round(v_val, 2));
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
    if m.quantidade > 0 and m.estorno_de is null and exists (select 1 from alm_devolucao_itens d where d.movimento_id = m.id and d.estado = 'boa') then
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

do $$ declare r record; begin
  for r in select p.oid::regprocedure f, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('est_receb_dispensar', 'est_receb_dispensa_decidir', 'est_receb_fila', 'est_receb_iniciar', 'alm_devolver') loop
    execute format('revoke all on function %s from public, anon', r.f);
    execute format('grant execute on function %s to authenticated', r.f);
  end loop;
end $$;
revoke all on function public._est_item(uuid), public._est_receb_pode(uuid), public._est_recalc(uuid, uuid, date) from public, anon, authenticated;
