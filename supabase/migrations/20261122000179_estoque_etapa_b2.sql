-- 179 — estoque, etapa B2: achados da segunda avaliação (todos reproduzidos pelo avaliador)
--  1. Lançamento à mão: sem data futura, com limite de dias para trás, documento obrigatório e trava de custo fora da faixa;
--     tipos que formam custo ou dependem de nota nascem restritos por perfil.
--  2. Estorno: respeita o perfil do tipo, exige motivo, não aceita data anterior ao movimento, não estorna estorno
--     e devolve a quantidade à requisição de material de origem.
--  3. Inventário: item movimentado depois de contado volta para recontar (parâmetro); bloqueio opcional do item em contagem.
--  4. Lote: produto e empresa congelados; bloqueio só pela Qualidade; auditoria.
--  5. Custo deixa de vazar por consultas internas; verificação em duas etapas passa a valer no estoque e no almoxarifado.
--  6. Parâmetros estruturais congelados depois do primeiro movimento; tipo de sistema não se exclui; transferência não muda o valor do estoque.
--  7. Fechamento: sem mês futuro, com trilha e com a posição do estoque guardada (base do inventário de fim de mês).
--  8. Recálculo a partir da data do movimento, regravando só o que mudou.
--  9. Limite de valor da requisição vale para o dia (não se foge fatiando).
-- Aditivo: nada é apagado.

-- ------------------------------------------------------------ parâmetros novos
alter table public.est_config add column if not exists dias_retroativos int default 60 check (dias_retroativos is null or dias_retroativos >= 0);   -- nulo = sem limite
alter table public.est_config add column if not exists custo_desvio_pct numeric(8,2) default 50 check (custo_desvio_pct is null or custo_desvio_pct > 0);   -- nulo = sem trava
alter table public.est_config add column if not exists exigir_documento boolean not null default true;   -- entrada que forma custo, lançada à mão, exige o documento
alter table public.est_inv_config add column if not exists apos_contagem text not null default 'recontar' check (apos_contagem in ('recontar', 'ajustar'));
alter table public.est_inv_config add column if not exists bloquear_movimento boolean not null default false;
create or replace function public._inv_cfg(p_empresa uuid) returns est_inv_config language sql stable security definer set search_path = public as $$
  select coalesce((select c from est_inv_config c where c.empresa_id = p_empresa),
                  (select row(p_empresa, 30, 60, 120, 20, 2, 100, true, true, array['admin', 'diretor', 'financeiro'], now(), null, false, 'recontar', false)::est_inv_config));
$$;
create or replace function public.est_travas_salvar(p_empresa uuid, p_dias int, p_desvio numeric, p_documento boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(p_empresa) then raise exception 'Só o administrador altera as travas do lançamento.'; end if;
  if p_dias < 0 or p_desvio <= 0 then raise exception 'Valor inválido.'; end if;
  insert into est_config(empresa_id, dias_retroativos, custo_desvio_pct, exigir_documento) values (p_empresa, p_dias, p_desvio, coalesce(p_documento, true))
  on conflict (empresa_id) do update set dias_retroativos = excluded.dias_retroativos, custo_desvio_pct = excluded.custo_desvio_pct, exigir_documento = excluded.exigir_documento, atualizado_em = now(), atualizado_por = auth.uid();
end $$;
revoke all on function public.est_travas_salvar(uuid, int, numeric, boolean) from public, anon;
grant execute on function public.est_travas_salvar(uuid, int, numeric, boolean) to authenticated;

-- ------------------------------------------------------------ 5. verificação em duas etapas e consultas internas
create or replace function public.pode_estoque(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao'))
     and public._mfa_ok(p_empresa);
$$;
create or replace function public.pode_ver_estoque(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros m where m.empresa_id = p_empresa and m.user_id = auth.uid()
    and (m.papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao')
         or m.papel::text = any(coalesce((select c.papeis_consulta from est_config c where c.empresa_id = p_empresa), '{leitura}'))))
     and public._mfa_ok(p_empresa);
$$;
create or replace function public.alm_membro(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid()) and public._mfa_ok(p_empresa);
$$;
create or replace function public.alm_gerencia(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'diretor')) and public._mfa_ok(p_empresa);
$$;
create or replace function public.alm_almoxarife(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros m left join alm_config c on c.empresa_id = m.empresa_id
                 where m.empresa_id = p_empresa and m.user_id = auth.uid()
                   and (m.papel::text = any(coalesce(c.papeis_almoxarife, '{admin,diretor,compras}')) or auth.uid() = any(coalesce(c.almoxarifes, '{}'))))
     and public._mfa_ok(p_empresa);
$$;
create or replace function public.alm_aprovador(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros m left join alm_config c on c.empresa_id = m.empresa_id
                 where m.empresa_id = p_empresa and m.user_id = auth.uid()
                   and (m.papel::text = any(coalesce(c.papeis_aprovador, '{admin,diretor}')) or auth.uid() = any(coalesce(c.aprovadores, '{}'))))
     and public._mfa_ok(p_empresa);
$$;

create or replace function public.est_reposicao(p_empresa uuid)
returns table(produto_id uuid, codigo text, descricao text, unidade text, familia text, fonte text,
              consumo_janela numeric, consumo_dia numeric, sigma_dia numeric, lead_time numeric, lead_fonte text,
              estoque_seguranca numeric, ponto_pedido numeric, estoque_maximo numeric,
              minimo_atual numeric, ponto_atual numeric, saldo numeric, em_pedido numeric, cobertura_dias numeric,
              giro_anual numeric, dias_sem_saida int, valor_saldo numeric, custo numeric, sugestao numeric, situacao text)
language plpgsql stable security definer set search_path = public as $$
declare cfg est_reposicao_config; v_impl date; v_fonte text; v_z numeric; v_jan int;
begin
  if not public.pode_ver_estoque(p_empresa) then raise exception 'Sem permissão.'; end if;
  select * into cfg from est_reposicao_config where empresa_id = p_empresa;
  select implantado_em into v_impl from est_config where empresa_id = p_empresa;
  v_jan := coalesce(cfg.janela_dias, 90);
  v_fonte := coalesce(cfg.fonte, 'auto');
  if v_fonte = 'auto' then v_fonte := case when v_impl is not null and v_impl <= current_date - least(v_jan, 30) then 'kardex' else 'compras' end; end if;
  v_z := case coalesce(cfg.nivel_servico, 95) when 90 then 1.28 when 95 then 1.65 when 98 then 2.05 else 2.33 end;
  return query
  with mov as (
    -- consumo diário: saídas do Kardex (líquidas dos estornos) ou compras pelas notas de entrada
    select m.produto_id, m.data dia, -sum(m.quantidade) q
      from est_movimentos m join est_tipos_movimento t on t.id = m.tipo_movimento_id
     where v_fonte = 'kardex' and m.empresa_id = p_empresa and t.sentido = 'S' and m.data > current_date - v_jan
     group by 1, 2
    union all
    select pf.produto_id, n.emissao, sum(i.qcom * pf.fator)
      from nfe_itens i join nfe_notas n on n.id = i.nota_id
      join produto_fornecedores pf on pf.empresa_id = n.empresa_id and pf.emit_doc = n.emit_doc and pf.codigo_fornecedor = i.cprod
     where v_fonte = 'compras' and n.empresa_id = p_empresa and n.tipo = 'entrada' and not n.emissao_propria and n.situacao = 'autorizada'
       and coalesce(n.finalidade, '1') = '1' and n.emissao > current_date - v_jan
     group by 1, 2
  ), sem as (
    -- consumo por semana (com as semanas sem consumo) para a variação
    select p.id produto_id, w.s, coalesce(sum(mov.q), 0) q
      from produtos p cross join generate_series(0, greatest(v_jan / 7 - 1, 0)) w(s)
      left join mov on mov.produto_id = p.id and (current_date - mov.dia) / 7 = w.s
     where p.empresa_id = p_empresa and p.id in (select distinct mov.produto_id from mov)
     group by 1, 2
  ), est as (
    select sem.produto_id, sum(sem.q) tot, sum(sem.q) / (count(*) * 7.0) d, coalesce(stddev_samp(sem.q), 0) / sqrt(7.0) sd from sem group by 1
  ), lt as (
    -- prazo real: do pedido de compra à primeira nota de entrada do mesmo fornecedor com o produto, últimos 12 meses
    select pi.produto_id, avg(greatest(x.emissao - pe.data_pedido, 0))::numeric lt
      from compras_pedido_itens pi join compras_pedidos pe on pe.id = pi.pedido_id
      join favorecidos f on f.id = pe.favorecido_id
      join lateral (select min(n.emissao) emissao from nfe_notas n join nfe_itens i on i.nota_id = n.id
                     join produto_fornecedores pf on pf.empresa_id = n.empresa_id and pf.emit_doc = n.emit_doc and pf.codigo_fornecedor = i.cprod and pf.produto_id = pi.produto_id
                    where n.empresa_id = p_empresa and n.tipo = 'entrada' and n.emissao >= pe.data_pedido and n.emissao <= pe.data_pedido + 180
                      and regexp_replace(coalesce(n.emit_doc, ''), '\D', '', 'g') = regexp_replace(coalesce(f.documento, ''), '\D', '', 'g')) x on x.emissao is not null
     where pe.empresa_id = p_empresa and pi.produto_id is not null and pe.status <> 'cancelado' and pe.data_pedido > current_date - 365
     group by 1
  ), sal as (
    select s.produto_id, sum(s.quantidade) q, sum(s.valor) v from est_saldos s where s.empresa_id = p_empresa group by 1
  ), ped as (
    select pi.produto_id, sum(greatest(pi.quantidade - pi.qtd_recebida, 0)) q
      from compras_pedido_itens pi join compras_pedidos pe on pe.id = pi.pedido_id
     where pe.empresa_id = p_empresa and pe.status in ('aguardando', 'aprovado', 'enviado', 'recebido_parcial') and pi.produto_id is not null
     group by 1
  ), ult as (
    select m.produto_id, max(m.data) d from est_movimentos m join est_tipos_movimento t on t.id = m.tipo_movimento_id
     where m.empresa_id = p_empresa and t.sentido = 'S' group by 1
  ), base as (
    select p.id, p.codigo, p.descricao, p.unidade, fa.nome familia, est.tot, est.d, est.sd,
           coalesce(p.lead_time_dias::numeric, round(lt.lt, 1), cfg.lead_time_padrao, 15) ltd,
           case when p.lead_time_dias is not null then 'produto' when lt.lt is not null then 'real' else 'padrão' end ltf,
           p.estoque_minimo, p.ponto_pedido pp_atual, case when v_impl is not null then coalesce(sal.q, 0) end saldo, coalesce(ped.q, 0) em_ped,
           sal.v, case when v_impl is not null then current_date - ult.d end parado, coalesce(c.custo_medio, (select pf.ultimo_preco from produto_fornecedores pf where pf.produto_id = p.id and pf.ultimo_preco is not null order by pf.ultima_compra desc nulls last limit 1)) custo
      from produtos p left join est on est.produto_id = p.id left join lt on lt.produto_id = p.id left join sal on sal.produto_id = p.id
      left join ped on ped.produto_id = p.id left join ult on ult.produto_id = p.id left join est_familias fa on fa.id = p.familia_id
      left join est_custos c on c.produto_id = p.id
     where p.empresa_id = p_empresa and p.ativo and coalesce(p.tipo_sped, '') <> '04' and (est.tot > 0 or sal.q > 0 or p.ponto_pedido is not null)
  ), calc as (
    select base.*, round(v_z * coalesce(sd, 0) * sqrt(ltd), 3) es,
           round(coalesce(d, 0) * ltd + v_z * coalesce(sd, 0) * sqrt(ltd), 3) pp,
           round(coalesce(d, 0) * ltd + v_z * coalesce(sd, 0) * sqrt(ltd) + coalesce(d, 0) * coalesce(cfg.intervalo_compra_dias, 15), 3) mx
      from base
  )
  select c.id, c.codigo, c.descricao, c.unidade, c.familia, v_fonte, round(coalesce(c.tot, 0), 3), round(coalesce(c.d, 0), 4), round(coalesce(c.sd, 0), 4), c.ltd, c.ltf,
         c.es, c.pp, c.mx, c.estoque_minimo, c.pp_atual, c.saldo, c.em_ped,
         case when c.saldo is not null and c.d > 0 then round(c.saldo / c.d, 1) end,
         case when c.saldo > 0 and c.d > 0 then round(c.d * 365 / c.saldo, 2) end,
         c.parado, round(coalesce(c.v, c.saldo * c.custo), 2), c.custo,
         case when c.saldo is not null and c.saldo + c.em_ped <= c.pp and c.d > 0 then round(greatest(c.mx - c.saldo - c.em_ped, 0), 3) else 0 end,
         case when c.saldo is null then 'sem_estoque'
              when c.saldo > 0 and coalesce(c.d, 0) = 0 and coalesce(c.parado, 9999) >= coalesce(cfg.parado_dias, 90) then 'parado'
              when c.d > 0 and c.saldo <= c.es then 'critico'
              when c.d > 0 and c.saldo + c.em_ped <= c.pp then 'comprar'
              when c.d > 0 and c.saldo > c.mx * 2 then 'excesso'
              else 'ok' end
    from calc c order by 25, 2;
end $$;

create or replace function public.est_inv_abc(p_empresa uuid)
returns table(produto_id uuid, classe char(1), valor numeric, ultima_contagem timestamptz)
language sql stable security definer set search_path = public as $$
  with v as (select s.produto_id, sum(s.valor) val from est_saldos s where s.empresa_id = p_empresa and s.quantidade > 0 group by 1),
  a as (select v.*, sum(val) over (order by val desc rows unbounded preceding) / nullif(sum(val) over (), 0) ac from v)
  select a.produto_id, (case when a.ac <= 0.80 or a.ac = (select min(ac) from a) then 'A' when a.ac <= 0.95 then 'B' else 'C' end)::char(1), round(a.val, 2),
         (select max(i.contado_em) from est_inv_itens i where i.produto_id = a.produto_id and i.situacao in ('ok', 'divergente', 'ajustado'))
    from a where public.pode_ver_estoque(p_empresa);
$$;
revoke all on function public.est_inv_abc(uuid) from public, anon;
grant execute on function public.est_inv_abc(uuid) to authenticated;

-- gera a contagem do local com os itens vencidos pela frequência da classe (os mais atrasados primeiro)
create or replace function public.est_inv_gerar(p_empresa uuid, p_local uuid, p_qtd int default null, p_produtos uuid[] default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cfg est_inv_config; v_id uuid; v_num int; v_n int;
begin
  if not public.pode_estoque(p_empresa) then raise exception 'Sem permissão.'; end if;
  if not exists (select 1 from est_locais where id = p_local and empresa_id = p_empresa and ativo) then raise exception 'Local inválido.'; end if;
  if (select implantado_em from est_config where empresa_id = p_empresa) is null then raise exception 'Implante o saldo inicial do estoque antes do inventário cíclico.'; end if;
  if exists (select 1 from est_inv_contagens where empresa_id = p_empresa and local_id = p_local and situacao = 'aberta') then raise exception 'Já há uma contagem aberta neste local.'; end if;
  cfg := _inv_cfg(p_empresa);
  select coalesce(max(numero), 0) + 1 into v_num from est_inv_contagens where empresa_id = p_empresa;
  insert into est_inv_contagens(empresa_id, numero, local_id) values (p_empresa, v_num, p_local) returning id into v_id;
  insert into est_inv_itens(empresa_id, contagem_id, produto_id, lote_id, classe)
  select p_empresa, v_id, s.produto_id, s.lote_id, coalesce(abc.classe, 'C')
    from est_saldos s left join est_inv_abc(p_empresa) abc on abc.produto_id = s.produto_id
   where s.empresa_id = p_empresa and s.local_id = p_local and s.quantidade > 0
     and (p_produtos is null or s.produto_id = any(p_produtos))
     and (p_produtos is not null or abc.ultima_contagem is null
          or abc.ultima_contagem < now() - make_interval(days => case coalesce(abc.classe, 'C') when 'A' then cfg.dias_a when 'B' then cfg.dias_b else cfg.dias_c end))
   order by case coalesce(abc.classe, 'C') when 'A' then 1 when 'B' then 2 else 3 end, abc.ultima_contagem nulls first, abc.valor desc nulls last
   limit coalesce(p_qtd, cfg.itens_por_contagem);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Nenhum item a contar neste local agora (todos dentro da frequência).'; end if;
  return v_id;
end $$;

create or replace function public.est_implantacao_situacao(p_empresa uuid, p_desde date default (current_date - 365))
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_esp record; v_cfg record; v_pr jsonb; v_out jsonb;
begin
  if not public.pode_ver_estoque(p_empresa) then raise exception 'Sem permissão.'; end if;
  select e.id, e.data_ref, e.linhas, e.valor_total, e.criado_em into v_esp
    from estoque_espelhos e where e.empresa_id = p_empresa order by e.data_ref desc, e.criado_em desc limit 1;
  select * into v_cfg from est_config where empresa_id = p_empresa;
  v_pr := public.est_prontidao(p_empresa, p_desde);
  select jsonb_build_object(
    'espelho', jsonb_build_object(
      'qtd', (select count(*) from estoque_espelhos where empresa_id = p_empresa),
      'id', v_esp.id, 'data_ref', v_esp.data_ref, 'linhas', coalesce(v_esp.linhas, 0), 'valor', v_esp.valor_total,
      'depositos', (select count(distinct deposito) from estoque_espelho_itens where espelho_id = v_esp.id)),
    'locais', jsonb_build_object(
      'ativos', (select count(*) from est_locais where empresa_id = p_empresa and ativo),
      'setores', (select count(*) from prod_setores where empresa_id = p_empresa and ativo),
      'setores_sem_local', (select count(*) from prod_setores s where s.empresa_id = p_empresa and s.ativo
                              and not exists (select 1 from est_locais l where l.empresa_id = p_empresa and l.ativo and l.setor_id = s.id))),
    'cadastro', jsonb_build_object(
      'produtos', (select count(*) from produtos where empresa_id = p_empresa),
      'nao_acabados', (select count(*) from produtos where empresa_id = p_empresa and coalesce(tipo_sped, '') <> '04'),
      'esp_linhas', (select count(*) from estoque_espelho_itens where espelho_id = v_esp.id),
      'esp_ligadas', (select count(*) from estoque_espelho_itens where espelho_id = v_esp.id and produto_id is not null),
      'esp_valor', (select coalesce(sum(valor), 0) from estoque_espelho_itens where espelho_id = v_esp.id),
      'esp_valor_ligado', (select coalesce(sum(valor), 0) from estoque_espelho_itens where espelho_id = v_esp.id and produto_id is not null),
      'sem_familia', (select count(*) from produtos where empresa_id = p_empresa and familia_id is null)),
    'depara', jsonb_build_object('qtd', (select count(*) from produto_fornecedores where empresa_id = p_empresa)),
    'prontidao', v_pr,
    'saldo', jsonb_build_object('implantado_em', v_cfg.implantado_em,
      'movimentos', (select count(*) from est_movimentos where empresa_id = p_empresa),
      'valor', (select coalesce(sum(s.valor), 0) from est_saldos s where s.empresa_id = p_empresa)),
    'automatico', jsonb_build_object('ligado', coalesce(v_cfg.automatico, false),
      'pendencias', (select count(*) from est_pendencias where empresa_id = p_empresa and status = 'aberta')),
    'fechamento', jsonb_build_object('qtd', (select count(*) from est_fechamentos where empresa_id = p_empresa),
      'ultimo', (select max(mes) from est_fechamentos where empresa_id = p_empresa)),
    'desde', p_desde
  ) into v_out;
  return v_out;
end $$;

do $$ declare t text; r record; begin
  foreach t in array array['est_inv_contagens', 'est_inv_itens'] loop
    for r in select policyname from pg_policies where schemaname = 'public' and tablename = t and cmd = 'SELECT' loop
      execute format('drop policy %I on public.%I', r.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (public.pode_ver_estoque(empresa_id))', t || '_sel', t);
  end loop;
end $$;

-- ------------------------------------------------------------ 1. lançamento à mão
update public.est_tipos_movimento set papeis_manual = case
    when codigo in ('PROD', 'APARA') then '{financeiro,diretor,producao}'::text[] else '{financeiro,diretor,compras}'::text[] end
 where sistema and papeis_manual is null and (codigo in ('COMPRA', 'PROD', 'APARA') or documento = 'nf');
create or replace function public._est_tipo_padrao() returns trigger language plpgsql set search_path = public as $$
begin
  if new.papeis_manual is null and new.sistema then
    new.papeis_manual := case when new.codigo in ('SI', 'AJ+', 'AJ-') then '{financeiro,diretor}'::text[]
                              when new.codigo in ('PROD', 'APARA') then '{financeiro,diretor,producao}'::text[]
                              when new.codigo = 'COMPRA' or new.documento = 'nf' then '{financeiro,diretor,compras}'::text[] end;
  end if;
  return new;
end $$;

create or replace function public._est_mov_guarda() returns trigger language plpgsql set search_path = public as $$
declare tm record; v_papel text; cfg record; v_cm numeric; v_inv int;
begin
  if current_setting('app.est_recalculo', true) = 'sim' then return new; end if;
  -- valem para todo movimento, venha da tela ou da plataforma
  if new.lote_id is not null and not exists (select 1 from est_lotes l where l.id = new.lote_id and l.produto_id = new.produto_id and l.empresa_id = new.empresa_id) then
    raise exception 'O lote informado não é deste produto.';
  end if;
  if new.centro_custo_id is not null and not exists (select 1 from centros_custo c where c.id = new.centro_custo_id and c.empresa_id = new.empresa_id) then
    raise exception 'Centro de custo de outra empresa.';
  end if;
  -- item em contagem com o bloqueio ligado: só o ajuste da própria contagem passa
  select g.numero into v_inv from est_inv_contagens g join est_inv_itens i on i.contagem_id = g.id join est_inv_config f on f.empresa_id = g.empresa_id
   where g.empresa_id = new.empresa_id and g.local_id = new.local_id and g.situacao in ('aberta', 'em_aprovacao') and f.bloquear_movimento
     and i.produto_id = new.produto_id and i.lote_id is not distinct from new.lote_id
     and g.id::text is distinct from current_setting('app.est_inventario', true) limit 1;
  if v_inv is not null then raise exception 'Item em contagem no inventário nº %: movimente depois que a contagem for concluída.', v_inv; end if;

  if current_user not in ('authenticated', 'anon') then return new; end if;
  -- lançamento direto pela tela
  if new.data > current_date then raise exception 'Movimento com data futura (%).', to_char(new.data, 'DD/MM/YYYY'); end if;
  if new.estorno_de is not null then raise exception 'Estorno só pelo botão Estornar.'; end if;
  if new.transferencia_id is not null then raise exception 'Transferência só pela função de transferência.'; end if;
  if new.nota_id is not null or new.nfe_item_id is not null then raise exception 'Movimento de nota fiscal é lançado pela plataforma.'; end if;
  select t.sentido, t.afeta_custo, t.papeis_manual, t.nome, t.documento into tm from est_tipos_movimento t where t.id = new.tipo_movimento_id and t.empresa_id = new.empresa_id;
  if not found then raise exception 'Tipo de movimento não encontrado.'; end if;
  if tm.sentido = 'T' then raise exception 'Transferência só pela função de transferência.'; end if;
  v_papel := papel_em(new.empresa_id);
  if not pode_estoque(new.empresa_id) then return new; end if;   -- quem não movimenta o estoque é barrado logo adiante, pela regra de acesso da tabela
  if coalesce(cardinality(tm.papeis_manual), 0) > 0 and v_papel is distinct from 'admin' and not (v_papel = any(tm.papeis_manual)) then
    raise exception 'Seu perfil não lança "%" à mão. Quem pode está em Estoque › Parâmetros › Tipos de movimento.', tm.nome;
  end if;
  -- empresa sem configuração gravada usa o padrão (60 dias, 50 %); com configuração, nulo desliga a trava
  select case when c.empresa_id is null then 60 else c.dias_retroativos end dias, case when c.empresa_id is null then 50 else c.custo_desvio_pct end desvio, coalesce(c.exigir_documento, true) doc into cfg
    from (select 1) x left join est_config c on c.empresa_id = new.empresa_id;
  if v_papel is distinct from 'admin' and cfg.dias is not null and cfg.dias >= 0 and new.data < current_date - cfg.dias then
    raise exception 'Data anterior ao limite de % dias para lançamento à mão. O administrador pode lançar, ou ajuste o limite em Estoque › Parâmetros › Acesso.', cfg.dias;
  end if;
  if tm.sentido = 'E' and tm.afeta_custo then
    if new.quantidade > 0 and (new.custo_unitario is null or new.custo_unitario < 0) then raise exception 'Informe o custo unitário: "%" forma o custo médio.', tm.nome; end if;
    if new.quantidade > 0 and cfg.doc and tm.documento <> 'nenhum' and nullif(trim(coalesce(new.documento, '')), '') is null then
      raise exception 'Informe o documento (nota, ordem ou inventário): "%" forma o custo médio.', tm.nome;
    end if;
    -- custo muito diferente do custo médio do produto: só administrador, financeiro ou diretor confirma
    if new.quantidade > 0 and cfg.desvio is not null and v_papel not in ('admin', 'financeiro', 'diretor') then
      select custo_medio into v_cm from est_custos where produto_id = new.produto_id and quantidade > 0;
      if coalesce(v_cm, 0) > 0 and abs(new.custo_unitario - v_cm) / v_cm * 100 > cfg.desvio then
        raise exception 'Custo de R$ % difere mais de % %% do custo médio (R$ %). Confira o valor; se estiver certo, o lançamento é feito por administrador, financeiro ou diretor.',
          trim(to_char(new.custo_unitario, 'FM999G999G990D0000')), cfg.desvio, trim(to_char(v_cm, 'FM999G999G990D0000'));
      end if;
    end if;
  else new.custo_unitario := null;   -- custo informado só na entrada que forma custo
  end if;
  new.criado_por := auth.uid(); new.criado_em := now();
  new.valor := null; new.custo_medio_apos := null; new.saldo_local_apos := null;
  return new;
end $$;

-- ------------------------------------------------------------ 2. estorno
alter table public.alm_entrega_itens add column if not exists estornado_em timestamptz;
alter table public.alm_entrega_itens add column if not exists estornado_por uuid;
alter table public.alm_entregas add column if not exists estornada_em timestamptz;   -- todos os itens da entrega foram estornados

create or replace function public.est_estornar(p_mov uuid, p_data date default current_date, p_motivo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m est_movimentos; x est_movimentos; v uuid; v_primeiro uuid; v_papel text; tm record; ei record; v_data date := coalesce(p_data, current_date); v_req uuid;
begin
  select * into m from est_movimentos where id = p_mov for update;
  if not found then raise exception 'Movimento não encontrado'; end if;
  if not pode_estoque(m.empresa_id) then raise exception 'Sem permissão para movimentar o estoque.'; end if;
  if m.estorno_de is not null then raise exception 'Um estorno não se estorna: lance o movimento de novo.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do estorno.'; end if;
  if v_data < m.data then raise exception 'O estorno não pode ter data anterior à do movimento (%).', to_char(m.data, 'DD/MM/YYYY'); end if;
  if v_data > current_date then raise exception 'O estorno não pode ter data futura.'; end if;
  v_papel := papel_em(m.empresa_id);
  -- a transferência é estornada inteira: primeiro a entrada (devolve do destino), depois a saída (repõe na origem)
  for x in select * from est_movimentos where id = m.id or (m.transferencia_id is not null and transferencia_id = m.transferencia_id and empresa_id = m.empresa_id and estorno_de is null)
            order by quantidade desc for update loop
    if exists (select 1 from est_movimentos where estorno_de = x.id) then
      if x.id = m.id then raise exception 'Movimento já estornado.'; end if;
      continue;
    end if;
    -- quem não pode lançar o tipo também não o estorna; movimento de nota fiscal, só administrador, financeiro ou diretor
    select t.papeis_manual, t.nome into tm from est_tipos_movimento t where t.id = x.tipo_movimento_id;
    if v_papel is distinct from 'admin' then
      if coalesce(cardinality(tm.papeis_manual), 0) > 0 and not (v_papel = any(tm.papeis_manual)) then raise exception 'Seu perfil não estorna "%".', tm.nome; end if;
      if x.nota_id is not null and v_papel not in ('financeiro', 'diretor') then raise exception 'Movimento de nota fiscal: o estorno é feito por administrador, financeiro ou diretor.'; end if;
    end if;
    if exists (select 1 from alm_entrega_itens where movimento_id = x.id) and not alm_almoxarife(x.empresa_id) then
      raise exception 'Saída de requisição de material: o estorno é feito por quem atende o almoxarifado.';
    end if;
    insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, estorno_de, documento, observacao, centro_custo_id)
    values (x.empresa_id, v_data, x.produto_id, x.local_id, x.lote_id, x.tipo_movimento_id, -x.quantidade, x.custo_unitario, x.id, x.documento,
            'Estorno: ' || left(trim(p_motivo), 180), x.centro_custo_id)
    returning id into v;
    if x.id = m.id then v_primeiro := v; end if;
    -- saída de requisição: o material voltou, então a requisição deixa de constar como entregue
    for ei in select e.*, n.requisicao_id from alm_entrega_itens e join alm_entregas n on n.id = e.entrega_id where e.movimento_id = x.id and e.estornado_em is null loop
      update alm_entrega_itens set estornado_em = now(), estornado_por = auth.uid() where id = ei.id;
      update alm_requisicao_itens set qtd_entregue = greatest(qtd_entregue - ei.quantidade, 0) where id = ei.item_id;
      update alm_entregas n set valor = greatest(n.valor - abs(coalesce(x.valor, 0)), 0),
             estornada_em = case when not exists (select 1 from alm_entrega_itens o where o.entrega_id = n.id and o.estornado_em is null) then now() end
       where n.id = ei.entrega_id;
      v_req := ei.requisicao_id;
      update alm_requisicoes r set atualizado_em = now(),
             situacao = case when r.situacao in ('parcial', 'atendida') then
                               case when exists (select 1 from alm_requisicao_itens i where i.requisicao_id = r.id and i.qtd_entregue > 0) then 'parcial' else 'aberta' end
                             else r.situacao end
       where r.id = v_req;
    end loop;
  end loop;
  return v_primeiro;
end $$;

-- ------------------------------------------------------------ 3. inventário
create or replace function public.est_inv_aprovar(p_contagem uuid, p_aprovar boolean, p_motivo text default null)
returns int language plpgsql security definer set search_path = public as $$
declare c est_inv_contagens; cfg est_inv_config; it record; v_tipo uuid; v_mov uuid; v_n int := 0; v_q numeric; v_dif numeric; v_mexeu int;
begin
  select * into c from est_inv_contagens where id = p_contagem for update;
  if c.id is null then raise exception 'Contagem não encontrada.'; end if;
  cfg := _inv_cfg(c.empresa_id);
  if not exists (select 1 from membros where empresa_id = c.empresa_id and user_id = auth.uid() and papel::text = any(cfg.papeis_aprovacao)) then raise exception 'Sem permissão para aprovar.'; end if;
  if c.situacao <> 'em_aprovacao' then raise exception 'Contagem não está em aprovação.'; end if;
  if p_aprovar and not cfg.aprovar_propria and exists (select 1 from est_inv_itens i where i.contagem_id = c.id
       and lower(coalesce(auth.jwt() ->> 'email', '')) = lower(coalesce(i.contado_por, '-'))) then
    raise exception 'Quem contou não aprova a própria contagem. Peça a outro aprovador ou libere em Parâmetros do inventário.';
  end if;
  if not p_aprovar then
    if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Informe o motivo.'; end if;
    update est_inv_contagens set situacao = 'aberta', decidida_por = auth.jwt() ->> 'email', decidida_em = now(), motivo = p_motivo where id = c.id;
    update est_inv_itens set situacao = 'recontar' where contagem_id = c.id and situacao = 'divergente';
    return 0;
  end if;
  -- item movimentado depois de contado: o saldo guardado na contagem já não vale. Volta para recontar (ou ajusta pela diferença, por parâmetro).
  if cfg.apos_contagem = 'recontar' then
    update est_inv_itens i set situacao = 'recontar'
     where i.contagem_id = c.id and i.situacao = 'divergente'
       and exists (select 1 from est_movimentos m where m.empresa_id = c.empresa_id and m.produto_id = i.produto_id and m.local_id = c.local_id
                     and m.lote_id is not distinct from i.lote_id and m.criado_em > i.contado_em);
    get diagnostics v_mexeu = row_count;
    if v_mexeu > 0 then
      update est_inv_contagens set situacao = 'aberta', decidida_por = auth.jwt() ->> 'email', decidida_em = now(),
             motivo = v_mexeu || ' item(ns) movimentado(s) depois da contagem: reconte antes de aprovar.' where id = c.id;
      return -v_mexeu;
    end if;
  end if;
  perform set_config('app.est_inventario', c.id::text, true);   -- os ajustes desta contagem passam pelo bloqueio de item em contagem
  for it in select * from est_inv_itens where contagem_id = c.id and situacao = 'divergente' loop
    v_q := coalesce(it.recontado, it.contado);
    v_dif := v_q - it.saldo_sistema;
    continue when v_dif = 0;
    select id into v_tipo from est_tipos_movimento where empresa_id = c.empresa_id and codigo = case when v_dif > 0 then 'AJ+' else 'AJ-' end and ativo;
    if v_tipo is null then raise exception 'Tipo de movimento % não configurado.', case when v_dif > 0 then 'AJ+' else 'AJ-' end; end if;
    insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao)
    values (c.empresa_id, current_date, it.produto_id, c.local_id, it.lote_id, v_tipo, v_dif, case when v_dif > 0 then nullif(it.custo, 0) end,
            'INV ' || c.numero, left(coalesce(it.justificativa, 'Inventário cíclico'), 200))
    returning id into v_mov;
    update est_inv_itens set situacao = 'ajustado', movimento_id = v_mov where id = it.id;
    v_n := v_n + 1;
  end loop;
  update est_inv_contagens set situacao = 'aprovada', decidida_por = auth.jwt() ->> 'email', decidida_em = now(), motivo = p_motivo where id = c.id;
  return v_n;
end $$;

-- ------------------------------------------------------------ 4. lote protegido
create or replace function public._est_lote_protege() returns trigger language plpgsql set search_path = public as $$
begin
  if new.produto_id is distinct from old.produto_id or new.empresa_id is distinct from old.empresa_id then raise exception 'O produto do lote não muda: crie outro lote.'; end if;
  if current_user in ('authenticated', 'anon') and (new.bloqueado is distinct from old.bloqueado or new.bloqueio_motivo is distinct from old.bloqueio_motivo) then
    raise exception 'O bloqueio e a liberação de lote são feitos pela Qualidade.';
  end if;
  return new;
end $$;
revoke all on function public._est_lote_protege() from public, anon, authenticated;
drop trigger if exists est_lotes_protege on public.est_lotes;
create trigger est_lotes_protege before update on public.est_lotes for each row execute function public._est_lote_protege();
drop trigger if exists zz_auditoria on public.est_lotes;
create trigger zz_auditoria after update or delete on public.est_lotes for each row execute function public._auditar();

-- ------------------------------------------------------------ 6. parâmetros estruturais e transferência
create or replace function public._est_param_protege() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'est_tipos_movimento' then
    if tg_op = 'DELETE' then
      if old.sistema and exists (select 1 from empresas where id = old.empresa_id) then raise exception 'Tipo de movimento do sistema não se exclui: desative-o.'; end if;
      return old;
    end if;
    if (new.sentido is distinct from old.sentido or new.afeta_custo is distinct from old.afeta_custo)
       and exists (select 1 from est_movimentos where tipo_movimento_id = old.id) then
      raise exception 'O tipo "%" já tem movimentos: sentido e "forma custo" não mudam. Crie outro tipo e desative este.', old.nome;
    end if;
  else
    if (new.compoe_custo is distinct from old.compoe_custo or new.controla_saldo is distinct from old.controla_saldo or new.posse is distinct from old.posse)
       and exists (select 1 from est_movimentos where local_id = old.id) then
      raise exception 'O local "%" já tem movimentos: posse, "compõe custo" e "controla saldo" não mudam. Crie outro local e transfira o saldo.', old.nome;
    end if;
  end if;
  return new;
end $$;
revoke all on function public._est_param_protege() from public, anon, authenticated;
drop trigger if exists est_tipos_protege on public.est_tipos_movimento;
create trigger est_tipos_protege before update or delete on public.est_tipos_movimento for each row execute function public._est_param_protege();
drop trigger if exists est_locais_protege on public.est_locais;
create trigger est_locais_protege before update on public.est_locais for each row execute function public._est_param_protege();

create or replace function public.est_transferir(p_empresa uuid, p_data date, p_produto uuid, p_origem uuid, p_destino uuid, p_qtd numeric,
  p_lote uuid default null, p_tipo uuid default null, p_obs text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare g uuid := gen_random_uuid(); t uuid;
begin
  if not pode_estoque(p_empresa) then raise exception 'Sem permissão para movimentar o estoque.'; end if;
  if p_qtd <= 0 then raise exception 'Quantidade da transferência deve ser positiva.'; end if;
  if p_origem = p_destino then raise exception 'Origem e destino iguais.'; end if;
  if p_data > current_date then raise exception 'Transferência com data futura.'; end if;
  if (select count(*) from est_locais where id in (p_origem, p_destino) and empresa_id = p_empresa) <> 2 then raise exception 'Local não encontrado nesta empresa.'; end if;
  if (select count(distinct compoe_custo) from est_locais where id in (p_origem, p_destino)) > 1 then
    raise exception 'Transferência entre um local que compõe o custo e outro que não compõe muda o valor do estoque: use um tipo de saída ou de entrada.';
  end if;
  t := coalesce(p_tipo, (select id from est_tipos_movimento where empresa_id = p_empresa and codigo = 'TRF'));
  if t is null then raise exception 'Cadastre o tipo de movimento TRF (transferência).'; end if;
  insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, transferencia_id, observacao)
  values (p_empresa, p_data, p_produto, p_origem, p_lote, t, -p_qtd, g, p_obs);
  insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, transferencia_id, observacao)
  values (p_empresa, p_data, p_produto, p_destino, p_lote, t, p_qtd, g, p_obs);
  return g;
end $$;

-- ------------------------------------------------------------ 7. fechamento com trilha e posição guardada
create table if not exists public.est_fechamento_saldos (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mes date not null,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  local_id uuid not null references public.est_locais(id) on delete cascade,
  lote_id uuid references public.est_lotes(id) on delete set null,
  quantidade numeric(18,4) not null,
  valor numeric(16,2) not null,
  id bigint generated always as identity primary key
);
create index if not exists est_fech_saldos_mes on public.est_fechamento_saldos (empresa_id, mes, local_id);
alter table public.est_fechamento_saldos enable row level security;
drop policy if exists est_fechamento_saldos_sel on public.est_fechamento_saldos;
create policy est_fechamento_saldos_sel on public.est_fechamento_saldos for select to authenticated using (public.pode_ver_estoque(empresa_id));
revoke all on public.est_fechamento_saldos from anon, authenticated;
grant select on public.est_fechamento_saldos to authenticated;

create or replace function public.est_fechar_mes(p_empresa uuid, p_mes date, p_reabrir boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_mes)::date; v_fim date;
begin
  if not pode_editar(p_empresa) then raise exception 'Só administrador ou financeiro fecha o estoque.'; end if;
  if p_reabrir then
    if not is_admin(p_empresa) then raise exception 'Só o administrador reabre o mês.'; end if;
    delete from est_fechamentos where empresa_id = p_empresa and mes >= v_mes;
    delete from est_fechamento_saldos where empresa_id = p_empresa and mes >= v_mes;
    return 'reaberto';
  end if;
  if v_mes > date_trunc('month', current_date)::date then raise exception 'Não se fecha um mês que ainda não começou.'; end if;
  v_fim := (v_mes + interval '1 month')::date;
  insert into est_fechamentos(empresa_id, mes) values (p_empresa, v_mes) on conflict do nothing;
  -- posição do estoque no último dia do mês: é o que o inventário de fim de mês (e o Bloco H) vai usar
  delete from est_fechamento_saldos where empresa_id = p_empresa and mes = v_mes;
  insert into est_fechamento_saldos(empresa_id, mes, produto_id, local_id, lote_id, quantidade, valor)
  select p_empresa, v_mes, m.produto_id, m.local_id, m.lote_id, sum(m.quantidade), sum(m.valor)
    from est_movimentos m join est_locais l on l.id = m.local_id
   where m.empresa_id = p_empresa and m.data < v_fim and l.controla_saldo
   group by m.produto_id, m.local_id, m.lote_id
  having sum(m.quantidade) <> 0 or sum(m.valor) <> 0;
  return 'fechado';
end $$;
drop trigger if exists zz_auditoria on public.est_fechamentos;
create trigger zz_auditoria after insert or update or delete on public.est_fechamentos for each row execute function public._auditar();

-- ------------------------------------------------------------ 8. recálculo a partir da data do movimento
alter table public.est_custos add column if not exists recalcular_desde date;
drop function if exists public._est_recalc(uuid, uuid);
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
    if m.quantidade > 0 and m.afeta_custo and m.estorno_de is null then cu := m.custo_unitario;
    elsif m.estorno_de is not null then cu := m.custo_unitario;
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
revoke all on function public._est_recalc(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.est_recalcular(p_empresa uuid, p_produto uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not pode_editar(p_empresa) then raise exception 'Só administrador ou financeiro recalcula o estoque.'; end if;
  return _est_recalc(p_empresa, p_produto, null);
end $$;

create or replace function public._est_mov_retro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.est_recalculo', true) = 'sim' then return null; end if;
  if exists (select 1 from est_movimentos x where x.empresa_id = new.empresa_id and x.produto_id = new.produto_id and x.data > new.data) then
    update est_custos set recalcular = true, recalcular_desde = least(coalesce(recalcular_desde, new.data), new.data) where produto_id = new.produto_id;
  end if;
  return null;
end $$;
create or replace function public._est_mov_retro_fim() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_desde date;
begin
  select recalcular_desde into v_desde from est_custos where produto_id = new.produto_id and recalcular;
  if found then perform _est_recalc(new.empresa_id, new.produto_id, v_desde); end if;
  return null;
end $$;

-- ------------------------------------------------------------ 9. requisição: limite do dia
create or replace function public.alm_requisitar(p_empresa uuid, p_itens jsonb, p_motivo text default null, p_colaborador uuid default null, p_para_nome text default null, p_origem text default 'pedido')
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg alm_config; k rh_colaboradores; it jsonb; p produtos; v_id uuid; v_num int; v_valor numeric := 0; v_dia numeric := 0; v_q numeric; v_cu numeric; v_ctrl text[] := '{}'; v_mot text; v_sit text;
  v_eu text := public._alm_nome(p_empresa); v_almox boolean := public.alm_almoxarife(p_empresa);
begin
  if not public.alm_membro(p_empresa) then raise exception 'Sem acesso a esta empresa'; end if;
  if p_origem not in ('pedido', 'balcao') then raise exception 'Origem inválida'; end if;
  if jsonb_typeof(coalesce(p_itens, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Inclua pelo menos um item'; end if;
  if jsonb_array_length(p_itens) > 60 then raise exception 'Muitos itens numa requisição só (máximo 60)'; end if;
  if length(coalesce(p_motivo, '')) > 500 then raise exception 'Motivo muito longo'; end if;
  select * into cfg from alm_config where empresa_id = p_empresa;
  if p_colaborador is not null then
    select * into k from rh_colaboradores where id = p_colaborador and empresa_id = p_empresa;
    if not found then raise exception 'Colaborador não encontrado'; end if;
    if k.user_id is distinct from auth.uid() and not v_almox then raise exception 'Só quem atende o almoxarifado pede em nome de outra pessoa'; end if;
  else
    select * into k from rh_colaboradores where empresa_id = p_empresa and user_id = auth.uid();
    if not found and nullif(trim(coalesce(p_para_nome, '')), '') is not null and not v_almox then raise exception 'Só quem atende o almoxarifado pede em nome de outra pessoa'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('alm_requisicoes:' || p_empresa::text));
  select coalesce(max(numero), 0) + 1 into v_num from alm_requisicoes where empresa_id = p_empresa;
  insert into alm_requisicoes (empresa_id, numero, origem, solicitante_id, solicitante_nome, colaborador_id, para_nome, setor, centro_custo_id, motivo)
  values (p_empresa, v_num, p_origem, auth.uid(), v_eu, k.id, coalesce(k.nome, nullif(trim(coalesce(p_para_nome, '')), ''), v_eu), k.setor, k.centro_custo_id, nullif(trim(coalesce(p_motivo, '')), ''))
  returning id into v_id;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into p from produtos where id = (it ->> 'produto_id')::uuid and empresa_id = p_empresa;
    if not found then raise exception 'Item que não é desta empresa'; end if;
    v_q := (it ->> 'quantidade')::numeric;
    if v_q is null or v_q <= 0 then raise exception 'Quantidade inválida em %', p.descricao; end if;
    if exists(select 1 from alm_requisicao_itens where requisicao_id = v_id and produto_id = p.id) then raise exception 'O item % está repetido', p.descricao; end if;
    select case when c.quantidade > 0 then c.valor / c.quantidade else 0 end into v_cu from est_custos c where c.produto_id = p.id;
    v_valor := v_valor + v_q * coalesce(v_cu, 0);
    insert into alm_requisicao_itens (requisicao_id, empresa_id, produto_id, codigo, descricao, unidade, quantidade, controlado, observacao)
    values (v_id, p_empresa, p.id, p.codigo, p.descricao, p.unidade, v_q, exists(select 1 from alm_controlados where produto_id = p.id), left(nullif(trim(coalesce(it ->> 'observacao', '')), ''), 200));
    if exists(select 1 from alm_controlados where produto_id = p.id) then v_ctrl := v_ctrl || p.descricao; end if;
  end loop;
  -- o limite vale para o dia: fatiar o pedido em vários não foge da aprovação
  if cfg.valor_aprovacao is not null then
    select coalesce(sum(q.valor_estimado), 0) into v_dia from alm_requisicoes q
     where q.empresa_id = p_empresa and q.id <> v_id and q.situacao not in ('cancelada', 'recusada')
       and (q.criado_em at time zone 'America/Recife')::date = (now() at time zone 'America/Recife')::date
       and (q.solicitante_id = auth.uid() or (q.colaborador_id is not null and q.colaborador_id = (select colaborador_id from alm_requisicoes where id = v_id)));
  end if;
  v_mot := nullif(concat_ws('; ',
    case when array_length(v_ctrl, 1) > 0 then 'item controlado: ' || array_to_string(v_ctrl, ', ') end,
    case when cfg.valor_aprovacao is not null and v_valor > cfg.valor_aprovacao then 'valor estimado de R$ ' || public._alm_reais(v_valor) || ' acima do limite de R$ ' || public._alm_reais(cfg.valor_aprovacao)
         when cfg.valor_aprovacao is not null and v_valor + v_dia > cfg.valor_aprovacao then 'pedidos do dia somam R$ ' || public._alm_reais(v_valor + v_dia) || ', acima do limite de R$ ' || public._alm_reais(cfg.valor_aprovacao) end), '');
  v_sit := case when v_mot is null then 'aberta' else 'aprovacao' end;
  update alm_requisicoes set situacao = v_sit, valor_estimado = round(v_valor, 2), motivo_aprovacao = v_mot where id = v_id;
  if v_sit = 'aprovacao' then
    perform public._alm_avisar(p_empresa, 'aprovador', 'Requisição nº ' || v_num || ' aguarda aprovação', coalesce(v_eu, '') || ': ' || v_mot, v_id);
  elsif p_origem = 'pedido' then
    perform public._alm_avisar(p_empresa, 'almoxarife', 'Nova requisição nº ' || v_num, coalesce(v_eu, '') || ' pediu ' || jsonb_array_length(p_itens) || ' item(ns)', v_id);
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'situacao', v_sit, 'motivo_aprovacao', v_mot);
end $$;

-- ------------------------------------------------------------ nada novo para visitante sem login
do $$ declare r record; begin
  for r in select p.oid::regprocedure f, p.prorettype = 'trigger'::regtype gat, has_function_privilege('authenticated', p.oid, 'execute') aut
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname ~ '^_?(est|alm|etq)_' or p.proname in ('pode_estoque', 'papel_em', 'pode_ver_estoque')) loop
    if r.aut and not r.gat then execute format('grant execute on function %s to authenticated', r.f); end if;
    execute format('revoke execute on function %s from public, anon', r.f);
    if r.gat then execute format('revoke execute on function %s from authenticated', r.f); end if;
  end loop;
end $$;
revoke execute on function public._est_recalc(uuid, uuid, date) from authenticated;
