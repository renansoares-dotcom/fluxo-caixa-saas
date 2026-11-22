-- 183 — correções da 5ª avaliação do estoque (inventário geral e integridade do lançamento)
--   1. Quantidade, custo e valor inválidos ("NaN") barrados em todas as tabelas do estoque e do almoxarifado.
--   2. Inventário geral: a diferença é medida contra o saldo do momento do congelamento (controle de corte) e lançada na data de referência;
--      custo do item na data de referência; recálculo antes de fechar o mês, para o ajuste sair pelo custo da data.
--   3. Terceira contagem com justificativa obrigatória e confirmação da outra pessoa.
--   4. Quem conta ou audita não vê o resultado enquanto o seu local não terminou.
--   5. Abertura espera os lançamentos em andamento; local repetido; troca de pessoas sem deixar local sem auditor;
--      contagem cíclica não nasce em local congelado; erro da aprovação aponta o item.
-- Aditivo: nada é apagado.

-- ------------------------------------------------------------ 1. número inválido não entra
do $$ declare r record; begin
  for r in select c.table_name t, c.column_name c from information_schema.columns c join information_schema.tables b on b.table_schema = c.table_schema and b.table_name = c.table_name and b.table_type = 'BASE TABLE'
            where c.table_schema = 'public' and c.data_type = 'numeric' and (c.table_name like 'est\_%' or c.table_name like 'alm\_%') loop
    if not exists (select 1 from pg_constraint where conname = left(r.t || '_' || r.c || '_num', 63) and conrelid = ('public.' || r.t)::regclass) then
      execute format('alter table public.%I add constraint %I check (%I is null or %I <> ''NaN''::numeric)', r.t, left(r.t || '_' || r.c || '_num', 63), r.c, r.c);
    end if;
  end loop;
end $$;

alter table public.est_ig_itens add column if not exists terceira_conf_por uuid, add column if not exists terceira_conf_em timestamptz;

-- custo do produto na data de referência: o custo médio depois do último movimento até o dia; sem movimento, o custo atual ou a última compra
create or replace function public._ig_custo_em(p_empresa uuid, p_produto uuid, p_data date) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select m.custo_medio_apos from est_movimentos m where m.empresa_id = p_empresa and m.produto_id = p_produto and m.data <= p_data
                           order by m.data desc, m.criado_em desc, m.quantidade asc limit 1), 0), public._ig_custo(p_produto), 0);
$$;
-- saldo do local no momento (todos os movimentos): é contra ele que a contagem é comparada, porque o local congela neste instante
create or replace function public._ig_saldo_agora(p_empresa uuid, p_produto uuid, p_local uuid, p_lote uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(m.quantidade), 0) from est_movimentos m
   where m.empresa_id = p_empresa and m.produto_id = p_produto and m.local_id = p_local and m.lote_id is not distinct from p_lote;
$$;
-- quem conta ou audita um local que ainda não terminou não vê o resultado (o saldo do sistema) do inventário
create or replace function public._ig_cego(p_inventario uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from est_ig_locais l join est_ig_inventarios g on g.id = l.inventario_id
                  where l.inventario_id = p_inventario and g.situacao = 'aberto' and l.situacao <> 'concluido' and auth.uid() in (l.responsavel_id, l.auditor_id));
$$;


create or replace function public.est_ig_abrir(p_empresa uuid, p_referencia date, p_locais jsonb, p_observacao text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cfg est_ig_config := public._ig_cfg(p_empresa); v_id uuid; v_num int; v_impl boolean; v_fech date; l jsonb; v_loc uuid; v_resp uuid; v_aud uuid; v_n int; i int; j int; k int; v_igl uuid; v_tot int := 0;
  v_precisa_auditor boolean;
begin
  if not public.est_ig_gerencia(p_empresa) then raise exception 'Só administrador, financeiro ou diretor abre o inventário geral.'; end if;
  if p_referencia is null or p_referencia > current_date then raise exception 'A data de referência não pode ser futura.'; end if;
  select max(mes) into v_fech from est_fechamentos where empresa_id = p_empresa;
  if v_fech is not null and p_referencia < (v_fech + interval '1 month')::date then raise exception 'O estoque de % está fechado: a data de referência precisa ser de um mês aberto.', to_char(v_fech, 'MM/YYYY'); end if;
  if exists (select 1 from est_ig_inventarios where empresa_id = p_empresa and situacao = 'aberto') then raise exception 'Já há um inventário geral aberto: conclua ou cancele antes de abrir outro.'; end if;
  if jsonb_typeof(coalesce(p_locais, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_locais) = 0 then raise exception 'Escolha pelo menos um local.'; end if;
  v_n := jsonb_array_length(p_locais);
  if (select count(distinct x ->> 'local_id') from jsonb_array_elements(p_locais) x) <> v_n then raise exception 'Há local repetido na lista.'; end if;
  v_precisa_auditor := cfg.amostra_pct > 0 or cfg.amostra_classe_a or cfg.amostra_divergentes;
  v_impl := (select implantado_em from est_config where empresa_id = p_empresa) is null;
  perform pg_advisory_xact_lock(hashtext('est_fech:' || p_empresa::text));   -- espera os lançamentos em andamento: o saldo do congelamento não perde nenhum
  perform pg_advisory_xact_lock(hashtext('est_ig:' || p_empresa::text));
  select coalesce(max(numero), 0) + 1 into v_num from est_ig_inventarios where empresa_id = p_empresa;
  insert into est_ig_inventarios (empresa_id, numero, referencia, implantacao, observacao, criado_nome)
  values (p_empresa, v_num, p_referencia, v_impl, left(nullif(trim(coalesce(p_observacao, '')), ''), 500), public._ig_nome(p_empresa, auth.uid())) returning id into v_id;
  for i in 0 .. v_n - 1 loop
    l := p_locais -> i; v_loc := (l ->> 'local_id')::uuid; v_resp := (l ->> 'responsavel_id')::uuid; v_aud := nullif(l ->> 'auditor_id', '')::uuid;
    if not exists (select 1 from est_locais where id = v_loc and empresa_id = p_empresa and ativo and controla_saldo) then raise exception 'Local inválido ou que não controla saldo.'; end if;
    if exists (select 1 from est_inv_contagens where empresa_id = p_empresa and local_id = v_loc and situacao in ('aberta', 'em_aprovacao')) then
      raise exception 'O local % tem uma contagem cíclica em andamento: conclua ou cancele antes.', (select nome from est_locais where id = v_loc);
    end if;
    if v_resp is null or not exists (select 1 from membros where empresa_id = p_empresa and user_id = v_resp and papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao')) then
      raise exception 'Informe quem conta o local % (alguém com perfil de estoque).', (select nome from est_locais where id = v_loc);
    end if;
    if v_aud is null and v_precisa_auditor then   -- rodízio: o responsável do próximo local que não seja quem contou
      for k in 1 .. v_n - 1 loop
        j := (i + k) % v_n;
        if ((p_locais -> j) ->> 'responsavel_id')::uuid <> v_resp then v_aud := ((p_locais -> j) ->> 'responsavel_id')::uuid; exit; end if;
      end loop;
      if v_aud is null then raise exception 'Não há outra pessoa para auditar o local %: escolha o auditor, ou desligue a auditoria nos parâmetros.', (select nome from est_locais where id = v_loc); end if;
    end if;
    if v_aud is not null then
      if v_aud = v_resp then raise exception 'Quem conta o local % não pode ser o auditor dele.', (select nome from est_locais where id = v_loc); end if;
      if not exists (select 1 from membros where empresa_id = p_empresa and user_id = v_aud and papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao')) then raise exception 'O auditor precisa ter perfil de estoque.'; end if;
    end if;
    insert into est_ig_locais (inventario_id, empresa_id, local_id, responsavel_id, responsavel_nome, auditor_id, auditor_nome)
    values (v_id, p_empresa, v_loc, v_resp, public._ig_nome(p_empresa, v_resp), v_aud, public._ig_nome(p_empresa, v_aud)) returning id into v_igl;
    -- saldo de comparação = o saldo do local agora, no congelamento (inclui o que foi lançado depois da referência); a diferença é lançada na referência
    -- a lista: tudo que tem saldo, tudo que se movimentou no local nos últimos 12 meses (mesmo com saldo zero)
    -- e os produtos que têm este local como padrão (é o que monta a lista na implantação, com o estoque ainda vazio)
    insert into est_ig_itens (inventario_id, ig_local_id, empresa_id, local_id, produto_id, lote_id, saldo_ref, custo)
    select v_id, v_igl, p_empresa, v_loc, x.produto_id, x.lote_id, public._ig_saldo_agora(p_empresa, x.produto_id, v_loc, x.lote_id), public._ig_custo_em(p_empresa, x.produto_id, p_referencia)
      from (select m.produto_id, m.lote_id from est_movimentos m where m.empresa_id = p_empresa and m.local_id = v_loc and m.data > p_referencia - 365 group by 1, 2
            union
            select m.produto_id, m.lote_id from est_movimentos m where m.empresa_id = p_empresa and m.local_id = v_loc group by 1, 2 having sum(m.quantidade) <> 0
            union
            select p.id, null::uuid from produtos p where p.empresa_id = p_empresa and coalesce(p.ativo, true) and p.local_padrao_id = v_loc and not coalesce(p.controla_lote, false)) x;
    get diagnostics k = row_count; v_tot := v_tot + k;
    begin
      perform _notificar_u(p_empresa, array[v_resp], 'inventario', 'Inventário geral nº ' || v_num || ': contar ' || (select nome from est_locais where id = v_loc),
        'Data de referência ' || to_char(p_referencia, 'DD/MM/YYYY') || '. O local fica congelado até a contagem e a auditoria terminarem.', '#/estoque/inventario-geral?i=' || v_id, v_id, false);
    exception when others then null; end;
  end loop;
  return v_id;
end $$;

create or replace function public.est_ig_incluir(p_ig_local uuid, p_produto uuid, p_lote uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare gl est_ig_locais; g est_ig_inventarios; v_id uuid;
begin
  gl := public._ig_local_aberto(p_ig_local);
  if gl.situacao <> 'contando' or auth.uid() <> gl.responsavel_id then raise exception 'Só quem conta o local inclui item, e só durante a contagem.'; end if;
  select * into g from est_ig_inventarios where id = gl.inventario_id;
  if not exists (select 1 from produtos where id = p_produto and empresa_id = gl.empresa_id) then raise exception 'Produto não encontrado nesta empresa.'; end if;
  if p_lote is not null and not exists (select 1 from est_lotes where id = p_lote and produto_id = p_produto and empresa_id = gl.empresa_id) then raise exception 'Lote de outro produto.'; end if;
  if p_lote is null and (select coalesce(controla_lote, false) from produtos where id = p_produto) then raise exception 'Este produto controla lote: leia a etiqueta do lote.'; end if;
  select id into v_id from est_ig_itens where ig_local_id = gl.id and produto_id = p_produto and lote_id is not distinct from p_lote;
  if v_id is null then
    insert into est_ig_itens (inventario_id, ig_local_id, empresa_id, local_id, produto_id, lote_id, saldo_ref, custo, incluido)
    values (gl.inventario_id, gl.id, gl.empresa_id, gl.local_id, p_produto, p_lote, public._ig_saldo_agora(gl.empresa_id, p_produto, gl.local_id, p_lote), public._ig_custo_em(gl.empresa_id, p_produto, g.referencia), true)
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.est_ig_contar(p_item uuid, p_qtd numeric)
returns void language plpgsql security definer set search_path = public as $$
declare it est_ig_itens; gl est_ig_locais;
begin
  select * into it from est_ig_itens where id = p_item;
  if not found then raise exception 'Item não encontrado.'; end if;
  gl := public._ig_local_aberto(it.ig_local_id);
  if p_qtd is null or p_qtd = 'NaN'::numeric or p_qtd < 0 then raise exception 'Quantidade inválida.'; end if;
  if gl.situacao = 'contando' then
    if auth.uid() <> gl.responsavel_id then raise exception 'Quem conta este local é %.', gl.responsavel_nome; end if;
    update est_ig_itens set contado = p_qtd, contado_por = auth.uid(), contado_em = now(), situacao = 'contado' where id = p_item;
    update est_ig_locais set iniciado_em = coalesce(iniciado_em, now()) where id = gl.id;
  elsif gl.situacao = 'auditando' then
    if auth.uid() <> gl.auditor_id then raise exception 'Quem audita este local é %.', gl.auditor_nome; end if;
    if not it.na_amostra then raise exception 'Este item não está na amostra da auditoria.'; end if;
    update est_ig_itens set auditado = p_qtd, auditado_por = auth.uid(), auditado_em = now() where id = p_item;
  else raise exception 'Este local não está em contagem nem em auditoria.';
  end if;
end $$;

create or replace function public.est_ig_custo(p_item uuid, p_custo numeric)
returns void language plpgsql security definer set search_path = public as $$
declare it est_ig_itens; g est_ig_inventarios;
begin
  select * into it from est_ig_itens where id = p_item;
  select * into g from est_ig_inventarios where id = it.inventario_id;
  if g.id is null or g.situacao <> 'aberto' or not public.est_ig_gerencia(g.empresa_id) then raise exception 'Só quem gerencia o inventário informa o custo, e só com ele aberto.'; end if;
  if p_custo is null or p_custo = 'NaN'::numeric or p_custo < 0 then raise exception 'Custo inválido.'; end if;
  update est_ig_itens set custo = p_custo where inventario_id = g.id and produto_id = it.produto_id;   -- o custo é do produto: vale para todos os locais e lotes
end $$;

create or replace function public.est_ig_lista(p_ig_local uuid)
returns table (item_id uuid, produto_id uuid, codigo text, descricao text, unidade text, etiqueta text, lote_id uuid, lote text, lote_etiqueta text,
               quantidade numeric, feito boolean, incluido boolean, situacao text, papel text, contado numeric, auditado numeric)
language plpgsql stable security definer set search_path = public as $$
declare gl est_ig_locais; g est_ig_inventarios; v_papel text;
begin
  select * into gl from est_ig_locais where id = p_ig_local;
  if not found or not public.pode_estoque(gl.empresa_id) then raise exception 'Sem acesso.'; end if;
  select * into g from est_ig_inventarios where id = gl.inventario_id;
  v_papel := case when gl.situacao = 'terceira' and auth.uid() in (gl.responsavel_id, gl.auditor_id) then 'terceira'
                  when auth.uid() = gl.responsavel_id then 'contador' when auth.uid() = gl.auditor_id then 'auditor' end;
  if v_papel is null then raise exception 'Este local é contado por % e auditado por %.', gl.responsavel_nome, coalesce(gl.auditor_nome, 'ninguém'); end if;
  if v_papel = 'auditor' and gl.situacao = 'contando' then raise exception 'A auditoria deste local começa quando % concluir a contagem.', gl.responsavel_nome; end if;
  return query
  select i.id, i.produto_id, p.codigo::text, p.descricao::text, p.unidade::text, p.etiqueta::text, i.lote_id, lt.codigo::text, lt.etiqueta::text,
         case v_papel when 'contador' then i.contado when 'auditor' then i.auditado else i.terceira end,
         case v_papel when 'contador' then i.contado is not null when 'auditor' then i.auditado is not null else i.situacao = 'resolvido' end,
         i.incluido,
         case when v_papel = 'terceira' and i.situacao = 'divergente' and i.terceira is not null then (case when i.terceira_por = auth.uid() then 'aguarda_outro' else 'confirmar' end) else i.situacao end, v_papel,
         case when v_papel = 'terceira' then i.contado end, case when v_papel = 'terceira' then i.auditado end   -- na terceira contagem os dois veem as duas quantidades
    from est_ig_itens i join produtos p on p.id = i.produto_id left join est_lotes lt on lt.id = i.lote_id
   where i.ig_local_id = p_ig_local
     and (v_papel = 'contador' or (v_papel = 'auditor' and i.na_amostra) or (v_papel = 'terceira' and i.situacao in ('divergente', 'resolvido') and i.na_amostra))
   order by p.descricao, lt.codigo;
end $$;

-- terceira contagem: um registra a quantidade e a justificativa; o outro confirma a mesma quantidade. Só então o item fica resolvido.
create or replace function public.est_ig_terceira(p_item uuid, p_qtd numeric, p_justificativa text default null)
returns text language plpgsql security definer set search_path = public as $$
declare it est_ig_itens; gl est_ig_locais; v_just text := left(nullif(trim(coalesce(p_justificativa, '')), ''), 300);
begin
  select * into it from est_ig_itens where id = p_item;
  if not found then raise exception 'Item não encontrado.'; end if;
  gl := public._ig_local_aberto(it.ig_local_id);
  if gl.situacao <> 'terceira' or auth.uid() not in (gl.responsavel_id, gl.auditor_id) then raise exception 'A terceira contagem é registrada por quem contou e por quem auditou o local.'; end if;
  if it.situacao <> 'divergente' then raise exception 'Este item não precisa de terceira contagem, ou já foi confirmado.'; end if;
  if p_qtd is null or p_qtd = 'NaN'::numeric or p_qtd < 0 then raise exception 'Quantidade inválida.'; end if;
  if it.terceira is not null and it.terceira_por <> auth.uid() and it.terceira = p_qtd then   -- a outra pessoa confirma
    update est_ig_itens set final = p_qtd, situacao = 'resolvido', terceira_conf_por = auth.uid(), terceira_conf_em = now() where id = p_item;
    if not exists (select 1 from est_ig_itens where ig_local_id = gl.id and situacao = 'divergente') then
      update est_ig_locais set situacao = 'concluido', concluido_em = now() where id = gl.id;
      return 'concluido';
    end if;
    return 'terceira';
  end if;
  if length(coalesce(v_just, '')) < 5 then raise exception 'Informe a justificativa da diferença entre a contagem e a auditoria.'; end if;
  update est_ig_itens set terceira = p_qtd, terceira_por = auth.uid(), terceira_em = now(), justificativa = v_just, terceira_conf_por = null, terceira_conf_em = null where id = p_item;
  begin
    perform _notificar_u(gl.empresa_id, array[case when auth.uid() = gl.responsavel_id then gl.auditor_id else gl.responsavel_id end], 'inventario',
      'Inventário geral: confirmar a terceira contagem em ' || (select nome from est_locais where id = gl.local_id), 'Um item aguarda a sua confirmação.', '#/estoque/inventario-geral?i=' || gl.inventario_id, gl.inventario_id, false);
  exception when others then null; end;
  return 'confirmar';
end $$;

create or replace function public.est_ig_detalhe(p_inventario uuid)
returns table (item_id uuid, ig_local_id uuid, local_id uuid, produto_id uuid, codigo text, descricao text, unidade text, lote text, saldo_ref numeric, custo numeric,
               contado numeric, na_amostra boolean, auditado numeric, terceira numeric, final numeric, situacao text, incluido boolean, justificativa text, diferenca numeric, valor numeric, movimento_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare g est_ig_inventarios;
begin
  select * into g from est_ig_inventarios where id = p_inventario;
  if public._ig_cego(p_inventario) then raise exception 'Quem conta ou audita só vê o resultado depois que o seu local terminar.'; end if;
  if not found or not (public.est_ig_gerencia(g.empresa_id) or public._ig_aprova(g.empresa_id)) then raise exception 'Só quem gerencia ou aprova o inventário vê o resultado.'; end if;
  return query
  select i.id, i.ig_local_id, i.local_id, i.produto_id, p.codigo::text, p.descricao::text, p.unidade::text, lt.codigo::text, i.saldo_ref, i.custo,
         i.contado, i.na_amostra, i.auditado, i.terceira, i.final, i.situacao, i.incluido, i.justificativa,
         coalesce(i.final, i.contado) - i.saldo_ref, round((coalesce(i.final, i.contado) - i.saldo_ref) * i.custo, 2), i.movimento_id
    from est_ig_itens i join produtos p on p.id = i.produto_id left join est_lotes lt on lt.id = i.lote_id
   where i.inventario_id = p_inventario order by p.descricao, lt.codigo;
end $$;

create or replace function public.est_ig_acuracidade(p_inventario uuid)
returns table (ig_local_id uuid, local_id uuid, itens int, itens_certos int, pct_itens numeric, valor_sistema numeric, valor_diferenca numeric, pct_valor numeric,
               auditados int, divergiu_auditoria int, pct_auditoria numeric, minutos_contagem int, minutos_auditoria int)
language plpgsql stable security definer set search_path = public as $$
declare g est_ig_inventarios; cfg est_ig_config;
begin
  select * into g from est_ig_inventarios where id = p_inventario;
  if public._ig_cego(p_inventario) then raise exception 'Quem conta ou audita só vê a acuracidade depois que o seu local terminar.'; end if;
  if not found or not (public.est_ig_gerencia(g.empresa_id) or public._ig_aprova(g.empresa_id)) then raise exception 'Só quem gerencia ou aprova o inventário vê a acuracidade.'; end if;
  cfg := public._ig_cfg(g.empresa_id);
  return query
  select l.id, l.local_id, count(i.id)::int,
         count(*) filter (where abs(coalesce(i.final, i.contado, 0) - i.saldo_ref) <= i.saldo_ref * cfg.tolerancia_pct / 100 and abs((coalesce(i.final, i.contado, 0) - i.saldo_ref) * i.custo) <= cfg.tolerancia_valor)::int,
         round(100.0 * count(*) filter (where abs(coalesce(i.final, i.contado, 0) - i.saldo_ref) <= i.saldo_ref * cfg.tolerancia_pct / 100 and abs((coalesce(i.final, i.contado, 0) - i.saldo_ref) * i.custo) <= cfg.tolerancia_valor) / nullif(count(i.id), 0), 1),
         round(coalesce(sum(i.saldo_ref * i.custo), 0), 2), round(coalesce(sum(abs(coalesce(i.final, i.contado, 0) - i.saldo_ref) * i.custo), 0), 2),
         round(100 - 100.0 * coalesce(sum(abs(coalesce(i.final, i.contado, 0) - i.saldo_ref) * i.custo), 0) / nullif(sum(greatest(i.saldo_ref, coalesce(i.final, i.contado, 0)) * i.custo), 0), 1),
         count(i.auditado)::int, count(*) filter (where i.terceira is not null or i.situacao = 'divergente')::int,
         round(100.0 * count(*) filter (where i.terceira is not null or i.situacao = 'divergente') / nullif(count(i.auditado), 0), 1),
         (extract(epoch from (l.contado_em - l.iniciado_em)) / 60)::int, (extract(epoch from (l.auditado_em - l.contado_em)) / 60)::int
    from est_ig_locais l left join est_ig_itens i on i.ig_local_id = l.id
   where l.inventario_id = p_inventario group by l.id, l.local_id, l.contado_em, l.iniciado_em, l.auditado_em;
end $$;

create or replace function public.est_ig_aprovar(p_inventario uuid, p_sem_custo boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g est_ig_inventarios; cfg est_ig_config; it record; v_tipo uuid; v_si uuid; v_ajm uuid; v_ajn uuid; v_mov uuid; v_dif numeric; v_n int := 0; v_valor numeric := 0; v_semc int; v_fechou boolean := false; v_val numeric;
begin
  select * into g from est_ig_inventarios where id = p_inventario for update;
  if not found then raise exception 'Inventário não encontrado.'; end if;
  if g.situacao <> 'aberto' then raise exception 'Este inventário já foi encerrado.'; end if;
  if not public._ig_aprova(g.empresa_id) then raise exception 'Sem permissão para aprovar o inventário geral.'; end if;
  cfg := public._ig_cfg(g.empresa_id);
  if exists (select 1 from est_ig_locais where inventario_id = g.id and situacao <> 'concluido') then raise exception 'Há locais que ainda não terminaram a contagem, a auditoria ou a terceira contagem.'; end if;
  if not cfg.aprovar_quem_contou and exists (select 1 from est_ig_itens where inventario_id = g.id and auth.uid() in (contado_por, auditado_por, terceira_por, terceira_conf_por)) then
    raise exception 'Quem contou ou auditou não aprova o inventário. Peça a outro aprovador, ou libere a exceção nos parâmetros.';
  end if;
  select count(*) into v_semc from est_ig_itens where inventario_id = g.id and final > saldo_ref and custo = 0;
  if v_semc > 0 and not coalesce(p_sem_custo, false) then
    raise exception '% item(ns) com sobra não têm custo: informe o custo no resultado, ou confirme a entrada a custo zero.', v_semc;
  end if;
  select id into v_si from est_tipos_movimento where empresa_id = g.empresa_id and codigo = 'SI' and ativo;
  select id into v_ajm from est_tipos_movimento where empresa_id = g.empresa_id and codigo = 'AJ+' and ativo;
  select id into v_ajn from est_tipos_movimento where empresa_id = g.empresa_id and codigo = 'AJ-' and ativo;
  if v_ajm is null or v_ajn is null or v_si is null then raise exception 'Tipos de movimento de saldo inicial e de ajuste de inventário não configurados.'; end if;
  perform set_config('app.est_ig', g.id::text, true);   -- só os ajustes deste inventário passam pelo congelamento
  -- primeiro as sobras, depois as faltas: assim nenhuma falta esbarra em saldo que a sobra de outro lote vai repor
  for it in select i.* from est_ig_itens i where i.inventario_id = g.id and i.final is distinct from i.saldo_ref order by (i.final - i.saldo_ref) desc loop
    v_dif := it.final - it.saldo_ref;
    -- a sobra entra pelo custo médio do produto; produto que ainda não tem custo médio (nunca teve estoque) entra como saldo inicial, pelo custo do inventário
    v_tipo := case when v_dif <= 0 then v_ajn
                   when g.implantacao or coalesce((select c.custo_medio from est_custos c where c.produto_id = it.produto_id), 0) = 0 then v_si else v_ajm end;
    begin
      insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao)
      values (g.empresa_id, g.referencia, it.produto_id, it.local_id, it.lote_id, v_tipo, v_dif, case when v_tipo = v_si then it.custo end,
              'IG ' || g.numero, left(coalesce(it.justificativa, case when g.implantacao then 'Implantação pelo inventário geral' else 'Inventário geral' end), 200))
      returning id into v_mov;
    exception when others then   -- diz qual item não coube, em vez de devolver só o erro do lançamento
      raise exception 'Item % em %: %', (select codigo from produtos where id = it.produto_id), (select nome from est_locais where id = it.local_id), sqlerrm;
    end;
    update est_ig_itens set movimento_id = v_mov where id = it.id;
    v_n := v_n + 1;
  end loop;
  perform set_config('app.est_ig', '', true);
  -- recalcula já os produtos ajustados, desde a referência: o ajuste sai pelo custo da data, e o fechamento guarda esse valor
  for it in select distinct i.produto_id from est_ig_itens i where i.inventario_id = g.id and i.movimento_id is not null loop
    perform public._est_recalc(g.empresa_id, it.produto_id, g.referencia);
  end loop;
  select coalesce(sum(m.valor), 0) into v_valor from est_ig_itens i join est_movimentos m on m.id = i.movimento_id where i.inventario_id = g.id;
  if g.implantacao then
    insert into est_config (empresa_id, implantado_em) values (g.empresa_id, g.referencia)
    on conflict (empresa_id) do update set implantado_em = coalesce(est_config.implantado_em, excluded.implantado_em);
  end if;
  -- fecha o mês da referência quando ela é o último dia de um mês já terminado: a posição guardada passa a ser o inventário
  if cfg.fechar_mes and g.referencia = (date_trunc('month', g.referencia) + interval '1 month - 1 day')::date and date_trunc('month', g.referencia) < date_trunc('month', current_date) then
    perform public._est_fechar(g.empresa_id, g.referencia); v_fechou := true;
  end if;
  update est_ig_inventarios set situacao = 'aprovado', decidido_por = auth.uid(), decidido_nome = public._ig_nome(g.empresa_id, auth.uid()), decidido_em = now(),
         ajustes = v_n, valor_ajuste = round(v_valor, 2), mes_fechado = v_fechou where id = g.id;
  return jsonb_build_object('ajustes', v_n, 'valor', round(v_valor, 2), 'mes_fechado', v_fechou, 'implantacao', g.implantacao);
end $$;

create or replace function public.est_ig_trocar(p_ig_local uuid, p_responsavel uuid, p_auditor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare gl est_ig_locais;
begin
  gl := public._ig_local_aberto(p_ig_local);
  if not public.est_ig_gerencia(gl.empresa_id) then raise exception 'Só quem gerencia o inventário troca as pessoas.'; end if;
  if gl.situacao = 'concluido' then raise exception 'Este local já terminou.'; end if;
  if p_auditor is null and (gl.auditor_id is not null or gl.situacao <> 'contando') then raise exception 'Este local tem auditoria: escolha quem audita.'; end if;
  if p_responsavel is null or p_responsavel = p_auditor then raise exception 'Quem conta e quem audita precisam ser pessoas diferentes.'; end if;
  if exists (select 1 from est_ig_itens where ig_local_id = gl.id and (contado_por = p_auditor or auditado_por = p_responsavel)) then raise exception 'Quem já contou itens deste local não pode auditá-lo, e quem já auditou não pode contá-lo.'; end if;
  if not exists (select 1 from membros where empresa_id = gl.empresa_id and user_id = p_responsavel and papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao'))
     or (p_auditor is not null and not exists (select 1 from membros where empresa_id = gl.empresa_id and user_id = p_auditor and papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao'))) then
    raise exception 'Quem conta e quem audita precisam ter perfil de estoque.';
  end if;
  update est_ig_locais set responsavel_id = p_responsavel, responsavel_nome = public._ig_nome(gl.empresa_id, p_responsavel),
         auditor_id = p_auditor, auditor_nome = public._ig_nome(gl.empresa_id, p_auditor) where id = gl.id;
end $$;

-- contagem cíclica não nasce em local congelado pelo inventário geral
create or replace function public._est_inv_ig() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from est_ig_locais l join est_ig_inventarios g on g.id = l.inventario_id where l.local_id = new.local_id and g.situacao = 'aberto') then
    raise exception 'Este local está no inventário geral em andamento: a contagem cíclica volta depois da aprovação.';
  end if;
  return new;
end $$;
drop trigger if exists est_inv_contagens_ig on public.est_inv_contagens;
create trigger est_inv_contagens_ig before insert on public.est_inv_contagens for each row execute function public._est_inv_ig();

-- ------------------------------------------------------------ concessões
revoke all on function public._inv_cfg(uuid) from public, anon;
grant execute on function public._inv_cfg(uuid) to authenticated;
do $$ declare r record; begin
  for r in select p.oid::regprocedure f, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname ~ '^_?(est_ig|ig)_' or p.proname = '_est_inv_ig') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    if r.proname ~ '^est_ig_' then execute format('grant execute on function %s to authenticated', r.f); end if;
  end loop;
end $$;
