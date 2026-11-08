-- =====================================================================
-- Melhoria contínua 2.1 — Conversa ligada ao registro em todos os módulos (07/11/2026)
-- A conversa do registro (SQL 060) existia para lançamento, pagamento antecipado, pedido de compra, OP, frete e proposta
-- FIDC. Passa a valer também para: não conformidade (RNC), inspeção, OS de manutenção, arte, ordem de tinta, carga,
-- recompra FIDC, contrato, beneficiário e nota fiscal. Só entra quem consegue ver o registro (as mesmas regras de cada tela).
-- Recria _chat_ve_registro e _chat_registro_info com todos os tipos. Migração ADITIVA.
-- =====================================================================

create or replace function public._chat_ve_registro(p_tipo text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare e uuid; cp uuid; f uuid;
begin
  case p_tipo
    when 'lancamento' then select empresa_id into e from lancamentos where id = p_id; return e is not null and is_membro(e);
    when 'paraquedas' then select empresa_id, criado_por into e, cp from paraquedas where id = p_id;
      return e is not null and (is_membro(e) or (is_participante(e) and cp = auth.uid()));
    when 'compras_pedido' then select empresa_id into e from compras_pedidos where id = p_id; return e is not null and (is_membro(e) or pode_comprar(e));
    when 'prod_ordem' then select empresa_id into e from prod_ordens where id = p_id; return e is not null and ve_producao(e);
    when 'log_frete' then select empresa_id into e from log_fretes where id = p_id; return e is not null and ve_logistica(e);
    when 'fidc_proposta' then select empresa_id into e from fidc_propostas where id = p_id; return e is not null and is_membro(e);
    -- novos (2.1)
    when 'qual_rnc' then select empresa_id into e from qual_rnc where id = p_id; return e is not null and is_participante(e);
    when 'qual_inspecao' then select empresa_id into e from qual_inspecoes where id = p_id; return e is not null and is_participante(e);
    when 'man_ordem' then select empresa_id into e from man_ordens where id = p_id; return e is not null and ve_producao(e);
    when 'pre_projeto' then select empresa_id, favorecido_id into e, f from pre_projetos where id = p_id; return e is not null and pre_ve(e, f);
    when 'tin_ordem' then select empresa_id into e from tin_ordens where id = p_id; return e is not null and is_participante(e);
    when 'log_carga' then select empresa_id into e from log_cargas where id = p_id; return e is not null and (ve_logistica(e) or pode_logistica(e));
    when 'fidc_recompra' then select empresa_id into e from fidc_recompras where id = p_id; return e is not null and is_membro(e);
    when 'contrato' then select empresa_id into e from contratos where id = p_id; return e is not null and is_admin(e);
    when 'favorecido' then select empresa_id into e from favorecidos where id = p_id; return e is not null and is_membro(e);
    when 'nfe_nota' then select empresa_id into e from nfe_notas where id = p_id; return e is not null and is_membro(e);
    else return false;
  end case;
end $$;

create or replace function public._chat_registro_info(p_tipo text, p_id uuid, out empresa_id uuid, out titulo text, out sub text, out link text)
language plpgsql stable security definer set search_path = public as $$
begin
  case p_tipo
    when 'lancamento' then
      select l.empresa_id, 'Lançamento · ' || coalesce(nullif(l.descricao, ''), f.nome, 'sem descrição'),
             to_char(l.data, 'DD/MM/YYYY') || ' · ' || _chat_reais(l.valor) || ' · ' || coalesce(l.status, ''), '#/lancamentos?abrir=' || l.id
        into empresa_id, titulo, sub, link from lancamentos l left join favorecidos f on f.id = l.favorecido_id where l.id = p_id;
    when 'paraquedas' then
      select p.empresa_id, 'Pagamento antecipado nº ' || p.numero || ' · ' || coalesce(p.razao_social, ''),
             _chat_reais(p.valor) || ' · ' || coalesce(p.status, ''), '#/paraquedas?abrir=' || p.id
        into empresa_id, titulo, sub, link from paraquedas p where p.id = p_id;
    when 'compras_pedido' then
      select c.empresa_id, 'Pedido de compra nº ' || c.numero || coalesce(' · ' || f.nome, ''),
             _chat_reais(c.total) || ' · ' || coalesce(c.status, ''), '#/compras/pedidos?abrir=' || c.id
        into empresa_id, titulo, sub, link from compras_pedidos c left join favorecidos f on f.id = c.favorecido_id where c.id = p_id;
    when 'prod_ordem' then
      select o.empresa_id, 'OP nº ' || o.numero || coalesce(' · ' || nullif(o.descricao, ''), ''),
             trim(to_char(o.quantidade, 'FM999G999G990D###') || ' ' || coalesce(o.unidade, '')) || ' · ' || coalesce(o.status, ''), '#/producao/ordens?abrir=' || o.id
        into empresa_id, titulo, sub, link from prod_ordens o where o.id = p_id;
    when 'log_frete' then
      select f.empresa_id, 'Frete nº ' || f.numero || coalesce(' · ' || f.origem || ' → ' || f.destino, ''),
             _chat_reais(f.valor) || ' · ' || coalesce(f.status, ''), '#/logistica/fretes?abrir=' || f.id
        into empresa_id, titulo, sub, link from log_fretes f where f.id = p_id;
    when 'fidc_proposta' then
      select p.empresa_id, 'Proposta FIDC nº ' || p.numero, _chat_reais(p.valor_face) || ' · ' || coalesce(p.status, ''), '#/fidc-propostas?abrir=' || p.id
        into empresa_id, titulo, sub, link from fidc_propostas p where p.id = p_id;
    -- novos (2.1)
    when 'qual_rnc' then
      select r.empresa_id, 'RNC nº ' || r.numero || ' · ' || left(coalesce(r.descricao, ''), 60),
             coalesce(r.gravidade, '') || ' · ' || coalesce(r.situacao, '') || coalesce(' · ' || f.nome, ''), '#/qualidade/nao-conformidades?abrir=' || r.id
        into empresa_id, titulo, sub, link from qual_rnc r left join favorecidos f on f.id = r.favorecido_id where r.id = p_id;
    when 'qual_inspecao' then
      select i.empresa_id, 'Inspeção nº ' || i.numero || coalesce(' · ' || pr.descricao, ''),
             coalesce(i.etapa, '') || ' · ' || coalesce(i.situacao, '') || coalesce(' · lote ' || i.lote_texto, ''), '#/qualidade/inspecoes?abrir=' || i.id
        into empresa_id, titulo, sub, link from qual_inspecoes i left join produtos pr on pr.id = i.produto_id where i.id = p_id;
    when 'man_ordem' then
      select o.empresa_id, 'OS nº ' || o.numero || coalesce(' · ' || q.nome, ''),
             coalesce(o.tipo, '') || ' · ' || coalesce(o.prioridade, '') || ' · ' || coalesce(o.situacao, ''), '#/manutencao/ordens?abrir=' || o.id
        into empresa_id, titulo, sub, link from man_ordens o left join man_equipamentos q on q.id = o.equipamento_id where o.id = p_id;
    when 'pre_projeto' then
      select a.empresa_id, 'Arte nº ' || a.numero || ' · ' || coalesce(a.nome, ''),
             coalesce(f.nome, '') || ' · ' || coalesce(a.situacao, ''), '#/preimpressao/artes?abrir=' || a.id
        into empresa_id, titulo, sub, link from pre_projetos a left join favorecidos f on f.id = a.favorecido_id where a.id = p_id;
    when 'tin_ordem' then
      select o.empresa_id, 'Ordem de tinta nº ' || o.numero || coalesce(' · ' || c.nome, ''),
             trim(to_char(o.quantidade, 'FM999G990D0##')) || ' kg · ' || coalesce(o.situacao, ''), '#/tintas/ordens?abrir=' || o.id
        into empresa_id, titulo, sub, link from tin_ordens o left join tin_cores c on c.id = o.cor_id where o.id = p_id;
    when 'log_carga' then
      select g.empresa_id, 'Carga nº ' || g.numero || ' · ' || to_char(g.data, 'DD/MM/YYYY'),
             coalesce(g.motorista || ' · ', '') || trim(to_char(coalesce(g.peso_kg, 0), 'FM999G999G990')) || ' kg · ' || coalesce(g.status, ''), '#/logistica'
        into empresa_id, titulo, sub, link from log_cargas g where g.id = p_id;
    when 'fidc_recompra' then
      select r.empresa_id, 'Recompra nº ' || r.numero || ' · ' || coalesce(r.fundo, ''),
             to_char(r.data, 'DD/MM/YYYY') || ' · ' || _chat_reais(r.valor_recompra) || case when r.cancelada then ' · cancelada' else '' end, '#/fidc-recompras'
        into empresa_id, titulo, sub, link from fidc_recompras r where r.id = p_id;
    when 'contrato' then
      select c.empresa_id, 'Contrato nº ' || c.numero || ' · ' || coalesce(nullif(c.parte_nome, ''), f.nome, ''),
             left(coalesce(c.objeto, ''), 60) || ' · ' || coalesce(c.status, ''), '#/contratos'
        into empresa_id, titulo, sub, link from contratos c left join favorecidos f on f.id = c.favorecido_id where c.id = p_id;
    when 'favorecido' then
      select f.empresa_id, 'Beneficiário · ' || f.nome, coalesce(f.tipo, '') || coalesce(' · ' || f.documento, ''), '#/cadastros/favorecidos'
        into empresa_id, titulo, sub, link from favorecidos f where f.id = p_id;
    when 'nfe_nota' then
      select n.empresa_id, 'NF-e nº ' || n.numero || ' · ' || coalesce(case when n.emissao_propria then n.dest_nome else n.emit_nome end, ''),
             to_char(n.emissao, 'DD/MM/YYYY') || ' · ' || _chat_reais(n.v_nf) || ' · ' || coalesce(n.situacao, ''), '#/notas'
        into empresa_id, titulo, sub, link from nfe_notas n where n.id = p_id;
    else null;
  end case;
end $$;

-- conferência: tipos atendidos = 16
select count(*) as tipos from unnest(array['lancamento','paraquedas','compras_pedido','prod_ordem','log_frete','fidc_proposta','qual_rnc','qual_inspecao','man_ordem','pre_projeto','tin_ordem','log_carga','fidc_recompra','contrato','favorecido','nfe_nota']) t
 where position(quote_literal(t) in pg_get_functiondef('public._chat_ve_registro'::regproc)) > 0;
