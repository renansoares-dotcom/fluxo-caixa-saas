-- 189 — o recebimento conferido fala com Compras: divergência da chegada trava o pagamento da nota
--   * falta e avaria além da tolerância viram divergência que bloqueia, no mesmo bloqueio do confronto pedido × nota
--     (compras_bloqueios), com o valor ao preço unitário da nota; os títulos da nota (de agora e os ligados depois) ficam travados;
--   * a liberação é a mesma de Compras (compras_liberar_pagamento, pelos perfis dos parâmetros de Compras), com o motivo;
--   * sobra não bloqueia (a nota cobra menos do que chegou): fica a divergência;
--   * a tela de confronto de Compras passa a mostrar as divergências da conferência.
-- Liga e desliga pelo parâmetro que já existe em Compras: "bloquear o pagamento quando houver divergência" (conf_bloquear).
-- Aditivo: nada é apagado.

alter table public.est_recebimentos add column if not exists bloqueio_id uuid references public.compras_bloqueios(id) on delete set null;

create or replace function public.est_receb_concluir(p_receb uuid, p_data date default null, p_observacao text default null, p_zerar_pendentes boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r est_recebimentos; n nfe_notas; c est_config; cp compras_parametros; v_bdiv jsonb; v_bval numeric; v_b uuid; v_data date := coalesce(p_data, (now() at time zone 'America/Recife')::date); x record; v_div int := 0; v_lanc int := 0; v_res text; v_txt text := '';
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
  -- divergência que bloqueia: o que faltou ou chegou avariado, ao preço unitário da nota, trava o pagamento da nota
  select * into cp from compras_parametros where empresa_id = r.empresa_id;
  select coalesce(jsonb_agg(jsonb_build_object('tipo', 'recebimento', 'item', left(i.xprod, 60),
           'texto', 'Conferência da chegada — ' || i.cprod || ' ' || left(i.xprod, 40) || ': ' || ri.divergencia,
           'valor', round(greatest(ri.qtd_nota - (ri.contada - ri.avariada), 0) * coalesce(i.vuncom, 0), 2),
           'bloqueia', greatest(ri.qtd_nota - (ri.contada - ri.avariada), 0) > ri.qtd_nota * c.receb_tolerancia_pct / 100) order by i.n_item), '[]'::jsonb)
    into v_bdiv from est_recebimento_itens ri join nfe_itens i on i.id = ri.nfe_item_id where ri.recebimento_id = r.id and ri.divergencia is not null;
  select coalesce(sum((d ->> 'valor')::numeric), 0) into v_bval from jsonb_array_elements(v_bdiv) d where (d ->> 'bloqueia')::boolean;
  if coalesce(cp.conf_bloquear, true) and v_bval > 0 then
    select id into v_b from compras_bloqueios where nota_id = n.id and situacao = 'bloqueada' for update;
    if v_b is null then
      insert into compras_bloqueios (empresa_id, nota_id, pedido_id, divergencias, valor_divergente)
      values (r.empresa_id, n.id, (select cr.pedido_id from compras_recebimentos cr where cr.nfe_nota_id = n.id order by cr.criado_em desc limit 1), v_bdiv, v_bval)
      returning id into v_b;
    else
      update compras_bloqueios set divergencias = divergencias || v_bdiv, valor_divergente = valor_divergente + v_bval where id = v_b;
    end if;
    update lancamentos l set pagamento_bloqueado = true, bloqueio_id = v_b
      from nfe_vinculos v where v.nota_id = n.id and v.lancamento_id = l.id and l.status <> 'Pago';
    update est_recebimentos set bloqueio_id = v_b where id = r.id;
  end if;
  if v_div > 0 then
    select string_agg(i.cprod || ' ' || left(i.xprod, 40) || ': ' || ri.divergencia, E'\n' order by i.n_item) into v_txt
      from est_recebimento_itens ri join nfe_itens i on i.id = ri.nfe_item_id where ri.recebimento_id = r.id and ri.divergencia is not null;
    begin
      perform _notificar_u(r.empresa_id, public._usuarios_papel(r.empresa_id, array['compras', 'admin'] || coalesce(cp.conf_papeis_liberar, array['diretor', 'financeiro'])), 'recebimento',
        case when v_b is not null then 'Pagamento bloqueado: NF ' || n.numero || ' de ' || coalesce(n.emit_nome, n.emit_doc) || ' chegou com divergência'
             else 'Recebimento com divergência: NF ' || n.numero || ' de ' || coalesce(n.emit_nome, n.emit_doc) end,
        left(v_txt, 900), case when v_b is not null then '#/compras/recebimentos?aba=confronto' else '#/estoque/recebimento?r=' || r.id end, r.id, true);
    exception when others then null; end;
  end if;
  return jsonb_build_object('divergencias', v_div, 'lancados', v_lanc, 'data', v_data, 'bloqueado', v_b is not null, 'valor_bloqueado', case when v_b is not null then v_bval end);
end $$;
create or replace function public.compras_confronto_lista(p_empresa uuid, p_de date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_membro(p_empresa) or pode_comprar(p_empresa)) then raise exception 'Acesso negado.'; end if;
  return (select coalesce(jsonb_agg(x order by x ->> 'emissao' desc, x ->> 'numero' desc), '[]') from (
    select jsonb_build_object('nota_id', n.id, 'numero', n.numero, 'serie', n.serie, 'emissao', n.emissao, 'fornecedor', coalesce(fv.nome, n.emit_nome), 'v_nf', n.v_nf,
      'pedidos', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', pd.id, 'numero', pd.numero)), '[]') from compras_recebimentos r join compras_pedidos pd on pd.id = r.pedido_id where r.nfe_nota_id = n.id),
      'divergencias', (select coalesce(jsonb_agg(d), '[]') from (
          select d from compras_recebimentos r, jsonb_array_elements(r.divergencias) d where r.nfe_nota_id = n.id
          union all   -- e as da conferência da chegada (Recebimento de Notas)
          select jsonb_build_object('tipo', 'recebimento', 'texto', 'Conferência da chegada — ' || i.cprod || ' ' || left(i.xprod, 40) || ': ' || ri.divergencia,
                 'bloqueia', b.id is not null and greatest(ri.qtd_nota - (ri.contada - ri.avariada), 0) > 0)
            from est_recebimentos er join est_recebimento_itens ri on ri.recebimento_id = er.id join nfe_itens i on i.id = ri.nfe_item_id
            left join compras_bloqueios b on b.id = er.bloqueio_id
           where er.nota_id = n.id and er.situacao = 'conferido' and ri.divergencia is not null) z(d)),
      'conferencia', (select jsonb_build_object('numero', er.numero, 'data', er.data, 'conferente', er.conferente_nome) from est_recebimentos er where er.nota_id = n.id and er.situacao = 'conferido' limit 1),
      'bloqueio', (select to_jsonb(b) from compras_bloqueios b where b.nota_id = n.id order by b.criado_em desc limit 1),
      'titulos', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'data', l.data, 'valor', l.valor, 'status', l.status, 'bloqueado', l.pagamento_bloqueado) order by l.data), '[]')
                    from nfe_vinculos v join lancamentos l on l.id = v.lancamento_id where v.nota_id = n.id)) x
      from nfe_notas n left join favorecidos fv on fv.id = n.favorecido_id
     where n.empresa_id = p_empresa and n.tipo = 'entrada' and not n.emissao_propria and n.situacao = 'autorizada' and n.emissao >= p_de) z);
end $$;

revoke all on function public.est_receb_concluir(uuid, date, text, boolean), public.compras_confronto_lista(uuid, date) from public, anon;
grant execute on function public.est_receb_concluir(uuid, date, text, boolean), public.compras_confronto_lista(uuid, date) to authenticated;
