-- Relatórios agendados (melhoria 1.7 do plano de melhoria contínua, Passo 5) — 08/11/2026.
-- Aditivo. Um relatório agendado é uma lista de blocos (cada bloco = uma consulta do catálogo da Pergunte à plataforma:
-- fonte, medida, agrupamento, filtros e um período relativo, como "mês anterior" ou "próximos 7 dias") enviada por e-mail
-- aos destinatários escolhidos, na frequência escolhida (todo dia, dias úteis, semanal ou mensal, na hora escolhida, Recife).
--   • nova fonte "saldos" no catálogo (posição de caixa das contas, a receber e a pagar), também para a IA;
--   • o e-mail traz as tabelas no corpo (o modelo "relatorio_agendado" é editável em E-mail e modelos) e o link da tela;
--   • quem cria ou salvou por último (administrador, diretor ou financeiro) é o "dono": a consulta roda com o acesso dele; se ele perder o acesso,
--     o envio para e registra o erro;
--   • modelos prontos na tela (posição de caixa diária, contas a pagar da semana, faturamento, despesas, produção, fretes).

-- 1) catálogo e consulta com a fonte "saldos" (recriadas; o resto igual ao SQL 137)
create or replace function public.ia_catalogo() returns jsonb language sql immutable as $$
select '{
 "saldos": {"descricao": "Posição de caixa: saldo das contas bancárias ativas (pagos até a data final), e o que está em aberto a receber e a pagar em cada conta. Use só a data final (ate); sem ela, hoje.",
   "link": "#/fluxo-diario", "rotulo": "Fluxo de Caixa Diário",
   "metricas": {"saldo": "saldo realizado das contas", "a_receber": "em aberto a receber", "a_pagar": "em aberto a pagar"},
   "agrupar": {"conta": "conta bancária", "grupo": "grupo de contas", "disponibilidade": "disponibilidade da conta"},
   "filtros": {"conta": "parte do nome da conta", "disponibilidade": "parte da disponibilidade"}},
 "lancamentos": {"descricao": "Lançamentos do financeiro (contas a pagar e a receber, pagos e em aberto), pela data do lançamento. Valor sempre positivo; o tipo diz se é entrada (receita/recebimento) ou saída (despesa/pagamento). Transferências entre contas aparecem como saída e entrada; exclua com excluir_transferencias.",
   "link": "#/lancamentos", "rotulo": "Lançamentos",
   "metricas": {"valor": "soma dos valores", "saldo": "entradas menos saídas", "quantidade": "número de lançamentos", "media": "valor médio"},
   "agrupar": {"mes": "mês (AAAA-MM)", "ano": "ano", "dia": "dia", "plano": "conta do plano de contas (nível 2)", "classe": "classe do plano (nível 1)", "favorecido": "cliente/fornecedor/beneficiário", "centro_custo": "centro de custo", "conta": "conta bancária", "status": "Pago ou Em aberto", "tipo": "entrada ou saída"},
   "filtros": {"status": "Pago | Em aberto", "tipo": "entrada | saida", "plano": "código ou início do código do plano (ex.: 2.03)", "plano_nome": "parte do nome da conta do plano", "favorecido": "parte do nome", "centro_custo": "parte do nome", "conta": "parte do nome da conta bancária", "texto": "parte da descrição", "excluir_transferencias": "true para tirar as transferências entre contas"}},
 "notas": {"descricao": "Notas fiscais eletrônicas autorizadas (faturamento = saída própria; compras = entrada), pela data de emissão. Valor = valor total da nota.",
   "link": "#/notas", "rotulo": "Notas Fiscais",
   "metricas": {"valor": "valor total das notas", "produtos": "valor dos produtos", "frete": "frete destacado na nota", "icms": "ICMS", "ipi": "IPI", "quantidade": "número de notas", "ticket": "valor médio por nota"},
   "agrupar": {"mes": "mês", "ano": "ano", "dia": "dia", "cliente": "destinatário da nota", "fornecedor": "emitente da nota", "uf": "UF do destinatário", "natureza": "natureza da operação", "cfop": "primeiro CFOP da nota"},
   "filtros": {"tipo": "saida | entrada", "propria": "true = emitida pela empresa", "cliente": "parte do nome do destinatário", "fornecedor": "parte do nome do emitente", "uf": "sigla da UF", "cfop": "CFOP ou início (ex.: 5101, 61)", "natureza": "parte da natureza da operação"}},
 "fretes": {"descricao": "Fretes contratados de terceiros (Fretes e CIOT), não cancelados, pela data do frete.",
   "link": "#/logistica/fretes", "rotulo": "Fretes e CIOT",
   "metricas": {"valor": "valor dos fretes", "pedagio": "pedágio", "km": "quilômetros", "quantidade": "número de fretes", "media": "valor médio do frete"},
   "agrupar": {"mes": "mês", "ano": "ano", "transportador": "transportadora", "destino": "destino", "placa": "placa"},
   "filtros": {"transportador": "parte do nome", "destino": "parte do destino"}},
 "compras": {"descricao": "Pedidos de compra não cancelados, pela data do pedido. Valor = total do pedido.",
   "link": "#/compras/pedidos", "rotulo": "Pedidos de compra",
   "metricas": {"valor": "valor dos pedidos", "quantidade": "número de pedidos", "media": "valor médio"},
   "agrupar": {"mes": "mês", "ano": "ano", "fornecedor": "fornecedor", "status": "situação do pedido"},
   "filtros": {"fornecedor": "parte do nome", "status": "rascunho | aprovacao | aprovado | enviado | recebido_parcial | recebido"}},
 "producao": {"descricao": "Apontamentos de produção (quilos bons, refugo e horas) por máquina e setor, pela data de início.",
   "link": "#/producao", "rotulo": "Painel de Produção",
   "metricas": {"kg": "quilos bons produzidos", "refugo": "quilos de refugo/apara", "refugo_pct": "refugo em % do total", "horas": "horas apontadas", "quantidade": "número de apontamentos"},
   "agrupar": {"mes": "mês", "ano": "ano", "dia": "dia", "maquina": "máquina", "setor": "setor", "turno": "turno", "operador": "operador"},
   "filtros": {"maquina": "parte do nome", "setor": "parte do nome", "turno": "turno"}}
}'::jsonb
$$;

create or replace function public.ia_consultar(p_empresa uuid, p_fonte text, p_metrica text, p_agrupar text default null,
  p_filtros jsonb default '{}'::jsonb, p_de date default null, p_ate date default null, p_ordem text default null, p_limite int default 30)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare cat jsonb := ia_catalogo() -> p_fonte; v_from text; v_data text; v_where text; v_dim text; v_met text; v_sql text; v_linhas jsonb; v_total numeric;
  f jsonb := coalesce(p_filtros, '{}'::jsonb); k text; v text; v_tempo boolean; v_lim int := least(greatest(coalesce(p_limite, 30), 1), 100); v_n int;
begin
  if not is_membro(p_empresa) then raise exception 'Acesso negado.'; end if;
  if cat is null then raise exception 'Fonte desconhecida: %. Use uma de: %', p_fonte, (select string_agg(x, ', ') from jsonb_object_keys(ia_catalogo()) x); end if;
  if not (cat -> 'metricas') ? coalesce(p_metrica, '') then raise exception 'Medida % não existe em %. Use: %', p_metrica, p_fonte, (select string_agg(x, ', ') from jsonb_object_keys(cat -> 'metricas') x); end if;
  if p_agrupar is not null and not (cat -> 'agrupar') ? p_agrupar then raise exception 'Agrupamento % não existe em %. Use: %', p_agrupar, p_fonte, (select string_agg(x, ', ') from jsonb_object_keys(cat -> 'agrupar') x); end if;
  for k in select jsonb_object_keys(f) loop
    if not (cat -> 'filtros') ? k then raise exception 'Filtro % não existe em %. Use: %', k, p_fonte, (select string_agg(x, ', ') from jsonb_object_keys(cat -> 'filtros') x); end if;
  end loop;
  if p_fonte = 'saldos' then   -- posição de caixa: pelas pontas das transferências (saldos_contas), até a data final
    select coalesce(jsonb_agg(jsonb_build_array(kk, round(coalesce(mm, 0), 2)) order by o), '[]'::jsonb), count(*), sum(mm) into v_linhas, v_n, v_total
      from (select kk, mm, row_number() over (order by case when p_ordem = 'chave' then kk end, case when p_ordem = 'menor' then mm end asc nulls last, mm desc nulls last, kk) o
              from (select case p_agrupar when 'conta' then s.nome when 'grupo' then coalesce(s.grupo, '—') when 'disponibilidade' then coalesce(s.disponibilidade, '—') else 'Total' end kk,
                           sum(case p_metrica when 'saldo' then s.saldo_pago when 'a_receber' then s.a_receber else s.a_pagar end) mm
                      from saldos_contas(p_empresa, coalesce(p_ate, current_date)) s
                     where (f ->> 'conta' is null or s.nome ilike '%' || (f ->> 'conta') || '%')
                       and (f ->> 'disponibilidade' is null or s.disponibilidade ilike '%' || (f ->> 'disponibilidade') || '%')
                     group by 1) y) z where o <= v_lim;
    return jsonb_build_object('fonte', p_fonte, 'metrica', p_metrica, 'metrica_nome', cat -> 'metricas' ->> p_metrica, 'agrupar', p_agrupar,
      'agrupar_nome', cat -> 'agrupar' ->> p_agrupar, 'filtros', f, 'de', null, 'ate', coalesce(p_ate, current_date), 'linhas', v_linhas, 'n', v_n,
      'total', round(coalesce(v_total, 0), 2), 'link', cat ->> 'link', 'rotulo', cat ->> 'rotulo');
  end if;
  v_where := '';
  -- fonte: tabela, coluna de data, agrupamentos, medidas e filtros (só nomes fixos; valores com %L)
  case p_fonte
  when 'lancamentos' then
    v_from := 'v_lancamentos t'; v_data := 't.data';
    v_dim := case p_agrupar when 'plano' then 't.plano_codigo || '' '' || t.plano_nome' when 'classe' then 'coalesce(t.classe_codigo || '' '' || t.classe_nome, ''—'')'
      when 'favorecido' then 'coalesce(t.favorecido_nome, ''(sem favorecido)'')' when 'centro_custo' then 'coalesce(t.centro_custo_nome, ''(sem centro de custo)'')'
      when 'conta' then 'coalesce(t.conta_nome, ''(sem conta)'')' when 'status' then 't.status' when 'tipo' then 'case when t.valor_sinal >= 0 then ''entrada'' else ''saída'' end' end;
    v_met := case p_metrica when 'valor' then 'sum(t.valor)' when 'saldo' then 'sum(t.valor_sinal)' when 'quantidade' then 'count(*)' when 'media' then 'avg(t.valor)' end;
    for k, v in select key, value #>> '{}' from jsonb_each(f) loop
      v_where := v_where || case k
        when 'status' then format(' and t.status = %L', v)
        when 'tipo' then case when lower(v) like 'entr%' then ' and t.valor_sinal >= 0' else ' and t.valor_sinal < 0' end
        when 'plano' then format(' and t.plano_codigo like %L', v || '%')
        when 'plano_nome' then format(' and t.plano_nome ilike %L', '%' || v || '%')
        when 'favorecido' then format(' and t.favorecido_nome ilike %L', '%' || v || '%')
        when 'centro_custo' then format(' and t.centro_custo_nome ilike %L', '%' || v || '%')
        when 'conta' then format(' and t.conta_nome ilike %L', '%' || v || '%')
        when 'texto' then format(' and t.descricao ilike %L', '%' || v || '%')
        when 'excluir_transferencias' then case when lower(v) in ('true', 'sim', '1') then ' and t.conta_destino_id is null and t.plano_codigo not like ''3.%''' else '' end
        else '' end;
    end loop;
  when 'notas' then
    v_from := 'nfe_notas t'; v_data := 't.emissao'; v_where := ' and t.situacao = ''autorizada''';
    v_dim := case p_agrupar when 'cliente' then 'coalesce(t.dest_nome, ''—'')' when 'fornecedor' then 'coalesce(t.emit_nome, ''—'')' when 'uf' then 'coalesce(t.dest_uf, ''—'')'
      when 'natureza' then 'coalesce(t.natureza, ''—'')' when 'cfop' then 'coalesce(t.cfops[1], ''—'')' end;
    v_met := case p_metrica when 'valor' then 'sum(t.v_nf)' when 'produtos' then 'sum(t.v_prod)' when 'frete' then 'sum(t.v_frete)' when 'icms' then 'sum(t.v_icms)'
      when 'ipi' then 'sum(t.v_ipi)' when 'quantidade' then 'count(*)' when 'ticket' then 'avg(t.v_nf)' end;
    for k, v in select key, value #>> '{}' from jsonb_each(f) loop
      v_where := v_where || case k
        when 'tipo' then format(' and t.tipo = %L', case when lower(v) like 'entr%' then 'entrada' else 'saida' end)
        when 'propria' then format(' and t.emissao_propria = %L', lower(v) in ('true', 'sim', '1'))
        when 'cliente' then format(' and t.dest_nome ilike %L', '%' || v || '%')
        when 'fornecedor' then format(' and t.emit_nome ilike %L', '%' || v || '%')
        when 'uf' then format(' and t.dest_uf = %L', upper(v))
        when 'cfop' then format(' and exists (select 1 from unnest(t.cfops) c where c like %L)', v || '%')
        when 'natureza' then format(' and t.natureza ilike %L', '%' || v || '%')
        else '' end;
    end loop;
  when 'fretes' then
    v_from := 'log_fretes t left join log_transportadores tr on tr.id = t.transportador_id'; v_data := 't.data'; v_where := ' and t.status <> ''cancelado''';
    v_dim := case p_agrupar when 'transportador' then 'coalesce(tr.nome, ''—'')' when 'destino' then 'coalesce(upper(t.destino), ''—'')' when 'placa' then 'coalesce(t.placa, ''—'')' end;
    v_met := case p_metrica when 'valor' then 'sum(coalesce(t.valor, 0))' when 'pedagio' then 'sum(coalesce(t.pedagio_valor, 0))' when 'km' then 'sum(coalesce(t.km, 0))'
      when 'quantidade' then 'count(*)' when 'media' then 'avg(t.valor)' end;
    for k, v in select key, value #>> '{}' from jsonb_each(f) loop
      v_where := v_where || case k when 'transportador' then format(' and tr.nome ilike %L', '%' || v || '%') when 'destino' then format(' and t.destino ilike %L', '%' || v || '%') else '' end;
    end loop;
  when 'compras' then
    v_from := 'compras_pedidos t left join favorecidos fv on fv.id = t.favorecido_id'; v_data := 't.data_pedido'; v_where := ' and t.status <> ''cancelado''';
    v_dim := case p_agrupar when 'fornecedor' then 'coalesce(fv.nome, ''—'')' when 'status' then 't.status' end;
    v_met := case p_metrica when 'valor' then 'sum(t.total)' when 'quantidade' then 'count(*)' when 'media' then 'avg(t.total)' end;
    for k, v in select key, value #>> '{}' from jsonb_each(f) loop
      v_where := v_where || case k when 'fornecedor' then format(' and fv.nome ilike %L', '%' || v || '%') when 'status' then format(' and t.status = %L', v) else '' end;
    end loop;
  when 'producao' then
    v_from := 'prod_apontamentos t left join prod_maquinas m on m.id = t.maquina_id left join prod_setores s on s.id = t.setor_id'; v_data := '(t.inicio at time zone ''America/Recife'')::date';
    v_dim := case p_agrupar when 'maquina' then 'coalesce(m.nome, ''—'')' when 'setor' then 'coalesce(s.nome, ''—'')' when 'turno' then 'coalesce(t.turno, ''—'')' when 'operador' then 'coalesce(t.operador_nome, ''—'')' end;
    v_met := case p_metrica when 'kg' then 'sum(t.qtd_boa)' when 'refugo' then 'sum(t.refugo)' when 'refugo_pct' then 'round(100 * sum(t.refugo) / nullif(sum(t.qtd_boa + t.refugo), 0), 2)'
      when 'horas' then 'round(sum(extract(epoch from (coalesce(t.fim, t.inicio) - t.inicio)) / 3600)::numeric, 1)' when 'quantidade' then 'count(*)' end;
    for k, v in select key, value #>> '{}' from jsonb_each(f) loop
      v_where := v_where || case k when 'maquina' then format(' and m.nome ilike %L', '%' || v || '%') when 'setor' then format(' and s.nome ilike %L', '%' || v || '%')
        when 'turno' then format(' and t.turno = %L', v) else '' end;
    end loop;
  end case;
  -- agrupamentos de tempo valem para todas as fontes
  v_tempo := p_agrupar in ('mes', 'ano', 'dia');
  if v_tempo then v_dim := case p_agrupar when 'mes' then format('to_char(%s, ''YYYY-MM'')', v_data) when 'ano' then format('extract(year from %s)::int::text', v_data) else format('%s::text', v_data) end; end if;
  v_where := format(' where t.empresa_id = %L', p_empresa) || v_where
    || case when p_de is not null then format(' and %s >= %L', v_data, p_de) else '' end
    || case when p_ate is not null then format(' and %s <= %L', v_data, p_ate) else '' end;
  execute format('select %s from %s%s', v_met, v_from, v_where) into v_total;
  if p_agrupar is null then
    v_linhas := jsonb_build_array(jsonb_build_array('Total', round(coalesce(v_total, 0), 2)));
    v_n := 1;
  else
    v_sql := format('select coalesce(jsonb_agg(jsonb_build_array(k, round(coalesce(m, 0), 2))), ''[]''), count(*) from (select %s k, %s m from %s%s group by 1 order by %s limit %s) z',
      v_dim, v_met, v_from, v_where,
      case when coalesce(p_ordem, case when v_tempo then 'chave' else 'maior' end) = 'chave' then '1'
           when p_ordem = 'menor' then '2 asc nulls last, 1' else '2 desc nulls last, 1' end, v_lim);
    execute v_sql into v_linhas, v_n;
  end if;
  return jsonb_build_object('fonte', p_fonte, 'metrica', p_metrica, 'metrica_nome', cat -> 'metricas' ->> p_metrica, 'agrupar', p_agrupar,
    'agrupar_nome', cat -> 'agrupar' ->> p_agrupar, 'filtros', f, 'de', p_de, 'ate', p_ate, 'linhas', v_linhas, 'n', v_n,
    'total', case when p_metrica in ('media', 'ticket', 'refugo_pct') then null else round(coalesce(v_total, 0), 2) end,
    'link', cat ->> 'link', 'rotulo', cat ->> 'rotulo');
end $$;

revoke all on function public.ia_consultar(uuid, text, text, text, jsonb, date, date, text, int) from public, anon;
grant execute on function public.ia_consultar(uuid, text, text, text, jsonb, date, date, text, int) to authenticated;
grant execute on function public.ia_catalogo() to authenticated;

-- 2) modelo de e-mail
create or replace function public.email_padrao()
returns table(codigo text, nome text, assunto text, corpo text, botao text, campos text)
language sql immutable set search_path = public as $$
  values
  ('portal_convite', 'Convite para o Portal do Cliente', 'Convite para o Portal do Cliente — {{empresa}}',
   E'Olá,\n\n{{empresa}} liberou para {{cliente}} o acesso ao Portal do Cliente. Nele você vê os títulos e as notas fiscais, pede prorrogação de vencimento e aprova as artes das embalagens.\n\nClique no botão para criar a sua senha. O convite vale até {{validade}}.', 'Criar meu acesso', 'empresa, cliente, validade'),
  ('arte_aprovacao', 'Arte aguardando a aprovação do cliente', 'Arte nº {{numero}} aguardando a sua aprovação — {{arte}}',
   E'Olá,\n\nA versão {{versao}} da arte {{arte}} está pronta para a sua conferência.\n\n{{observacao}}\n\nConfira textos, cores, medidas e o código de barras. No Portal você pode marcar pontos na arte, aprovar ou pedir alteração. Responda até {{prazo}}.', 'Conferir a arte', 'empresa, cliente, arte, numero, versao, observacao, prazo'),
  ('prorrogacao_resposta', 'Resposta do pedido de prorrogação', 'Pedido de prorrogação {{decisao}} — {{documento}}',
   E'Olá,\n\nO seu pedido de prorrogação do título {{documento}} foi {{decisao}}. O vencimento é {{vencimento}}.\n\n{{resposta}}', 'Abrir o Portal', 'empresa, cliente, documento, decisao, vencimento, resposta'),
  ('aviso', 'Avisos da plataforma (Meus avisos)', '{{titulo}}', E'{{texto}}', 'Abrir na plataforma', 'empresa, titulo, texto'),
  ('teste', 'E-mail de teste', 'E-mail de teste — {{empresa}}', E'Olá {{nome}},\n\nSe você recebeu esta mensagem, o e-mail da plataforma está funcionando.', null, 'empresa, nome'),
  ('entrega_saiu', 'Pedido saiu para entrega', 'Seu pedido saiu para entrega — NF {{notas}}',
   E'Olá,\n\nA mercadoria das notas {{notas}} saiu para entrega hoje, no veículo {{veiculo}}.\n\nNo Portal você acompanha a entrega e, depois, vê o canhoto assinado.', 'Acompanhar a entrega', 'empresa, cliente, notas, veiculo'),
  ('entrega_feita', 'Pedido entregue', 'Pedido entregue — NF {{nota}}',
   E'Olá,\n\nA nota {{nota}} foi entregue em {{quando}} e recebida por {{recebedor}}.\n\nO canhoto assinado fica disponível no Portal.', 'Ver o canhoto', 'empresa, cliente, nota, quando, recebedor'),
  ('cob_lembrete', 'Cobrança: lembrete antes do vencimento', 'Lembrete: título {{documento}} vence em {{vencimento}}',
   E'Olá, {{cliente}},\n\nLembramos que o título {{documento}}, no valor de {{valor}}, vence em {{vencimento}}.\n\nPara pagar com PIX, use o código copia e cola:\n{{pix}}\n\nSe já pagou, desconsidere esta mensagem.', 'Ver no Portal', 'empresa, cliente, documento, valor, vencimento, pix'),
  ('cob_vencimento', 'Cobrança: vence hoje', 'O título {{documento}} vence hoje',
   E'Olá, {{cliente}},\n\nO título {{documento}}, no valor de {{valor}}, vence hoje ({{vencimento}}).\n\nPara pagar com PIX, use o código copia e cola:\n{{pix}}\n\nSe já pagou, desconsidere esta mensagem.', 'Ver no Portal', 'empresa, cliente, documento, valor, vencimento, pix'),
  ('cob_atraso', 'Cobrança: título em atraso', 'Título {{documento}} em aberto há {{dias}} dia(s)',
   E'Olá, {{cliente}},\n\nNão identificamos o pagamento do título {{documento}}, no valor de {{valor}}, vencido em {{vencimento}} ({{dias}} dia(s) de atraso).\n\nPara pagar com PIX, use o código copia e cola:\n{{pix}}\n\nSe já pagou, por favor responda com o comprovante. Se precisar negociar, fale com o nosso financeiro.', 'Ver no Portal', 'empresa, cliente, documento, valor, vencimento, dias, pix'),
  ('reclamacao_recebida', 'Reclamação recebida pelo Portal', 'Recebemos a sua reclamação — nº {{numero}}',
   E'Olá, {{cliente}},\n\nRecebemos a sua reclamação nº {{numero}}{{nota}}. A nossa equipe da qualidade já está analisando e dá a primeira resposta até {{prazo}}.\n\nVocê acompanha a análise pelo Portal do Cliente.', 'Acompanhar', 'empresa, cliente, numero, nota, prazo'),
  ('reclamacao_resposta', 'Resposta da reclamação', 'Resposta da reclamação nº {{numero}}',
   E'Olá, {{cliente}},\n\nA nossa equipe da qualidade respondeu a sua reclamação nº {{numero}} (situação: {{situacao}}):\n\n{{resposta}}\n\nNo Portal você vê a análise completa e pode nos dizer se a resposta resolveu.', 'Ver a resposta', 'empresa, cliente, numero, situacao, resposta'),
  ('arte_lembrete', 'Lembrete: arte aguardando a aprovação', 'Lembrete: a arte nº {{numero}} aguarda a sua aprovação — {{arte}}',
   E'Olá,\n\nA versão {{versao}} da arte {{arte}} foi enviada em {{enviada}} e ainda aguarda a sua conferência.\n\nA produção da embalagem só começa depois da aprovação. No Portal você aprova ou pede alteração em poucos minutos.', 'Conferir a arte', 'empresa, cliente, arte, numero, versao, enviada'),
  ('cotacao_convite', 'Pedido de cotação ao fornecedor', 'Pedido de cotação nº {{numero}} — {{empresa}}',
   E'Olá, {{fornecedor}},\n\n{{empresa}} pede a sua cotação para {{itens}} item(ns) da requisição nº {{numero}}.\n\n{{mensagem}}\n\nPreencha os preços, o prazo de entrega e a condição de pagamento direto na página, sem precisar de cadastro. O link vale até {{validade}}.', 'Preencher a cotação', 'empresa, fornecedor, numero, itens, mensagem, validade'),
  ('relatorio_agendado', 'Relatório agendado', '{{titulo}} — {{periodo}}',
   E'Olá,\n\nSegue o relatório "{{titulo}}" ({{periodo}}), enviado automaticamente pela plataforma {{frequencia}}.\n\n{{observacao}}', 'Abrir na plataforma', 'empresa, titulo, periodo, frequencia, observacao');
$$;
grant execute on function public.email_padrao() to authenticated, service_role;

-- 3) relatórios
create or replace function public.rel_pode(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.papel_em(p_empresa) in ('admin', 'diretor', 'financeiro')
$$;
revoke all on function public.rel_pode(uuid) from public, anon;
grant execute on function public.rel_pode(uuid) to authenticated;

create table if not exists public.rel_agendados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 3 and 120),
  observacao text,
  blocos jsonb not null default '[]'::jsonb check (jsonb_typeof(blocos) = 'array' and jsonb_array_length(blocos) between 1 and 10),
  frequencia text not null default 'semanal' check (frequencia in ('diaria', 'dias_uteis', 'semanal', 'mensal')),
  dia_semana int not null default 1 check (dia_semana between 1 and 7),     -- 1 = segunda … 7 = domingo
  dia_mes int not null default 1 check (dia_mes between 1 and 28),
  hora int not null default 8 check (hora between 0 and 23),               -- hora de Recife
  destinatarios text[] not null default '{}' check (cardinality(destinatarios) between 1 and 20),
  ativo boolean not null default true,
  criado_por uuid not null default auth.uid(),
  criado_em timestamptz not null default now(),
  proximo_envio timestamptz, ultimo_envio timestamptz, ultimo_erro text
);
create index if not exists rel_agendados_proximo on public.rel_agendados(proximo_envio) where ativo;
create table if not exists public.rel_envios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  rel_id uuid not null references public.rel_agendados(id) on delete cascade,
  enviado_em timestamptz not null default now(),
  manual boolean not null default false,
  destinatarios int not null default 0,
  blocos int not null default 0,
  erro text
);
create index if not exists rel_envios_rel on public.rel_envios(rel_id, enviado_em desc);
alter table public.rel_agendados enable row level security;
alter table public.rel_envios enable row level security;
drop policy if exists rel_agendados_sel on public.rel_agendados;
create policy rel_agendados_sel on public.rel_agendados for select to authenticated using (public.rel_pode(empresa_id));
drop policy if exists rel_agendados_ins on public.rel_agendados;
create policy rel_agendados_ins on public.rel_agendados for insert to authenticated with check (public.rel_pode(empresa_id) and criado_por = auth.uid());
drop policy if exists rel_agendados_upd on public.rel_agendados;
create policy rel_agendados_upd on public.rel_agendados for update to authenticated using (public.rel_pode(empresa_id) and (criado_por = auth.uid() or public.is_admin(empresa_id))) with check (public.rel_pode(empresa_id));
drop policy if exists rel_agendados_del on public.rel_agendados;
create policy rel_agendados_del on public.rel_agendados for delete to authenticated using (public.rel_pode(empresa_id) and (criado_por = auth.uid() or public.is_admin(empresa_id)));
drop policy if exists rel_envios_sel on public.rel_envios;
create policy rel_envios_sel on public.rel_envios for select to authenticated using (public.rel_pode(empresa_id));
grant select, insert, update, delete on public.rel_agendados to authenticated;
grant select on public.rel_envios to authenticated;
drop trigger if exists zz_auditoria on public.rel_agendados;
create trigger zz_auditoria after insert or update or delete on public.rel_agendados for each row execute function public._auditar();

-- período relativo → datas (hoje em Recife)
create or replace function public._rel_periodo(p text, p_hoje date default (now() at time zone 'America/Recife')::date)
returns table(de date, ate date, texto text) language sql immutable as $$
  select x.de, x.ate, x.t from (values
    ('hoje', p_hoje, p_hoje, 'hoje'),
    ('ontem', p_hoje - 1, p_hoje - 1, 'ontem'),
    ('semana_atual', p_hoje - (extract(isodow from p_hoje)::int - 1), p_hoje, 'esta semana'),
    ('semana_passada', p_hoje - (extract(isodow from p_hoje)::int - 1) - 7, p_hoje - extract(isodow from p_hoje)::int, 'semana passada'),
    ('mes_atual', date_trunc('month', p_hoje)::date, p_hoje, 'este mês'),
    ('mes_anterior', (date_trunc('month', p_hoje) - interval '1 month')::date, (date_trunc('month', p_hoje) - interval '1 day')::date, 'mês anterior'),
    ('ano_atual', date_trunc('year', p_hoje)::date, p_hoje, 'este ano'),
    ('ultimos_7', p_hoje - 6, p_hoje, 'últimos 7 dias'),
    ('ultimos_30', p_hoje - 29, p_hoje, 'últimos 30 dias'),
    ('ultimos_12_meses', (date_trunc('month', p_hoje) - interval '11 months')::date, p_hoje, 'últimos 12 meses'),
    ('proximos_7', p_hoje, p_hoje + 6, 'próximos 7 dias'),
    ('proximos_30', p_hoje, p_hoje + 29, 'próximos 30 dias')) x(k, de, ate, t)
  where x.k = coalesce(p, 'mes_atual')
$$;

-- próximo envio depois de um instante
create or replace function public._rel_proximo(p_freq text, p_dsem int, p_dmes int, p_hora int, p_depois timestamptz default now())
returns timestamptz language plpgsql immutable as $$
declare d date := (p_depois at time zone 'America/Recife')::date; c timestamptz;
begin
  for i in 0..62 loop
    c := ((d + i) + make_interval(hours => p_hora)) at time zone 'America/Recife';
    if c > p_depois and (p_freq = 'diaria'
        or (p_freq = 'dias_uteis' and extract(isodow from d + i) between 1 and 5)
        or (p_freq = 'semanal' and extract(isodow from d + i) = p_dsem)
        or (p_freq = 'mensal' and extract(day from d + i) = p_dmes)) then return c; end if;
  end loop;
  return null;
end $$;

create or replace function public._rel_antes() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from jsonb_array_elements(new.blocos) b where b ? 'fonte' and b ? 'metrica') then raise exception 'Cada bloco precisa de fonte e medida.'; end if;
  if exists (select 1 from unnest(new.destinatarios) e where e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'E-mail inválido nos destinatários.'; end if;
  if tg_op = 'UPDATE' and auth.uid() is not null then new.criado_por := auth.uid(); new.ultimo_erro := null; end if;   -- quem salvou por último passa a ser o dono
  new.proximo_envio := case when new.ativo then public._rel_proximo(new.frequencia, new.dia_semana, new.dia_mes, new.hora, greatest(now(), coalesce(new.ultimo_envio, now()))) end;
  return new;
end $$;
drop trigger if exists rel_agendados_antes on public.rel_agendados;
create trigger rel_agendados_antes before insert or update of blocos, destinatarios, frequencia, dia_semana, dia_mes, hora, ativo on public.rel_agendados for each row execute function public._rel_antes();

-- número no padrão brasileiro pela medida; chave de mês/dia legível
create or replace function public._rel_fmt(v numeric, m text) returns text language sql immutable as $$
  select case when v is null then '–'
    when m in ('valor', 'saldo', 'media', 'ticket', 'produtos', 'frete', 'icms', 'ipi', 'pedagio', 'a_receber', 'a_pagar') then 'R$ ' || translate(to_char(v, 'FM999G999G999G990D00'), ',.', '.,')
    when m in ('kg', 'refugo') then translate(to_char(v, 'FM999G999G999G990'), ',', '.') || ' kg'
    when m = 'refugo_pct' then replace(to_char(v, 'FM990D0'), '.', ',') || '%'
    when m = 'horas' then replace(to_char(v, 'FM999G990D0'), '.', ',') || ' h'
    when m = 'km' then translate(to_char(v, 'FM999G999G990'), ',', '.') || ' km'
    else translate(to_char(v, 'FM999G999G990'), ',', '.') end
$$;
create or replace function public._rel_chave(k text, a text) returns text language sql immutable as $$
  select case when a = 'mes' and k ~ '^\d{4}-\d{2}$' then (array['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'])[substr(k, 6, 2)::int] || '/' || left(k, 4)
              when a = 'dia' and k ~ '^\d{4}-\d{2}-\d{2}$' then to_char(k::date, 'DD/MM/YYYY') else k end
$$;

-- monta as tabelas dos blocos (roda com quem chama: na tela, o usuário; no envio, o dono do relatório)
create or replace function public.rel_previa(p_empresa uuid, p_blocos jsonb, p_hoje date default (now() at time zone 'America/Recife')::date)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare b jsonb; out jsonb := '[]'; r jsonb; pe record; cat jsonb := ia_catalogo();
begin
  if not rel_pode(p_empresa) then raise exception 'Só administrador, diretor e financeiro montam relatórios.'; end if;
  for b in select * from jsonb_array_elements(coalesce(p_blocos, '[]')) loop
    select * into pe from _rel_periodo(b ->> 'periodo', p_hoje);
    if pe.de is null then select * into pe from _rel_periodo('mes_atual', p_hoje); end if;
    begin
      r := ia_consultar(p_empresa, b ->> 'fonte', b ->> 'metrica', nullif(b ->> 'agrupar', ''), coalesce(b -> 'filtros', '{}'), pe.de, pe.ate, nullif(b ->> 'ordem', ''), coalesce((b ->> 'limite')::int, 15));
      out := out || jsonb_build_object(
        'titulo', coalesce(nullif(b ->> 'titulo', ''), r ->> 'metrica_nome'),
        'periodo', pe.texto || case when b ->> 'fonte' = 'saldos' then ' (' || to_char(pe.ate, 'DD/MM/YYYY') || ')' when pe.de = pe.ate then ' (' || to_char(pe.de, 'DD/MM/YYYY') || ')' else ' (' || to_char(pe.de, 'DD/MM') || ' a ' || to_char(pe.ate, 'DD/MM/YYYY') || ')' end,
        'colunas', jsonb_build_array(coalesce(r ->> 'agrupar_nome', ''), coalesce(r ->> 'metrica_nome', '')),
        'linhas', (select coalesce(jsonb_agg(jsonb_build_array(_rel_chave(l ->> 0, r ->> 'agrupar'), _rel_fmt((l ->> 1)::numeric, r ->> 'metrica'))), '[]') from jsonb_array_elements(r -> 'linhas') l),
        'total', case when r ->> 'agrupar' is not null and r ->> 'total' is not null then _rel_fmt((r ->> 'total')::numeric, r ->> 'metrica') end,
        'link', r ->> 'link', 'rotulo', r ->> 'rotulo');
    exception when others then
      out := out || jsonb_build_object('titulo', coalesce(b ->> 'titulo', b ->> 'fonte'), 'erro', sqlerrm);
    end;
  end loop;
  return out;
end $$;
revoke all on function public.rel_previa(uuid, jsonb, date) from public, anon;
grant execute on function public.rel_previa(uuid, jsonb, date) to authenticated;

-- envia um relatório (pelo agendamento ou pelo botão); devolve quantos e-mails entraram na fila
create or replace function public._rel_enviar(p_rel uuid, p_manual boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare r rel_agendados; t jsonb; e text; n int := 0; v_err text; v_per text; v_claims text := current_setting('request.jwt.claims', true);
begin
  select * into r from rel_agendados where id = p_rel;
  if r.id is null then return 0; end if;
  begin
    -- consulta com o acesso do dono
    perform set_config('request.jwt.claims', json_build_object('sub', r.criado_por, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', r.criado_por::text, true);
    if not rel_pode(r.empresa_id) then raise exception 'Quem criou o relatório não tem mais acesso (perfil administrador, diretor ou financeiro).'; end if;
    t := rel_previa(r.empresa_id, r.blocos);
    select string_agg(distinct x ->> 'periodo', '; ') into v_per from jsonb_array_elements(t) x where x ? 'periodo';
    foreach e in array r.destinatarios loop
      perform _email_enfileirar(r.empresa_id, 'relatorio_agendado', e,
        jsonb_build_object('titulo', r.nome, 'periodo', coalesce(v_per, ''), 'observacao', coalesce(r.observacao, ''), 'tabelas', t,
          'frequencia', case r.frequencia when 'diaria' then 'todo dia' when 'dias_uteis' then 'nos dias úteis' when 'semanal' then 'toda semana' else 'todo mês' end,
          'caminho', 'index.html#/relatorios'), r.id);
      n := n + 1;
    end loop;
  exception when others then v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_claims::json ->> 'sub', ''), true);
  insert into rel_envios(empresa_id, rel_id, manual, destinatarios, blocos, erro) values (r.empresa_id, r.id, p_manual, n, coalesce(jsonb_array_length(t), 0), v_err);
  update rel_agendados set ultimo_envio = case when v_err is null then now() else ultimo_envio end, ultimo_erro = v_err,
         proximo_envio = case when ativo and not p_manual then _rel_proximo(frequencia, dia_semana, dia_mes, hora, now()) else proximo_envio end
   where id = r.id;
  return n;
end $$;
revoke all on function public._rel_enviar(uuid, boolean) from public, anon, authenticated;

create or replace function public.rel_enviar_agora(p_rel uuid) returns int language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  select empresa_id into v_emp from rel_agendados where id = p_rel;
  if v_emp is null or not rel_pode(v_emp) then raise exception 'Relatório não encontrado.'; end if;
  return _rel_enviar(p_rel, true);
end $$;
revoke all on function public.rel_enviar_agora(uuid) from public, anon;
grant execute on function public.rel_enviar_agora(uuid) to authenticated;

create or replace function public._rel_agendados() returns void language plpgsql security definer set search_path = public as $$
declare i uuid;
begin
  for i in select id from rel_agendados where ativo and proximo_envio <= now() order by proximo_envio limit 50 loop
    perform _rel_enviar(i, false);
  end loop;
end $$;
revoke all on function public._rel_agendados() from public, anon, authenticated;

do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'relatorios-enviar';
  perform cron.schedule('relatorios-enviar', '*/15 * * * *', $job$ select public._rel_agendados(); $job$);
exception when others then raise notice 'agendamento dos relatórios não criado: %', sqlerrm;
end $$;

select count(*) as fontes from jsonb_object_keys(public.ia_catalogo());
