-- Pergunte à plataforma (IA) — melhoria 1.8 do plano de melhoria contínua, Passo 5 — 08/11/2026.
-- Aditivo. Perguntas em português sobre os dados da empresa, respondidas pela IA (Claude, da Anthropic) com texto, gráfico
-- e o link da tela de origem. SÓ CONSULTA: a IA não escreve SQL; ela escolhe, num catálogo fechado, a fonte, a medida,
-- o agrupamento e os filtros, e o banco monta a consulta (nomes vindos de listas fixas, valores sempre como literais).
-- A consulta roda com o usuário que perguntou (security invoker): cada pessoa só vê o que já vê nas telas.
--   • ia_config: liga/desliga, modelo, perfis com acesso, limite de perguntas por pessoa por dia, consultas por pergunta,
--     dias de histórico;
--   • ia_perguntas: histórico (pergunta, resposta, consultas usadas, gráfico, tokens, tempo, avaliação 👍/👎);
--   • ia_catalogo(): o que pode ser perguntado (vai no pedido à IA);
--   • ia_consultar(): a consulta agregada;
--   • a função de borda "perguntar" conversa com a IA (segredo ANTHROPIC_API_KEY).

-- 1) configuração
create table if not exists public.ia_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativo boolean not null default false,
  modelo text not null default 'claude-sonnet-5-5',
  papeis text[] not null default array['admin', 'diretor', 'financeiro'],
  limite_dia int not null default 30 check (limite_dia between 1 and 500),
  max_consultas int not null default 6 check (max_consultas between 1 and 12),
  guardar_dias int not null default 180 check (guardar_dias between 7 and 730),
  instrucoes text,                                  -- orientação extra da empresa para as respostas (ex.: "valores sem centavos")
  atualizado_em timestamptz not null default now()
);
alter table public.ia_config enable row level security;
drop policy if exists ia_config_sel on public.ia_config;
create policy ia_config_sel on public.ia_config for select to authenticated using (public.is_membro(empresa_id));
drop policy if exists ia_config_ins on public.ia_config;
create policy ia_config_ins on public.ia_config for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists ia_config_upd on public.ia_config;
create policy ia_config_upd on public.ia_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
grant select, insert, update on public.ia_config to authenticated;
drop trigger if exists zz_auditoria on public.ia_config;
create trigger zz_auditoria after insert or update or delete on public.ia_config for each row execute function public._auditar();

-- 2) histórico
create table if not exists public.ia_perguntas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  pergunta text not null check (length(pergunta) between 3 and 1000),
  resposta text,
  consultas jsonb not null default '[]'::jsonb,     -- [{fonte, metrica, agrupar, filtros, de, ate, n}]
  grafico jsonb,                                    -- {tipo, titulo, rotulos, series:[{nome, valores}]}
  tabela jsonb,                                     -- {colunas, linhas} da consulta principal
  link text, link_rotulo text,
  modelo text, tokens_entrada int, tokens_saida int, ms int,
  erro text,
  avaliacao smallint check (avaliacao in (-1, 1)),
  comentario text,
  criado_em timestamptz not null default now()
);
create index if not exists ia_perguntas_user on public.ia_perguntas(empresa_id, user_id, criado_em desc);
alter table public.ia_perguntas enable row level security;
drop policy if exists ia_perguntas_sel on public.ia_perguntas;
create policy ia_perguntas_sel on public.ia_perguntas for select to authenticated using (user_id = auth.uid() or public.is_admin(empresa_id));
grant select on public.ia_perguntas to authenticated;   -- grava só a função de borda (service role); avalia por ia_avaliar

-- 3) quem pode perguntar
create or replace function public.ia_pode(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ia_config c where c.empresa_id = p_empresa and c.ativo and public.papel_em(p_empresa) = any(c.papeis))
$$;
revoke all on function public.ia_pode(uuid) from public, anon;
grant execute on function public.ia_pode(uuid) to authenticated;

create or replace function public.ia_avaliar(p_pergunta uuid, p_avaliacao smallint, p_comentario text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_avaliacao is not null and p_avaliacao not in (-1, 1) then raise exception 'Avaliação inválida.'; end if;
  update ia_perguntas set avaliacao = p_avaliacao, comentario = nullif(trim(coalesce(p_comentario, '')), '') where id = p_pergunta and user_id = auth.uid();
  if not found then raise exception 'Pergunta não encontrada.'; end if;
end $$;
revoke all on function public.ia_avaliar(uuid, smallint, text) from public, anon;
grant execute on function public.ia_avaliar(uuid, smallint, text) to authenticated;

-- 4) o catálogo: fontes, medidas, agrupamentos e filtros que a IA pode usar
create or replace function public.ia_catalogo() returns jsonb language sql immutable as $$
select '{
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
grant execute on function public.ia_catalogo() to authenticated;

-- 5) a consulta (agregada, até 100 linhas). Roda com as permissões de quem perguntou.
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

-- 6) uso (administrador): perguntas, pessoas, avaliações e tokens no período
create or replace function public.ia_uso(p_empresa uuid, p_de date) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin(p_empresa) then raise exception 'Só o administrador vê o uso da IA.'; end if;
  return (select jsonb_build_object(
    'perguntas', count(*), 'pessoas', count(distinct user_id), 'erros', count(*) filter (where erro is not null),
    'positivas', count(*) filter (where avaliacao = 1), 'negativas', count(*) filter (where avaliacao = -1),
    'tokens_entrada', coalesce(sum(tokens_entrada), 0), 'tokens_saida', coalesce(sum(tokens_saida), 0), 'ms_medio', round(avg(ms)),
    'por_pessoa', (select coalesce(jsonb_agg(x order by x ->> 'n' desc), '[]') from (select jsonb_build_object('email', u.email, 'n', count(*)) x
                    from ia_perguntas p join auth.users u on u.id = p.user_id where p.empresa_id = p_empresa and p.criado_em >= p_de group by u.email) y))
    from ia_perguntas where empresa_id = p_empresa and criado_em >= p_de);
end $$;
revoke all on function public.ia_uso(uuid, date) from public, anon;
grant execute on function public.ia_uso(uuid, date) to authenticated;

-- 7) limpeza do histórico (domingo 4h40)
create or replace function public._ia_limpar() returns void language sql security definer set search_path = public as $$
  delete from ia_perguntas p using ia_config c where c.empresa_id = p.empresa_id and p.criado_em < now() - make_interval(days => c.guardar_dias);
  delete from ia_perguntas p where not exists (select 1 from ia_config c where c.empresa_id = p.empresa_id) and p.criado_em < now() - interval '180 days';
$$;
revoke all on function public._ia_limpar() from public, anon, authenticated;
do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'ia-limpar';
  perform cron.schedule('ia-limpar', '40 7 * * 0', $job$ select public._ia_limpar(); $job$);
exception when others then raise notice 'agendamento da limpeza da IA não criado: %', sqlerrm;
end $$;

select jsonb_object_keys(public.ia_catalogo()) as fontes;
