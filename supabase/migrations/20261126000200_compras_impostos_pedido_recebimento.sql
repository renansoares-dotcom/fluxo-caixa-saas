-- Compras: impostos no pedido e no recebimento (SQL 200) — 26/11/2026.
-- Pedido do Renan, depois do teste da NF 9.253 (NORPOLIM): "Precisamos conversar sobre os impostos das requisições / no momento de receber, como funcionará?"
-- Aditivo:
--   1) o pedido leva da cotação a UF e o regime do fornecedor e, por item, a destinação, o ICMS, o IPI e o ICMS-ST;
--      o total do pedido passa a somar IPI e ICMS-ST (o que de fato se paga: alçada e previsão no contas a pagar);
--   2) o confronto do recebimento confere os impostos da nota contra o pedido: ICMS menor (crédito perdido), nota do Simples
--      quando se esperava regime normal, IPI e ICMS-ST a mais. Cada divergência traz o efeito em R$ no custo e no desembolso;
--      acima da tolerância em R$ (parâmetro) trava o pagamento como as demais; abaixo, só avisa;
--   3) compras_liquido_realizado(): dados do cotado × realizado por item recebido, para a tela e o relatório calcularem o custo
--      líquido pelo mesmo motor da cotação (js/lib/aquisicao.js).

-- 1) colunas
alter table public.compras_pedidos add column if not exists uf text;
alter table public.compras_pedidos add column if not exists regime text;
alter table public.compras_pedidos add column if not exists simples_credito_pct numeric(6,2);
do $$ begin
  alter table public.compras_pedidos add constraint compras_ped_regime_chk check (regime is null or regime in ('real', 'presumido', 'simples', 'mei'));
exception when duplicate_object then null; end $$;
alter table public.compras_pedido_itens add column if not exists destinacao text;
alter table public.compras_pedido_itens add column if not exists icms_aliq numeric(8,4);
alter table public.compras_pedido_itens add column if not exists ipi_aliq numeric(8,4);
alter table public.compras_pedido_itens add column if not exists st_un numeric(16,4);
do $$ begin
  alter table public.compras_pedido_itens add constraint compras_ped_it_fisc_chk check ((destinacao is null or destinacao in ('insumo', 'revenda', 'uso_consumo', 'ativo'))
    and (icms_aliq is null or icms_aliq between 0 and 100) and (ipi_aliq is null or ipi_aliq between 0 and 100) and (st_un is null or st_un >= 0));
exception when duplicate_object then null; end $$;
alter table public.compras_parametros add column if not exists conf_impostos boolean not null default true;
alter table public.compras_parametros add column if not exists conf_tol_imposto_valor numeric(14,2) not null default 50;
do $$ begin
  alter table public.compras_parametros add constraint compras_par_conf_imp_chk check (conf_tol_imposto_valor >= 0);
exception when duplicate_object then null; end $$;

-- 2) total do pedido = mercadorias + IPI + ICMS-ST (+ frete − desconto, no gatilho do pedido)
create or replace function public._compras_total_itens(p_pedido uuid) returns numeric
language sql stable set search_path = public as $$
  select coalesce(round(sum(quantidade * valor_unitario * (1 + coalesce(ipi_aliq, 0) / 100) + quantidade * coalesce(st_un, 0)), 2), 0)
  from compras_pedido_itens where pedido_id = p_pedido;
$$;
-- os impostos do item também não mudam depois de aprovado
create or replace function public._compras_itens_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.pedido_id, old.pedido_id); st text;
begin
  select status into st from compras_pedidos where id = pid;
  -- itens só mudam com o pedido em rascunho ou aguardando (a quantidade recebida é atualizada pelo recebimento)
  if st not in ('rascunho', 'aguardando') and not (tg_op = 'UPDATE' and new.quantidade = old.quantidade and new.valor_unitario = old.valor_unitario
      and new.descricao = old.descricao
      and new.icms_aliq is not distinct from old.icms_aliq and new.ipi_aliq is not distinct from old.ipi_aliq and new.st_un is not distinct from old.st_un) then
    raise exception 'Pedido já aprovado: itens não podem mudar. Volte o pedido para rascunho (se não tiver recebimento) ou cancele.';
  end if;
  update compras_pedidos set total = _compras_total_itens(pid) + frete - desconto where id = pid;
  return null;
end $$;

-- 3) o confronto, com os impostos
create or replace function public._compras_confronto(p_pedido uuid, p_nota uuid, p_itens jsonb, p_data date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p compras_pedidos; n nfe_notas; c compras_parametros; out jsonb := '[]'; it jsonb; pi compras_pedido_itens; v_q numeric; v_pr numeric; v_fora numeric;
  tol_p numeric; tol_q numeric; tol_v numeric; tol_d int; tol_e int; v_base date; r record; k int := 0;
  ni nfe_itens; tol_i numeric; v_dest text; v_nsimp boolean; v_cred_icms boolean; v_cred_ipi boolean; v_pi numeric; v_ipi numeric; v_custo numeric; v_desemb numeric; v_st_esp numeric; v_tem_fisc boolean;
begin
  select * into p from compras_pedidos where id = p_pedido;
  select * into c from compras_parametros where empresa_id = p.empresa_id;
  tol_p := coalesce(c.conf_tol_preco_pct, 2); tol_q := coalesce(c.conf_tol_qtd_pct, 5); tol_v := coalesce(c.conf_tol_valor, 10);
  tol_d := coalesce(c.conf_tol_prazo_dias, 3); tol_e := coalesce(c.conf_tol_entrega_dias, 2); tol_i := coalesce(c.conf_tol_imposto_valor, 50);
  -- itens: quantidade e preço contra o pedido
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    select * into pi from compras_pedido_itens where id = (it ->> 'pedido_item_id')::uuid and pedido_id = p.id;
    continue when pi.id is null or coalesce((it ->> 'quantidade')::numeric, 0) <= 0;
    v_q := pi.qtd_recebida + (it ->> 'quantidade')::numeric;
    if v_q > pi.quantidade * (1 + tol_q / 100) + 0.00001 then
      out := out || jsonb_build_object('tipo', 'quantidade', 'item', pi.descricao, 'esperado', pi.quantidade, 'recebido', v_q, 'bloqueia', true,
        'valor', round((v_q - pi.quantidade) * coalesce(nullif(it ->> 'valor_unitario', '')::numeric, pi.valor_unitario), 2),
        'texto', format('%s: recebido %s de %s pedidos (tolerância %s%%)', pi.descricao, trim(to_char(v_q, 'FM999G999G990D####')), trim(to_char(pi.quantidade, 'FM999G999G990D####')), tol_q));
    end if;
    v_pr := nullif(it ->> 'valor_unitario', '')::numeric;
    if v_pr is not null and pi.valor_unitario > 0 and v_pr > pi.valor_unitario * (1 + tol_p / 100) + 0.00001 then
      out := out || jsonb_build_object('tipo', 'preco', 'item', pi.descricao, 'esperado', pi.valor_unitario, 'recebido', v_pr, 'bloqueia', true,
        'valor', round((v_pr - pi.valor_unitario) * (it ->> 'quantidade')::numeric, 2),
        'texto', format('%s: preço da nota %s acima do pedido %s (+%s%%; tolerância %s%%)', pi.descricao, to_char(v_pr, 'FM999G990D0000'), to_char(pi.valor_unitario, 'FM999G990D0000'),
                        to_char((v_pr / pi.valor_unitario - 1) * 100, 'FM990D0'), tol_p));
    end if;
    -- impostos (SQL 200): a nota contra o que foi cotado/combinado no pedido. Efeito no custo líquido e no desembolso, em R$.
    if coalesce(c.conf_impostos, true) and nullif(it ->> 'nfe_item_id', '') is not null then
      select * into ni from nfe_itens where id = (it ->> 'nfe_item_id')::uuid;
      v_tem_fisc := pi.icms_aliq is not null or pi.ipi_aliq is not null or pi.st_un is not null or p.regime is not null;
      if ni.id is not null and v_tem_fisc then
        v_dest := coalesce(pi.destinacao, 'insumo');
        v_cred_icms := v_dest in ('insumo', 'revenda', 'ativo');
        v_cred_ipi := v_dest = 'insumo' and coalesce(c.aq_ipi_contribuinte, true);
        v_nsimp := length(coalesce(ni.cst_icms, '')) = 3;                 -- CSOSN: nota do Simples, sem ICMS destacado
        -- ICMS: crédito menor que o combinado
        if pi.icms_aliq is not null and pi.icms_aliq > 0 then
          if v_nsimp and coalesce(p.regime, 'real') not in ('simples', 'mei') then
            v_custo := case when v_cred_icms then round(ni.vprod * (pi.icms_aliq - coalesce(p.simples_credito_pct, 0)) / 100, 2) else 0 end;
            out := out || jsonb_build_object('tipo', 'imposto_regime', 'item', pi.descricao, 'esperado', pi.icms_aliq, 'recebido', 'Simples', 'custo', v_custo, 'desembolso', 0,
              'valor', v_custo, 'bloqueia', v_custo > tol_i,
              'texto', format('%s: nota emitida pelo Simples (CSOSN %s), sem ICMS destacado; o pedido previa ICMS de %s%%%s', pi.descricao, ni.cst_icms, trim(to_char(pi.icms_aliq, 'FM990D00')),
                case when v_custo > 0 then format(' — crédito cerca de R$ %s menor', translate(to_char(v_custo, 'FM999G999G990D00'), ',.', '.,')) else '' end));
          elsif not v_nsimp and coalesce(ni.p_icms, 0) + 0.005 < pi.icms_aliq then
            v_custo := case when v_cred_icms then round(coalesce(nullif(ni.v_bc_icms, 0), ni.vprod) * (pi.icms_aliq - coalesce(ni.p_icms, 0)) / 100, 2) else 0 end;
            out := out || jsonb_build_object('tipo', 'imposto_icms', 'item', pi.descricao, 'esperado', pi.icms_aliq, 'recebido', coalesce(ni.p_icms, 0), 'custo', v_custo, 'desembolso', 0,
              'valor', v_custo, 'bloqueia', v_custo > tol_i,
              'texto', format('%s: ICMS da nota %s%% × pedido %s%%%s', pi.descricao, trim(to_char(coalesce(ni.p_icms, 0), 'FM990D00')), trim(to_char(pi.icms_aliq, 'FM990D00')),
                case when v_custo > 0 then format(' — crédito R$ %s menor', translate(to_char(v_custo, 'FM999G999G990D00'), ',.', '.,')) else ' (sem crédito nesta destinação)' end));
          end if;
        end if;
        -- IPI: mais do que o combinado
        v_ipi := case when coalesce(ni.vprod, 0) > 0 then round(coalesce(ni.v_ipi, 0) / ni.vprod * 100, 2) else 0 end;
        if v_ipi > coalesce(pi.ipi_aliq, 0) + 0.005 and (pi.ipi_aliq is not null or pi.icms_aliq is not null) then
          v_desemb := round(coalesce(ni.v_ipi, 0) - ni.vprod * coalesce(pi.ipi_aliq, 0) / 100, 2);
          v_custo := case when v_cred_ipi then 0 else v_desemb end;
          out := out || jsonb_build_object('tipo', 'imposto_ipi', 'item', pi.descricao, 'esperado', coalesce(pi.ipi_aliq, 0), 'recebido', v_ipi, 'custo', v_custo, 'desembolso', v_desemb,
            'valor', greatest(v_custo, v_desemb), 'bloqueia', greatest(v_custo, v_desemb) > tol_i,
            'texto', format('%s: IPI da nota %s%% × pedido %s%% — R$ %s a mais a pagar%s', pi.descricao, trim(to_char(v_ipi, 'FM990D00')), trim(to_char(coalesce(pi.ipi_aliq, 0), 'FM990D00')),
              translate(to_char(v_desemb, 'FM999G999G990D00'), ',.', '.,'), case when v_cred_ipi then ' (volta como crédito)' else ' (sem crédito: entra no custo)' end));
        end if;
        -- ICMS-ST: mais do que o combinado (não gera crédito para nós)
        v_st_esp := coalesce(pi.st_un, 0) * coalesce((it ->> 'quantidade')::numeric, 0);
        if coalesce(ni.v_st, 0) > v_st_esp + 0.01 and (pi.st_un is not null or pi.icms_aliq is not null) then
          v_desemb := round(ni.v_st - v_st_esp, 2);
          out := out || jsonb_build_object('tipo', 'imposto_st', 'item', pi.descricao, 'esperado', round(v_st_esp, 2), 'recebido', ni.v_st, 'custo', v_desemb, 'desembolso', v_desemb,
            'valor', v_desemb, 'bloqueia', v_desemb > tol_i,
            'texto', format('%s: ICMS-ST da nota R$ %s × pedido R$ %s — R$ %s a mais no custo', pi.descricao, translate(to_char(ni.v_st, 'FM999G999G990D00'), ',.', '.,'),
              translate(to_char(v_st_esp, 'FM999G999G990D00'), ',.', '.,'), translate(to_char(v_desemb, 'FM999G999G990D00'), ',.', '.,')));
        end if;
      end if;
    end if;
  end loop;
  if p_nota is not null then
    select * into n from nfe_notas where id = p_nota;
    -- itens da nota que não estão no recebimento
    select coalesce(sum(i.vprod), 0) into v_fora from nfe_itens i where i.nota_id = n.id
       and not exists (select 1 from jsonb_array_elements(coalesce(p_itens, '[]')) x where nullif(x ->> 'nfe_item_id', '')::uuid = i.id);
    if v_fora > tol_v then
      out := out || jsonb_build_object('tipo', 'item_fora', 'valor', v_fora, 'bloqueia', true,
        'texto', format('Itens da nota fora do pedido: R$ %s (tolerância R$ %s)', translate(to_char(v_fora, 'FM999G999G990D00'), ',.', '.,'), translate(to_char(tol_v, 'FM999G990D00'), ',.', '.,')));
    end if;
    -- prazo de pagamento: cada parcela da nota contra a parcela do pedido (dias contados da emissão da nota)
    v_base := n.emissao;
    for r in select pa.numero, pa.vencimento, (p.parcelas_dias)[row_number() over (order by pa.numero)] dias from nfe_parcelas pa where pa.nota_id = n.id and pa.vencimento is not null order by pa.numero loop
      k := k + 1;
      if r.dias is not null and r.vencimento < v_base + r.dias - tol_d then
        out := out || jsonb_build_object('tipo', 'prazo_pagamento', 'esperado', v_base + r.dias, 'recebido', r.vencimento, 'bloqueia', true,
          'texto', format('Parcela %s vence %s; pelo pedido (%s dias) seria %s', r.numero, to_char(r.vencimento, 'DD/MM/YYYY'), r.dias, to_char(v_base + r.dias, 'DD/MM/YYYY')));
      end if;
    end loop;
    if k > 0 and k <> coalesce(array_length(p.parcelas_dias, 1), 0) then
      out := out || jsonb_build_object('tipo', 'parcelas', 'esperado', coalesce(array_length(p.parcelas_dias, 1), 0), 'recebido', k, 'bloqueia', false,
        'texto', format('A nota tem %s parcela(s); o pedido, %s', k, coalesce(array_length(p.parcelas_dias, 1), 0)));
    end if;
  end if;
  -- entrega (informativo; alimenta a avaliação do fornecedor)
  if p.entrega_prevista is not null and coalesce(p_data, current_date) > p.entrega_prevista + tol_e then
    out := out || jsonb_build_object('tipo', 'entrega', 'esperado', p.entrega_prevista, 'recebido', coalesce(p_data, current_date), 'bloqueia', false,
      'texto', format('Entrega %s dia(s) depois do previsto (%s)', coalesce(p_data, current_date) - p.entrega_prevista, to_char(p.entrega_prevista, 'DD/MM/YYYY')));
  end if;
  return out;
end $$;
revoke all on function public._compras_confronto(uuid, uuid, jsonb, date) from public, anon, authenticated;

-- 4) cotado × realizado: um registro por item recebido com nota (o cálculo é feito na tela, pelo motor da cotação)
create or replace function public.compras_liquido_realizado(p_empresa uuid, p_de date, p_ate date, p_pedido uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.pode_comprar(p_empresa) or public.is_membro(p_empresa)) then raise exception 'Sem acesso.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'pedido_id', p.id, 'pedido', p.numero, 'fornecedor', coalesce(f.nome, n.emit_nome), 'uf', p.uf, 'regime', p.regime, 'simples_credito_pct', p.simples_credito_pct,
      'recebimento', r.data, 'nota', n.numero, 'uf_nota', public._uf_do_codigo(left(n.chave, 2)),
      'item', pi.descricao, 'unidade', pi.unidade, 'ncm', pi.ncm, 'destinacao', coalesce(pi.destinacao, 'insumo'), 'quantidade', ri.quantidade,
      'vu_pedido', pi.valor_unitario, 'icms_pedido', pi.icms_aliq, 'ipi_pedido', pi.ipi_aliq, 'st_un_pedido', pi.st_un,
      'vu_nota', coalesce(ri.valor_unitario, pi.valor_unitario), 'icms_nota', case when length(coalesce(ni.cst_icms, '')) = 3 then null else coalesce(ni.p_icms, 0) end,
      'nota_simples', length(coalesce(ni.cst_icms, '')) = 3,
      'ipi_nota', case when coalesce(ni.vprod, 0) > 0 then round(coalesce(ni.v_ipi, 0) / ni.vprod * 100, 4) else 0 end,
      'st_un_nota', case when ri.quantidade > 0 then round(coalesce(ni.v_st, 0) / ri.quantidade, 4) else 0 end,
      'comparavel', pi.icms_aliq is not null or pi.ipi_aliq is not null or pi.st_un is not null or p.regime is not null) order by r.data, p.numero, pi.descricao)
    from compras_recebimento_itens ri
    join compras_recebimentos r on r.id = ri.recebimento_id
    join compras_pedido_itens pi on pi.id = ri.pedido_item_id
    join compras_pedidos p on p.id = r.pedido_id
    join nfe_itens ni on ni.id = ri.nfe_item_id
    join nfe_notas n on n.id = ni.nota_id
    left join favorecidos f on f.id = p.favorecido_id
    where r.empresa_id = p_empresa and (p_pedido is null or p.id = p_pedido)
      and (p_pedido is not null or r.data between coalesce(p_de, '1900-01-01') and coalesce(p_ate, '2999-12-31'))), '[]'::jsonb);
end $$;
revoke all on function public.compras_liquido_realizado(uuid, date, date, uuid) from public, anon;
grant execute on function public.compras_liquido_realizado(uuid, date, date, uuid) to authenticated;
