-- Aprovação separada em função interna (sem checar quem aprova), usada pela decidir_proposta_fidc (diretor)
-- e por aprovações registradas pelo administrador fora da tela (ex.: borderôs de setembro, autorizados pelo Renan em 08/10).
create or replace function public._aprovar_proposta_fidc(p_id uuid, p_motivo text, p_aprovador uuid)
returns text language plpgsql security definer set search_path = public as $$
declare pr fidc_propostas; fu fidc_fundos; n_aberto int; n_itens int; n_sem int; v_origem text; v_op uuid; v_rot text;
        pl_jur uuid; pl_tar uuid; pl_rec uuid; pl_td uuid; pl_tc uuid; v_cc uuid;
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
             where i2.proposta_id = p_id and i2.lancamento_id is null
               and not exists (select 1 from fidc_proposta_itens o where o.lancamento_id = l.id)
             order by i2.id, (l.status = 'Em aberto') desc, l.data) x
     where i.id = x.iid;
    select count(*) into n_sem from fidc_proposta_itens where proposta_id = p_id and lancamento_id is null;
    if n_sem > 0 then raise exception '% título(s) deste borderô ainda não estão lançados em aberto. Gere as contas a receber das notas (Notas Fiscais › Recebimentos × Notas) e aprove de novo.', n_sem; end if;
  end if;

  select count(*), count(*) filter (where (l.status = 'Em aberto' or (pr.origem = 'base_fidc' and l.status = 'Pago' and l.conta_id is null)) and l.fidc_proposta_id is null)
    into n_itens, n_aberto
    from fidc_proposta_itens i join lancamentos l on l.id = i.lancamento_id where i.proposta_id = p_id;
  if n_itens = 0 then raise exception 'Proposta sem títulos vinculados'; end if;
  if n_aberto <> n_itens then raise exception '% título(s) já não estão em aberto ou estão em outra proposta', n_itens - n_aberto; end if;

  select id into pl_jur from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.08';
  select id into pl_tar from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.32';
  select id into pl_rec from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.11';
  select id into pl_td  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.02.01';
  select id into pl_tc  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.01.01';
  select id into v_cc from centros_custo where empresa_id = pr.empresa_id and nome = 'FINANCEIRO';
  v_origem := 'fidc:proposta:' || pr.numero;
  v_rot := case when pr.origem = 'base_fidc' then format('borderô %s', coalesce(pr.comparativo->>'bordero', '')) else 'estimado' end;

  perform set_config('app.aprovando', 'sim', true);
  update lancamentos l set status = 'Pago', data = pr.data_operacao, conta_id = fu.conta_id, fidc_proposta_id = p_id
    from fidc_proposta_itens i where i.proposta_id = p_id and i.lancamento_id = l.id;

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
  if pl_td is not null and pl_tc is not null and pr.liquido > 0 and coalesce(pr.conta_credito_id, fu.conta_credito_id) is not null then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_td, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.liquido, v_origem, p_id),
           (pr.empresa_id, pr.data_operacao, pl_tc, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', coalesce(pr.conta_credito_id, fu.conta_credito_id), pr.liquido, v_origem, p_id);
  end if;

  if pr.origem = 'base_fidc' and pr.operacao_id is not null then
    v_op := pr.operacao_id;
  else
    insert into fidc_operacoes(empresa_id, fundo, data, bordero, arquivo, conta_id, qtd_titulos, valor_face, desagio, ad_valorem, tarifas, iof,
                               encargos, recompra, desc_sacado, liquido, prazo_medio, prazo_cobrado, observacao)
    values (pr.empresa_id, fu.nome, pr.data_operacao, 'P' || pr.numero, 'Proposta nº ' || pr.numero || ' (plataforma)', fu.conta_id, pr.qtd_titulos,
            pr.valor_face, pr.desagio, pr.ad_valorem, pr.tarifas, pr.iof, 0, pr.recompras, 0, pr.liquido, pr.prazo_medio, pr.prazo_cobrado,
            nullif(concat_ws('; ', pr.observacao, p_motivo), ''))
    returning id into v_op;
    insert into fidc_titulos(empresa_id, operacao_id, fundo, bordero, data_operacao, titulo, vencimento, valor, cnpj_sacado, sacado, sacado_agrupado)
    select pr.empresa_id, v_op, fu.nome, 'P' || pr.numero, pr.data_operacao, i.documento, i.vencimento, i.valor, i.cnpj, i.sacado, i.sacado
      from fidc_proposta_itens i where i.proposta_id = p_id;
  end if;

  update fidc_propostas set status = 'Aprovada', motivo = p_motivo, aprovado_por = p_aprovador, aprovado_em = now(), operacao_id = v_op where id = p_id;
  return 'Aprovada';
end $$;
revoke execute on function public._aprovar_proposta_fidc(uuid, text, uuid) from anon, authenticated, public;

create or replace function public.decidir_proposta_fidc(p_id uuid, p_aprovar boolean, p_motivo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare pr fidc_propostas;
begin
  select * into pr from fidc_propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada'; end if;
  if not is_diretor(pr.empresa_id) then raise exception 'Somente o diretor pode aprovar ou rejeitar propostas'; end if;
  if pr.status <> 'Pendente' then raise exception 'A proposta nº % não está pendente (status: %)', pr.numero, pr.status; end if;
  if not p_aprovar then
    update fidc_propostas set status = 'Rejeitada', motivo = p_motivo, aprovado_por = auth.uid(), aprovado_em = now() where id = p_id;
    return 'Rejeitada';
  end if;
  return _aprovar_proposta_fidc(p_id, p_motivo, auth.uid());
end $$;
revoke execute on function public.decidir_proposta_fidc(uuid, boolean, text) from anon, public;
grant execute on function public.decidir_proposta_fidc(uuid, boolean, text) to authenticated;
