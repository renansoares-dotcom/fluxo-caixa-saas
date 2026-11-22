-- 177 — estoque: correções da avaliação do especialista (segurança, integridade e controles)
--  1. est_recalcular confere se o produto é da empresa, não toca em saldo de outra empresa e trava o custo durante o recálculo.
--  2. Lançamento direto no Kardex (pela tela) passa por uma guarda: autor verdadeiro, sem estorno/transferência/nota forjados,
--     custo só onde o tipo forma custo e, por parâmetro, quais perfis lançam cada tipo à mão (est_tipos_movimento.papeis_manual).
--  3. Lote conferido contra o produto e a empresa em todo movimento.
--  4. Estorno: um movimento só é estornado uma vez (índice único) e a transferência é estornada inteira (as duas pernas).
--  5. Inventário: item sem lote não duplica; aprovação trava a contagem; quem contou não aprova (parâmetro).
--  6. Requisição de material: quem pediu não aprova (parâmetro alm_config.aprovar_proprio).
--  7. Nota cancelada nunca é barrada pelo estoque: o que não estornar vira pendência.
--  8. Trilha de auditoria nos parâmetros do estoque, das etiquetas e do almoxarifado.
-- Aditivo: nada é apagado. Funções recriadas com a mesma assinatura (alm_config_salvar ganha um parâmetro opcional).

-- ------------------------------------------------------------ 1. recálculo
create or replace function public.est_recalcular(p_empresa uuid, p_produto uuid)
returns int language plpgsql security definer set search_path = public as $$
declare m record; q numeric := 0; v numeric := 0; cm numeric := 0; n int := 0; val numeric; cu numeric;
begin
  if not pode_editar(p_empresa) then raise exception 'Só administrador ou financeiro recalcula o estoque.'; end if;
  if not exists (select 1 from produtos where id = p_produto and empresa_id = p_empresa) then raise exception 'Produto não encontrado nesta empresa.'; end if;
  perform 1 from est_custos where produto_id = p_produto and empresa_id = p_empresa for update;   -- ninguém movimenta o produto durante o recálculo
  perform set_config('app.est_recalculo', 'sim', true);
  delete from est_saldos where produto_id = p_produto and empresa_id = p_empresa;
  for m in select mv.*, l.compoe_custo, l.controla_saldo, t.afeta_custo from est_movimentos mv join est_locais l on l.id = mv.local_id join est_tipos_movimento t on t.id = mv.tipo_movimento_id
            where mv.empresa_id = p_empresa and mv.produto_id = p_produto order by mv.data, mv.criado_em, mv.quantidade desc loop
    if m.quantidade > 0 and m.afeta_custo and m.estorno_de is null then cu := m.custo_unitario;
    elsif m.estorno_de is not null then cu := m.custo_unitario;
    else cu := case when q > 0 then v / q else cm end; end if;
    val := round(m.quantidade * cu, 2);
    if m.compoe_custo then q := q + m.quantidade; v := v + val; if q > 0 then cm := v / q; end if; end if;
    if m.controla_saldo then
      insert into est_saldos(empresa_id, produto_id, local_id, lote_id, quantidade, valor, ultimo_movimento)
      values (p_empresa, p_produto, m.local_id, m.lote_id, m.quantidade, val, m.data)
      on conflict (produto_id, local_id, coalesce(lote_id, '00000000-0000-0000-0000-000000000000'::uuid))
      do update set quantidade = est_saldos.quantidade + excluded.quantidade, valor = est_saldos.valor + excluded.valor, ultimo_movimento = excluded.ultimo_movimento;
    end if;
    update est_movimentos set custo_unitario = cu, valor = val, custo_medio_apos = cm where id = m.id;
    n := n + 1;
  end loop;
  insert into est_custos(produto_id, empresa_id, quantidade, valor, custo_medio) values (p_produto, p_empresa, q, v, cm)
  on conflict (produto_id) do update set quantidade = excluded.quantidade, valor = excluded.valor, custo_medio = excluded.custo_medio
    where est_custos.empresa_id = excluded.empresa_id;
  perform set_config('app.est_recalculo', 'nao', true);
  return n;
end $$;

-- ------------------------------------------------------------ 2 e 3. guarda do lançamento
alter table public.est_tipos_movimento add column if not exists papeis_manual text[];   -- perfis que lançam este tipo à mão; nulo ou vazio = todos que movimentam o estoque
comment on column public.est_tipos_movimento.papeis_manual is 'Perfis que podem lançar este tipo pela tela (o administrador sempre pode). Nulo ou vazio = todos que movimentam o estoque.';
-- saldo inicial e ajuste de inventário mexem no saldo sem documento: por padrão, só administrador, financeiro e diretor
update public.est_tipos_movimento set papeis_manual = '{financeiro,diretor}' where codigo in ('SI', 'AJ+', 'AJ-') and sistema and papeis_manual is null;
create or replace function public._est_tipo_padrao() returns trigger language plpgsql set search_path = public as $$
begin
  if new.papeis_manual is null and new.sistema and new.codigo in ('SI', 'AJ+', 'AJ-') then new.papeis_manual := '{financeiro,diretor}'; end if;
  return new;
end $$;
drop trigger if exists est_tipo_padrao on public.est_tipos_movimento;
create trigger est_tipo_padrao before insert on public.est_tipos_movimento for each row execute function public._est_tipo_padrao();

-- roda com os direitos de quem chama (não é security definer): assim distingue o lançamento direto pela tela
-- (current_user = authenticated) do lançamento feito pelas funções da plataforma (dono das funções).
create or replace function public._est_mov_guarda() returns trigger language plpgsql set search_path = public as $$
declare tm record; v_papel text;
begin
  if new.lote_id is not null and not exists (select 1 from est_lotes l where l.id = new.lote_id and l.produto_id = new.produto_id and l.empresa_id = new.empresa_id) then
    raise exception 'O lote informado não é deste produto.';
  end if;
  if current_user not in ('authenticated', 'anon') then return new; end if;
  -- lançamento direto pela tela
  if new.estorno_de is not null then raise exception 'Estorno só pelo botão Estornar.'; end if;
  if new.transferencia_id is not null then raise exception 'Transferência só pela função de transferência.'; end if;
  if new.nota_id is not null or new.nfe_item_id is not null then raise exception 'Movimento de nota fiscal é lançado pela plataforma.'; end if;
  select t.sentido, t.afeta_custo, t.papeis_manual, t.nome into tm from est_tipos_movimento t where t.id = new.tipo_movimento_id and t.empresa_id = new.empresa_id;
  if not found then raise exception 'Tipo de movimento não encontrado.'; end if;
  if tm.sentido = 'T' then raise exception 'Transferência só pela função de transferência.'; end if;
  if coalesce(cardinality(tm.papeis_manual), 0) > 0 then
    v_papel := papel_em(new.empresa_id);
    if v_papel is distinct from 'admin' and not (v_papel = any(tm.papeis_manual)) then
      raise exception 'Seu perfil não lança "%" à mão. Quem pode está em Estoque › Parâmetros › Tipos de movimento.', tm.nome;
    end if;
  end if;
  if not (tm.sentido = 'E' and tm.afeta_custo) then new.custo_unitario := null; end if;   -- custo informado só na entrada que forma custo
  new.criado_por := auth.uid(); new.criado_em := now();
  new.valor := null; new.custo_medio_apos := null; new.saldo_local_apos := null;
  return new;
end $$;
revoke all on function public._est_mov_guarda() from public, anon;
drop trigger if exists est_movimentos_a_guarda on public.est_movimentos;   -- o nome garante que roda antes do motor (ordem alfabética)
create trigger est_movimentos_a_guarda before insert on public.est_movimentos for each row execute function public._est_mov_guarda();

-- ------------------------------------------------------------ 4. estorno
do $$ begin
  if exists (select 1 from public.est_movimentos where estorno_de is not null group by estorno_de having count(*) > 1) then
    raise notice 'Há movimentos estornados mais de uma vez: o índice único não foi criado.';
  else
    create unique index if not exists est_mov_estorno_unico on public.est_movimentos(estorno_de) where estorno_de is not null;
  end if;
end $$;

create or replace function public.est_estornar(p_mov uuid, p_data date default current_date, p_motivo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m est_movimentos; x est_movimentos; v uuid; v_primeiro uuid;
begin
  select * into m from est_movimentos where id = p_mov for update;
  if not found then raise exception 'Movimento não encontrado'; end if;
  if not pode_estoque(m.empresa_id) then raise exception 'Sem permissão para movimentar o estoque.'; end if;
  -- a transferência é estornada inteira: primeiro a entrada (devolve do destino), depois a saída (repõe na origem)
  for x in select * from est_movimentos where id = m.id or (m.transferencia_id is not null and m.estorno_de is null and transferencia_id = m.transferencia_id and empresa_id = m.empresa_id and estorno_de is null)
            order by quantidade desc for update loop
    if exists (select 1 from est_movimentos where estorno_de = x.id) then
      if x.id = m.id then raise exception 'Movimento já estornado.'; end if;
      continue;
    end if;
    insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, estorno_de, documento, observacao, centro_custo_id)
    values (x.empresa_id, p_data, x.produto_id, x.local_id, x.lote_id, x.tipo_movimento_id, -x.quantidade, x.custo_unitario, x.id, x.documento,
            'Estorno' || coalesce(': ' || p_motivo, ''), x.centro_custo_id)
    returning id into v;
    if x.id = m.id then v_primeiro := v; end if;
  end loop;
  return v_primeiro;
end $$;

-- ------------------------------------------------------------ 5. inventário
alter table public.est_inv_config add column if not exists aprovar_propria boolean not null default false;   -- quem contou pode aprovar a própria contagem
create or replace function public._inv_cfg(p_empresa uuid) returns est_inv_config language sql stable security definer set search_path = public as $$
  select coalesce((select c from est_inv_config c where c.empresa_id = p_empresa),
                  (select row(p_empresa, 30, 60, 120, 20, 2, 100, true, true, array['admin', 'diretor', 'financeiro'], now(), null, false)::est_inv_config));
$$;
do $$ begin
  if exists (select 1 from public.est_inv_itens where lote_id is null group by contagem_id, produto_id having count(*) > 1) then
    raise notice 'Há itens de inventário repetidos sem lote: o índice único não foi criado.';
  else
    create unique index if not exists est_inv_itens_sem_lote on public.est_inv_itens(contagem_id, produto_id) where lote_id is null;
  end if;
end $$;

create or replace function public.est_inv_incluir(p_contagem uuid, p_produto uuid, p_lote uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c est_inv_contagens; v_id uuid;
begin
  select * into c from est_inv_contagens where id = p_contagem;
  if c.id is null or not public.pode_estoque(c.empresa_id) then raise exception 'Sem permissão.'; end if;
  if c.situacao <> 'aberta' then raise exception 'Contagem fechada.'; end if;
  if not exists (select 1 from produtos where id = p_produto and empresa_id = c.empresa_id) then raise exception 'Produto de outra empresa.'; end if;
  if p_lote is not null and not exists (select 1 from est_lotes where id = p_lote and produto_id = p_produto and empresa_id = c.empresa_id) then raise exception 'Lote de outro produto.'; end if;
  perform 1 from est_inv_contagens where id = c.id for update;
  select id into v_id from est_inv_itens where contagem_id = c.id and produto_id = p_produto and lote_id is not distinct from p_lote;
  if v_id is null then
    insert into est_inv_itens(empresa_id, contagem_id, produto_id, lote_id, classe) values (c.empresa_id, c.id, p_produto, p_lote, 'C') returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.est_inv_aprovar(p_contagem uuid, p_aprovar boolean, p_motivo text default null)
returns int language plpgsql security definer set search_path = public as $$
declare c est_inv_contagens; cfg est_inv_config; it record; v_tipo uuid; v_mov uuid; v_n int := 0; v_q numeric; v_dif numeric;
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

-- ------------------------------------------------------------ 6. requisição de material
alter table public.alm_config add column if not exists aprovar_proprio boolean not null default false;   -- quem pediu pode aprovar a própria requisição

create or replace function public.alm_decidir(p_id uuid, p_aprova boolean, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r alm_requisicoes;
begin
  select * into r from alm_requisicoes where id = p_id for update;
  if not found or not public.alm_aprovador(r.empresa_id) then raise exception 'Só quem aprova decide a requisição'; end if;
  if r.situacao <> 'aprovacao' then raise exception 'Esta requisição não está aguardando aprovação'; end if;
  if coalesce(p_aprova, false) and r.solicitante_id = auth.uid()
     and not coalesce((select aprovar_proprio from alm_config where empresa_id = r.empresa_id), false) then
    raise exception 'Quem pediu não aprova a própria requisição. Peça a outro aprovador ou libere em Parâmetros.';
  end if;
  if not coalesce(p_aprova, false) and length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Diga o motivo da recusa'; end if;
  update alm_requisicoes set situacao = case when p_aprova then 'aberta' else 'recusada' end, decidido_por = auth.uid(), decidido_nome = public._alm_nome(r.empresa_id),
    decidido_em = now(), decisao_motivo = left(nullif(trim(coalesce(p_motivo, '')), ''), 300), atualizado_em = now() where id = p_id;
  if r.solicitante_id is not null and r.solicitante_id <> auth.uid() then
    insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id)
    values (r.empresa_id, r.solicitante_id, 'almoxarifado', 'Requisição nº ' || r.numero || case when p_aprova then ' aprovada' else ' recusada' end, coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'Aguarde a separação no almoxarifado.'), '#/almoxarifado?id=' || p_id, p_id);
  end if;
  if p_aprova then perform public._alm_avisar(r.empresa_id, 'almoxarife', 'Requisição nº ' || r.numero || ' aprovada', 'Pode separar e entregar.', p_id); end if;
end $$;

drop function if exists public.alm_config_salvar(uuid, numeric, text[], uuid[], text[], uuid[], boolean, boolean, uuid[]);
create or replace function public.alm_config_salvar(p_empresa uuid, p_valor numeric, p_papeis_almoxarife text[], p_almoxarifes uuid[], p_papeis_aprovador text[], p_aprovadores uuid[],
  p_cracha boolean, p_balcao boolean, p_locais uuid[], p_aprovar_proprio boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare ok text[] := '{admin,diretor,financeiro,compras,vendas,producao,leitura}';
begin
  if not public.alm_gerencia(p_empresa) then raise exception 'Só o administrador ou o diretor muda os parâmetros do almoxarifado'; end if;
  if p_valor is not null and p_valor < 0 then raise exception 'Valor inválido'; end if;
  if not (coalesce(p_papeis_almoxarife, '{}') <@ ok) or not (coalesce(p_papeis_aprovador, '{}') <@ ok) then raise exception 'Perfil inválido'; end if;
  if exists(select 1 from unnest(coalesce(p_almoxarifes, '{}') || coalesce(p_aprovadores, '{}')) u where not exists(select 1 from membros m where m.empresa_id = p_empresa and m.user_id = u)) then raise exception 'Pessoa que não é desta empresa'; end if;
  if p_locais is not null and (array_length(p_locais, 1) is null or exists(select 1 from unnest(p_locais) x where not exists(select 1 from est_locais l where l.id = x and l.empresa_id = p_empresa))) then raise exception 'Local inválido'; end if;
  insert into alm_config (empresa_id, valor_aprovacao, papeis_almoxarife, almoxarifes, papeis_aprovador, aprovadores, exigir_cracha, permitir_balcao, locais, aprovar_proprio)
  values (p_empresa, p_valor, coalesce(p_papeis_almoxarife, '{}'), coalesce(p_almoxarifes, '{}'), coalesce(p_papeis_aprovador, '{}'), coalesce(p_aprovadores, '{}'), coalesce(p_cracha, false), coalesce(p_balcao, true), p_locais, coalesce(p_aprovar_proprio, false))
  on conflict (empresa_id) do update set valor_aprovacao = excluded.valor_aprovacao, papeis_almoxarife = excluded.papeis_almoxarife, almoxarifes = excluded.almoxarifes,
    papeis_aprovador = excluded.papeis_aprovador, aprovadores = excluded.aprovadores, exigir_cracha = excluded.exigir_cracha, permitir_balcao = excluded.permitir_balcao, locais = excluded.locais, aprovar_proprio = excluded.aprovar_proprio, atualizado_em = now();
end $$;
revoke all on function public.alm_config_salvar(uuid, numeric, text[], uuid[], text[], uuid[], boolean, boolean, uuid[], boolean) from public, anon;
grant execute on function public.alm_config_salvar(uuid, numeric, text[], uuid[], text[], uuid[], boolean, boolean, uuid[], boolean) to authenticated;

-- ------------------------------------------------------------ 7. nota cancelada
create or replace function public._est_nota_cancelada() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record; v_falhas int := 0; v_msg text;
begin
  if new.situacao = old.situacao or new.situacao = 'autorizada' then return null; end if;
  for m in select mv.* from est_movimentos mv where mv.nota_id = new.id and mv.estorno_de is null
            and not exists (select 1 from est_movimentos e where e.estorno_de = mv.id) loop
    begin
      insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, estorno_de, nota_id, documento, observacao)
      values (m.empresa_id, m.data, m.produto_id, m.local_id, m.lote_id, m.tipo_movimento_id, -m.quantidade, m.custo_unitario, m.id, m.nota_id, m.documento, 'Estorno: NF-e ' || new.situacao);
    exception when others then
      begin
        insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, estorno_de, nota_id, documento, observacao)
        values (m.empresa_id, current_date, m.produto_id, m.local_id, m.lote_id, m.tipo_movimento_id, -m.quantidade, m.custo_unitario, m.id, m.nota_id, m.documento, 'Estorno: NF-e ' || new.situacao);
      exception when others then
        -- o estorno não coube (ex.: o material já saiu): a nota é cancelada mesmo assim e o caso vira pendência para tratar
        v_falhas := v_falhas + 1; v_msg := sqlerrm;
      end;
    end;
  end loop;
  update est_pendencias set status = 'resolvida', resolvido_em = now() where nota_id = new.id and status = 'aberta';
  if v_falhas > 0 then
    insert into est_pendencias(empresa_id, nota_id, motivo, mensagem)
    values (new.empresa_id, new.id, 'erro', left('Nota ' || new.situacao || ': ' || v_falhas || ' movimento(s) não puderam ser estornados. ' || coalesce(v_msg, ''), 500));
  end if;
  return null;
end $$;

-- ------------------------------------------------------------ 8. auditoria dos parâmetros
do $$ declare t text; begin
  foreach t in array array['est_locais', 'est_familias', 'est_tipos_movimento', 'est_regras_cfop', 'est_config', 'etq_config', 'alm_config', 'alm_controlados'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists zz_auditoria on public.%1$I; create trigger zz_auditoria after insert or update or delete on public.%1$I for each row execute function public._auditar()', t);
    end if;
  end loop;
end $$;
