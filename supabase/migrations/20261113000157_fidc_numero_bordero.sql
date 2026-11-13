-- =====================================================================
-- FIDC: número do borderô padronizado (13/11/2026; Renan: "Porque essa sequência fica diferente entre a 7 e 8 e 9" → "Pode seguir").
--  - A FS numera o borderô pelo Termo Aditivo E pelo contrato: a partir do contrato 000002 (21/10/2026) o número é
--    000001/000002, 000002/000002… (assim estão os da base). O leitor do arquivo guardava só o termo (000008) — corrigido no front.
--  - Aprovação de proposta feita na plataforma: a operação na base FIDC passa a levar o número do borderô do fundo quando a
--    proposta foi ajustada ou comparada ao borderô (espelho ou comparativo); sem isso continua P<nº da proposta>.
--    Se já existir operação do mesmo fundo com esse número, fica P<nº> (não duplica).
-- Só troca a função _aprovar_proposta_fidc (igual à do SQL 154, mudando apenas o número). Não altera dados.
-- =====================================================================
create or replace function public._aprovar_proposta_fidc(p_id uuid, p_motivo text, p_aprovador uuid)
returns text language plpgsql security definer set search_path = public as $$
declare pr fidc_propostas; fu fidc_fundos; n_aberto int; n_itens int; n_sem int; v_origem text; v_op uuid; v_rot text;
        pl_jur uuid; pl_tar uuid; pl_rec uuid; pl_td uuid; pl_tc uuid; v_cc uuid;
        n_chq int; n_chq_ok int; v_chq numeric; cq chq_config; v_bord text;
begin
  select * into pr from fidc_propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada'; end if;
  if pr.status <> 'Pendente' then raise exception 'A proposta nº % não está pendente (status: %)', pr.numero, pr.status; end if;
  select * into fu from fidc_fundos where id = pr.fundo_id;
  if fu.conta_id is null then raise exception 'Cadastre a conta do fundo % antes de aprovar', fu.nome; end if;

  if pr.origem = 'base_fidc' then
    update fidc_proposta_itens i set lancamento_id = x.lid
      from (select distinct on (i2.id) i2.id iid, l.id lid
              from fidc_proposta_itens i2
              join lancamentos l on l.empresa_id = pr.empresa_id and l.fidc_proposta_id is null
                and (l.status = 'Em aberto' or (l.status = 'Pago' and l.conta_id is null))
                and nf_parcela(coalesce(l.documento, l.descricao)) = nf_parcela(i2.documento) and abs(l.valor - i2.valor) <= 0.05
             where i2.proposta_id = p_id and i2.lancamento_id is null and i2.cheque_id is null
               and not exists (select 1 from fidc_proposta_itens o where o.lancamento_id = l.id)
             order by i2.id, (l.status = 'Em aberto') desc, l.data) x
     where i.id = x.iid;
    select count(*) into n_sem from fidc_proposta_itens where proposta_id = p_id and lancamento_id is null and cheque_id is null;
    if n_sem > 0 then raise exception '% título(s) deste borderô ainda não estão lançados em aberto. Gere as contas a receber das notas (Notas Fiscais › Recebimentos × Notas) e aprove de novo.', n_sem; end if;
  end if;

  select count(*), count(*) filter (where (l.status = 'Em aberto' or (pr.origem = 'base_fidc' and l.status = 'Pago' and l.conta_id is null)) and l.fidc_proposta_id is null)
    into n_itens, n_aberto
    from fidc_proposta_itens i join lancamentos l on l.id = i.lancamento_id where i.proposta_id = p_id and i.cheque_id is null;
  select count(*), count(*) filter (where q.situacao = 'carteira' and q.fidc_proposta_id is null and abs(q.valor - i.valor) <= 0.05), coalesce(sum(i.valor), 0)
    into n_chq, n_chq_ok, v_chq
    from fidc_proposta_itens i join chq_cheques q on q.id = i.cheque_id where i.proposta_id = p_id;
  if n_itens = 0 and n_chq = 0 then raise exception 'Proposta sem títulos vinculados'; end if;
  if n_aberto <> n_itens then raise exception '% título(s) já não estão em aberto ou estão em outra proposta', n_itens - n_aberto; end if;
  if n_chq_ok <> n_chq then raise exception '% cheque(s) desta proposta já não estão em carteira', n_chq - n_chq_ok; end if;

  select id into pl_jur from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.08';
  select id into pl_tar from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.32';
  select id into pl_rec from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.11';
  select id into pl_td  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.02.01';
  select id into pl_tc  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.01.01';
  select id into v_cc from centros_custo where empresa_id = pr.empresa_id and nome = 'FINANCEIRO';
  v_origem := 'fidc:proposta:' || pr.numero;
  v_rot := case when pr.origem = 'base_fidc' then format('borderô %s', coalesce(pr.comparativo->>'bordero', ''))
                   when pr.analise ? 'espelho' then format('borderô %s', coalesce(pr.analise->'espelho'->>'bordero', pr.comparativo->>'bordero', ''))
                   else 'estimado' end;

  perform set_config('app.aprovando', 'sim', true);
  update lancamentos l set status = 'Pago', data = pr.data_operacao, conta_id = fu.conta_id, fidc_proposta_id = p_id
    from fidc_proposta_itens i where i.proposta_id = p_id and i.lancamento_id = l.id and i.cheque_id is null;

  if n_chq > 0 then
    select * into cq from chq_config where empresa_id = pr.empresa_id;
    if cq.conta_carteira_id is null or coalesce(cq.plano_transferencia_id, pl_td) is null then raise exception 'Configure o Controle de Cheques (conta Cheques em carteira) antes de aprovar borderô com cheques'; end if;
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, conta_destino_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, coalesce(cq.plano_transferencia_id, pl_td), format('%s — %s cheque(s) da proposta nº %s', fu.nome, n_chq, pr.numero), v_cc, 'Pago', cq.conta_carteira_id, fu.conta_id, v_chq, v_origem, p_id);
    insert into chq_eventos(empresa_id, cheque_id, tipo, data, detalhe)
      select pr.empresa_id, i.cheque_id, 'enviado ao FIDC', pr.data_operacao, format('%s · proposta nº %s', fu.nome, pr.numero) from fidc_proposta_itens i where i.proposta_id = p_id and i.cheque_id is not null;
    update chq_cheques q set situacao = 'fidc', fidc_proposta_id = p_id, fundo = fu.nome from fidc_proposta_itens i where i.proposta_id = p_id and i.cheque_id = q.id;
  end if;

  if pl_jur is not null and pr.desagio > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_jur, format('%s — deságio proposta nº %s (%s)', fu.nome, pr.numero, v_rot), v_cc, 'Pago', fu.conta_id, pr.desagio, v_origem, p_id);
  end if;
  if pl_tar is not null and pr.ad_valorem + pr.tarifas + pr.iof > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_tar, format('%s — tarifas/IOF proposta nº %s (%s)', fu.nome, pr.numero, v_rot), v_cc, 'Pago', fu.conta_id, pr.ad_valorem + pr.tarifas + pr.iof, v_origem, p_id);
  end if;
  if pl_rec is not null and pr.recompras > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_rec, format('%s — recompras descontadas proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.recompras, v_origem, p_id);
  end if;
  if pl_td is not null and pr.liquido > 0 and coalesce(pr.conta_credito_id, fu.conta_credito_id) is not null then
    -- transferência única: sai da conta do fundo e entra na conta de crédito, num lançamento só
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, conta_destino_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_td, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, coalesce(pr.conta_credito_id, fu.conta_credito_id), pr.liquido, v_origem, p_id);
  end if;

  if pr.origem = 'base_fidc' and pr.operacao_id is not null then
    v_op := pr.operacao_id;
  else
    -- número do borderô do fundo quando a proposta já foi conferida/ajustada ao borderô; sem ele, P<nº da proposta>
    v_bord := coalesce(nullif(trim(pr.analise->'espelho'->>'bordero'), ''), nullif(trim(pr.comparativo->>'bordero'), ''), 'P' || pr.numero);
    if v_bord <> 'P' || pr.numero and exists (select 1 from fidc_operacoes where empresa_id = pr.empresa_id and fundo = fu.nome and bordero = v_bord) then
      v_bord := 'P' || pr.numero;   -- já existe operação com esse número: não duplica
    end if;
    insert into fidc_operacoes(empresa_id, fundo, data, bordero, arquivo, conta_id, qtd_titulos, valor_face, desagio, ad_valorem, tarifas, iof,
                               encargos, recompra, desc_sacado, liquido, prazo_medio, prazo_cobrado, observacao)
    values (pr.empresa_id, fu.nome, pr.data_operacao, v_bord, 'Proposta nº ' || pr.numero || case when pr.analise ? 'espelho' then ' (espelho do borderô ' || coalesce(pr.analise->'espelho'->>'bordero', '') || ')' else ' (plataforma)' end, fu.conta_id, pr.qtd_titulos,
            pr.valor_face, pr.desagio, pr.ad_valorem, pr.tarifas, pr.iof, 0, pr.recompras, 0, pr.liquido, pr.prazo_medio, pr.prazo_cobrado,
            nullif(concat_ws('; ', pr.observacao, p_motivo), ''))
    returning id into v_op;
    insert into fidc_titulos(empresa_id, operacao_id, fundo, bordero, data_operacao, titulo, vencimento, valor, cnpj_sacado, sacado, sacado_agrupado)
    select pr.empresa_id, v_op, fu.nome, v_bord, pr.data_operacao, i.documento, i.vencimento, i.valor, i.cnpj, i.sacado, i.sacado
      from fidc_proposta_itens i where i.proposta_id = p_id;
  end if;

  update fidc_propostas set status = 'Aprovada', motivo = p_motivo, aprovado_por = p_aprovador, aprovado_em = now(), operacao_id = v_op where id = p_id;
  return 'Aprovada';
end $$;
revoke execute on function public._aprovar_proposta_fidc(uuid, text, uuid) from anon, authenticated, public;
