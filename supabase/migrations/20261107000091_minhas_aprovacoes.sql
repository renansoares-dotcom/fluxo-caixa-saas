-- =====================================================================
-- Melhoria contínua 1.3 — "Minhas aprovações" (07/11/2026): tudo o que espera a decisão de quem está logado, numa lista só.
-- Cada tipo entra só para quem pode decidir (as mesmas regras das telas de origem). A decisão continua sendo feita pelas
-- funções e regras de cada módulo (nada é decidido por fora delas): esta migração só LÊ. Migração ADITIVA.
-- Tipos: pa (pagamento antecipado), pedido e requisicao (compras), bordero (FIDC), decisao_dia, prorrogacao (Portal),
--        reajuste (contrato), receita (casa de tintas), arte (liberar para a produção), inspecao (qualidade).
-- =====================================================================
create or replace function public.minhas_aprovacoes(p_empresa uuid)
returns table(tipo text, id uuid, numero int, titulo text, detalhe text, valor numeric, desde timestamptz, prazo date, urgente boolean, link text, lote boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_participante(p_empresa) then return; end if;
  -- pagamentos antecipados aguardando autorização
  if pode_aprovar_paraquedas(p_empresa) then
    return query select 'pa'::text, x.id, x.numero, x.razao_social, coalesce(x.descricao, ''), x.valor, x.criado_em, x.data_pagamento, x.prioridade = 'urgente', '#/paraquedas'::text, true
      from paraquedas x where x.empresa_id = p_empresa and x.status = 'aguardando';
  end if;
  -- compras: pedidos aguardando aprovação e requisições pendentes
  if pode_aprovar_compra(p_empresa) then
    return query select 'pedido'::text, x.id, x.numero, coalesce(f.nome, 'Fornecedor'), coalesce(x.condicao_pagamento, '') || case when x.plano_id is null then ' · sem classificação: aprovar na tela' else '' end,
           x.total, x.criado_em, x.entrega_prevista, false, '#/compras/pedidos?abrir=' || x.id, x.plano_id is not null
      from compras_pedidos x left join favorecidos f on f.id = x.favorecido_id where x.empresa_id = p_empresa and x.status = 'aguardando';
    return query select 'requisicao'::text, x.id, x.numero, 'Requisição de ' || coalesce(x.solicitante, '—'), coalesce(x.observacao, ''), null::numeric, x.criado_em, x.necessidade, x.prioridade = 'urgente', '#/compras/requisicoes'::text, true
      from compras_requisicoes x where x.empresa_id = p_empresa and x.status = 'pendente';
  end if;
  -- borderôs (só o diretor decide)
  if is_diretor(p_empresa) then
    return query select 'bordero'::text, x.id, x.numero, 'Borderô — ' || coalesce(fu.nome, 'fundo'), x.qtd_titulos || ' título(s) · líquido R$ ' || translate(to_char(x.liquido, 'FM999,999,999,990.00'), ',.', '.,'),
           x.valor_face, x.criado_em, x.data_operacao, false, '#/fidc-propostas?abrir=' || x.id, true
      from fidc_propostas x left join fidc_fundos fu on fu.id = x.fundo_id where x.empresa_id = p_empresa and x.status = 'Pendente';
  end if;
  -- decisão do dia (diretor ou admin)
  if exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('diretor', 'admin')) then
    return query select 'decisao_dia'::text, x.id, x.numero, 'Decisão do dia ' || to_char(x.data, 'DD/MM'), 'Saídas R$ ' || translate(to_char(x.saidas, 'FM999,999,999,990.00'), ',.', '.,') || ' · saldo final R$ ' || translate(to_char(x.saldo_fim, 'FM999,999,999,990.00'), ',.', '.,'),
           x.saidas, x.criado_em, x.data, false, '#/decisao-dia?dia=' || x.data, true
      from decisoes_dia x where x.empresa_id = p_empresa and x.status = 'Pendente';
  end if;
  -- prorrogações pedidas no Portal (admin ou financeiro)
  if pode_editar(p_empresa) then
    return query select 'prorrogacao'::text, x.id, null::int, coalesce(f.nome, 'Cliente'), coalesce(x.documento, '') || ' · de ' || to_char(x.vencimento_atual, 'DD/MM') || ' para ' || to_char(x.nova_data, 'DD/MM') || ' · ' || x.motivo,
           x.valor, x.solicitado_em, x.vencimento_atual, false, '#/portal-clientes'::text, true
      from portal_prorrogacoes x left join favorecidos f on f.id = x.favorecido_id where x.empresa_id = p_empresa and x.status = 'pendente';
  end if;
  -- reajustes de contrato propostos (admin)
  if is_admin(p_empresa) then
    return query select 'reajuste'::text, x.id, c.numero, 'Reajuste — ' || c.objeto, x.indice || ' ' || replace(to_char(x.percentual, 'FM990.00'), '.', ',') || '% · de R$ ' || translate(to_char(x.valor_anterior, 'FM999,999,990.00'), ',.', '.,') || ' para R$ ' || translate(to_char(x.valor_novo, 'FM999,999,990.00'), ',.', '.,'),
           x.valor_novo, x.proposto_em, x.data_base, false, '#/contratos'::text, true
      from contrato_reajustes x join contratos c on c.id = x.contrato_id where x.empresa_id = p_empresa and x.status = 'proposto';
  end if;
  -- receitas de tinta em teste
  if to_regclass('public.tin_versoes') is not null and tin_pode_aprovar(p_empresa) then
    return query select 'receita'::text, v.id, v.numero, r.codigo || ' — ' || r.nome, 'Versão ' || v.numero || ' em teste' || coalesce(' · ' || v.observacao, ''), null::numeric, v.criado_em, null::date, false, '#/tintas/receitas'::text, true
      from tin_versoes v join tin_receitas r on r.id = v.receita_id where v.empresa_id = p_empresa and v.situacao = 'em_teste';
  end if;
  -- artes aprovadas pelo cliente esperando liberação para a produção
  if to_regclass('public.pre_projetos') is not null and pre_pode_liberar(p_empresa) then
    return query select 'arte'::text, x.id, x.numero, x.nome, coalesce(f.nome, '') || case when x.situacao = 'na_clicheria' then ' · clichês recebidos' else ' · aprovada pelo cliente' end,
           null::numeric, x.atualizado_em, x.prazo, false, '#/preimpressao/artes?abrir=' || x.id, true
      from pre_projetos x left join favorecidos f on f.id = x.favorecido_id
     where x.empresa_id = p_empresa and not x.arquivado and (x.situacao = 'aprovada' or (x.situacao = 'na_clicheria' and x.cliche_recebido_em is not null));
  end if;
  -- inspeções da qualidade que esperam a decisão (decide na tela: exige olhar os resultados)
  if to_regclass('public.qual_inspecoes') is not null and qual_pode_decidir(p_empresa) then
    return query select 'inspecao'::text, x.id, x.numero, 'Inspeção ' || x.etapa || coalesce(' — ' || p.descricao, ''), coalesce(x.lote_texto, ''), null::numeric, x.criado_em, x.prazo::date, false, '#/qualidade/inspecoes?abrir=' || x.id, false
      from qual_inspecoes x left join produtos p on p.id = x.produto_id where x.empresa_id = p_empresa and x.situacao = 'em_inspecao';
  end if;
end $$;
revoke all on function public.minhas_aprovacoes(uuid) from public, anon;
grant execute on function public.minhas_aprovacoes(uuid) to authenticated;

-- conferência: funcao = 1
select count(*) as funcao from pg_proc where proname = 'minhas_aprovacoes';
