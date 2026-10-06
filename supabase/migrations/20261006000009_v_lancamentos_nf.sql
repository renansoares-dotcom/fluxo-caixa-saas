-- v_lancamentos passa a expor NF-parcela (documento), emissão e a proposta FIDC do título
create or replace view public.v_lancamentos with (security_invoker = on) as
 SELECT l.id, l.empresa_id, l.data, l.plano_id, l.descricao, l.opc1, l.opc2, l.opc3, l.opc4, l.favorecido_id, l.centro_custo_id,
    l.status, l.conta_id, l.valor, l.prioridade, l.origem, l.created_by, l.created_at, l.updated_at,
    (EXTRACT(year FROM l.data))::integer AS ano,
    (EXTRACT(month FROM l.data))::integer AS mes,
    CASE WHEN (p.natureza = 'C'::bpchar) THEN l.valor ELSE (- l.valor) END AS valor_sinal,
    p.codigo AS plano_codigo, p.nome AS plano_nome, p.tipo,
    c1.id AS classe_id, c1.codigo AS classe_codigo, c1.nome AS classe_nome,
    COALESCE(c1.prioridade, 'Negociável'::text) AS prioridade_classe,
    COALESCE(l.prioridade, c1.prioridade, 'Negociável'::text) AS prioridade_efetiva,
    f.nome AS favorecido_nome, f.sigla AS favorecido_sigla,
    cc.nome AS centro_custo_nome, ct.nome AS conta_nome, ct.grupo_id, ct.disponibilidade, g.nome AS grupo_nome,
    l.documento, l.emissao, l.fidc_proposta_id
   FROM lancamentos l
     JOIN plano_contas p ON p.id = l.plano_id
     LEFT JOIN plano_contas c1 ON c1.id = p.pai_id
     LEFT JOIN favorecidos f ON f.id = l.favorecido_id
     LEFT JOIN centros_custo cc ON cc.id = l.centro_custo_id
     LEFT JOIN contas ct ON ct.id = l.conta_id
     LEFT JOIN grupos g ON g.id = ct.grupo_id;
