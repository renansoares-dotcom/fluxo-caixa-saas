-- Operações em um passo só + desfazer (21/10/2026).
-- Motivo: correções feitas em vários passos (baixar o título, mover a conciliação, excluir o duplicado) ficavam pela
-- metade quando um passo falhava ou era cancelado. Aqui:
--  1) auditoria.operacao: cada alteração feita dentro de uma operação leva o mesmo número (lote), para ver e desfazer junto;
--  2) mesclar_lancamentos(manter, excluir): une dois lançamentos que são o mesmo fato (ex.: título da NF em aberto +
--     recebimento importado do extrato/ERP) numa transação só: o que fica assume data/conta/status do pagamento, recebe
--     conciliações, vínculos de nota, borderô, créditos etc., e o outro é excluído. Ou tudo, ou nada;
--  3) baixar_parcial(título, valor, data, conta): baixa só o recebido; o saldo continua em aberto (mesma NF/parcela);
--  4) desfazer_operacao(lote) e desfazer_auditoria(id): volta o que foi registrado na auditoria (inclusão → exclui,
--     exclusão → recria, alteração → volta os campos), só se o registro não mudou de novo depois. Admin/diretor.
-- Aditivo: não altera nem apaga dados existentes. Pode rodar mais de uma vez.

alter table public.auditoria add column if not exists operacao uuid;
alter table public.auditoria add column if not exists operacao_nome text;
create index if not exists auditoria_operacao on public.auditoria(operacao) where operacao is not null;

-- _auditar: igual à versão 038, agora gravando o lote da operação em andamento (app.operacao), se houver
create or replace function public._auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(r_new, r_old);
  v_emp uuid := (r ->> 'empresa_id')::uuid;
  v_reg text := coalesce(r ->> 'id', r ->> 'plano_id', r ->> 'conta_bancaria_id',
                         (r ->> 'favorecido_id') || coalesce(':' || (r ->> 'papel'), ''), r ->> 'user_id');
  v_op uuid := nullif(current_setting('app.operacao', true), '')::uuid;
  v_opn text := nullif(current_setting('app.operacao_nome', true), '');
  ign text[] := array['updated_at', 'created_at', 'atualizado_em', 'criado_em', 'xml'];
  k text; mudou text[] := '{}'; a jsonb := '{}'; d jsonb := '{}';
begin
  if v_emp is null then return null; end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(r_new) loop
      if k = any(ign) then continue; end if;
      if (r_old -> k) is distinct from (r_new -> k) then
        mudou := mudou || k; a := a || jsonb_build_object(k, r_old -> k); d := d || jsonb_build_object(k, r_new -> k);
      end if;
    end loop;
    if cardinality(mudou) = 0 then return null; end if;
    insert into auditoria(empresa_id, user_id, user_email, tabela, registro_id, acao, campos, antes, depois, operacao, operacao_nome)
    values (v_emp, auth.uid(), auth.jwt() ->> 'email', tg_table_name, v_reg, 'alterou', mudou, a, d, v_op, v_opn);
  else
    -- na exclusão guarda o registro inteiro (inclusive created_at) para poder recriar igual
    insert into auditoria(empresa_id, user_id, user_email, tabela, registro_id, acao, antes, depois, operacao, operacao_nome)
    values (v_emp, auth.uid(), auth.jwt() ->> 'email', tg_table_name, v_reg,
            case tg_op when 'INSERT' then 'incluiu' else 'excluiu' end,
            case when tg_op = 'DELETE' then r_old - 'xml' end, case when tg_op = 'INSERT' then r_new - ign end, v_op, v_opn);
  end if;
  return null;
end $$;
revoke all on function public._auditar() from public, anon, authenticated;

-- quem pode: chamada pelo app (usuário com papel) ou direto no banco (SQL Editor / manutenção, sem JWT)
create or replace function public._pode_operar(p_empresa uuid, p_papeis text[])
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is null and coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated')
      or exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text = any(p_papeis));
$$;
revoke all on function public._pode_operar(uuid, text[]) from public, anon, authenticated;

-- abre um lote de operação (vale até o fim da transação)
create or replace function public._iniciar_operacao(p_nome text) returns uuid
language plpgsql set search_path = public as $$
declare v uuid := gen_random_uuid();
begin
  perform set_config('app.operacao', v::text, true);
  perform set_config('app.operacao_nome', left(p_nome, 200), true);
  return v;
end $$;
revoke all on function public._iniciar_operacao(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Mesclar dois lançamentos que são o mesmo fato
-- ---------------------------------------------------------------------------------------------
create or replace function public.mesclar_lancamentos(p_manter uuid, p_excluir uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a lancamentos; b lancamentos; na text; nb text; v_op uuid; fk record; n int; movidos jsonb := '{}';
  conc_a boolean; muda boolean;
begin
  if p_manter = p_excluir then raise exception 'Escolha dois lançamentos diferentes'; end if;
  select * into a from lancamentos where id = p_manter for update;
  select * into b from lancamentos where id = p_excluir for update;
  if a.id is null or b.id is null then raise exception 'Lançamento não encontrado'; end if;
  if a.empresa_id <> b.empresa_id then raise exception 'Lançamentos de empresas diferentes'; end if;
  if not _pode_operar(a.empresa_id, array['admin', 'financeiro']) then raise exception 'Sem permissão para mesclar lançamentos'; end if;
  if abs(a.valor - b.valor) >= 0.005 then raise exception 'Valores diferentes (% × %): mesclar só une lançamentos do mesmo valor', a.valor, b.valor; end if;
  select natureza into na from plano_contas where id = a.plano_id;
  select natureza into nb from plano_contas where id = b.plano_id;
  if na is distinct from nb then raise exception 'Um é entrada e o outro é saída: não são o mesmo fato'; end if;
  if a.conta_destino_id is not null or b.conta_destino_id is not null then raise exception 'Transferências não são mescladas por aqui'; end if;
  if a.fidc_proposta_id is not null and b.fidc_proposta_id is not null and a.fidc_proposta_id <> b.fidc_proposta_id then
    raise exception 'Os dois estão em borderôs diferentes'; end if;

  v_op := _iniciar_operacao(coalesce('Mesclar: ' || p_motivo, 'Mesclar lançamentos') || ' — mantém ' || coalesce(a.documento, left(a.descricao, 40)));

  -- o que fica assume o pagamento (data, conta, status) quando ele é o título em aberto e o outro já está pago
  conc_a := exists (select 1 from conciliacoes where lancamento_id = a.id);
  muda := a.status <> 'Pago' and b.status = 'Pago';
  if muda then
    if conc_a then raise exception 'O lançamento que fica já está conciliado e precisaria mudar de data/conta'; end if;
    update lancamentos set status = 'Pago', data = b.data, conta_id = coalesce(b.conta_id, a.conta_id),
           fidc_proposta_id = coalesce(a.fidc_proposta_id, b.fidc_proposta_id), updated_at = now()
     where id = a.id;
  elsif a.fidc_proposta_id is null and b.fidc_proposta_id is not null and not conc_a then
    update lancamentos set fidc_proposta_id = b.fidc_proposta_id where id = a.id;
  end if;

  -- leva tudo que aponta para o excluído (conciliação, nota, borderô, crédito, autorização, duplicata…)
  for fk in select c.conrelid::regclass::text t, att.attname col
              from pg_constraint c join pg_attribute att on att.attrelid = c.conrelid and att.attnum = c.conkey[1]
             where c.contype = 'f' and c.confrelid = 'public.lancamentos'::regclass and cardinality(c.conkey) = 1 loop
    begin
      execute format('update %s set %I = $1 where %I = $2', fk.t, fk.col, fk.col) using a.id, b.id;
      get diagnostics n = row_count;
      if n > 0 then movidos := movidos || jsonb_build_object(fk.t, n); end if;
    exception when unique_violation then
      raise exception 'Os dois já estão ligados ao mesmo item em % (ex.: conciliados na mesma conta): revise antes de mesclar', fk.t;
    end;
  end loop;

  delete from lancamentos where id = b.id;
  return jsonb_build_object('operacao', v_op, 'mantido', a.id, 'excluido', b.id, 'assumiu_pagamento', muda, 'movidos', movidos);
end $$;
revoke all on function public.mesclar_lancamentos(uuid, uuid, text) from public, anon;
grant execute on function public.mesclar_lancamentos(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Baixa parcial de um título em aberto: o título vira o valor recebido (Pago) e o saldo continua em aberto num
-- título novo, com o mesmo documento, nota e vencimento. Até existir o modelo de baixas (título × várias baixas).
-- ---------------------------------------------------------------------------------------------
create or replace function public.baixar_parcial(p_titulo uuid, p_valor numeric, p_data date, p_conta uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t lancamentos; v_novo uuid; v_saldo numeric; v_op uuid;
begin
  select * into t from lancamentos where id = p_titulo for update;
  if t.id is null then raise exception 'Título não encontrado'; end if;
  if not _pode_operar(t.empresa_id, array['admin', 'financeiro']) then raise exception 'Sem permissão para baixar títulos'; end if;
  if t.status <> 'Em aberto' then raise exception 'O título % não está em aberto', coalesce(t.documento, t.id::text); end if;
  p_valor := round(p_valor, 2); v_saldo := round(t.valor - p_valor, 2);
  if p_valor <= 0 or v_saldo <= 0 then raise exception 'Valor da baixa parcial deve ser maior que zero e menor que o título (%)', t.valor; end if;
  v_op := _iniciar_operacao(coalesce('Baixa parcial: ' || p_motivo, 'Baixa parcial') || ' — ' || coalesce(t.documento, left(t.descricao, 40)));
  insert into lancamentos(empresa_id, data, plano_id, descricao, opc1, opc2, opc3, opc4, favorecido_id, centro_custo_id, status, conta_id, valor,
                          prioridade, origem, created_by, documento, emissao)
  values (t.empresa_id, t.data, t.plano_id, left(t.descricao || ' (saldo)', 500), t.opc1, t.opc2, t.opc3, t.opc4, t.favorecido_id, t.centro_custo_id,
          'Em aberto', t.conta_id, v_saldo, t.prioridade, t.origem, auth.uid(), t.documento, t.emissao)
  returning id into v_novo;
  update lancamentos set status = 'Pago', valor = p_valor, data = p_data, conta_id = coalesce(p_conta, conta_id), updated_at = now() where id = t.id;
  -- o saldo fica ligado à mesma nota/parcela
  insert into nfe_vinculos(empresa_id, nota_id, parcela_id, lancamento_id, tipo)
  select empresa_id, nota_id, parcela_id, v_novo, tipo from nfe_vinculos where lancamento_id = t.id and tipo = 'titulo';
  return jsonb_build_object('operacao', v_op, 'baixado', t.id, 'saldo_id', v_novo, 'saldo', v_saldo);
end $$;
revoke all on function public.baixar_parcial(uuid, numeric, date, uuid, text) from public, anon;
grant execute on function public.baixar_parcial(uuid, numeric, date, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Desfazer pela auditoria
-- ---------------------------------------------------------------------------------------------
create or replace function public._desfazer_um(r auditoria) returns text
language plpgsql security definer set search_path = public as $$
declare
  t text := 'public.' || quote_ident(r.tabela); cols text; atual jsonb; k text;
begin
  if r.registro_id is null or not exists (select 1 from pg_attribute where attrelid = t::regclass and attname = 'id' and not attisdropped) then
    raise exception 'Registro % de % não pode ser desfeito automaticamente', r.registro_id, r.tabela; end if;
  execute format('select to_jsonb(x) from %s x where x.id::text = $1', t) into atual using r.registro_id;
  if r.acao = 'incluiu' then
    if atual is null then return 'já não existia'; end if;
    for k in select jsonb_object_keys(r.depois) loop
      if (atual -> k) is distinct from (r.depois -> k) then raise exception '% % mudou depois da inclusão (campo %): desfaça as mudanças mais novas antes', r.tabela, r.registro_id, k; end if;
    end loop;
    execute format('delete from %s where id::text = $1', t) using r.registro_id;
    return 'excluído';
  elsif r.acao = 'excluiu' then
    if atual is not null then return 'já existia'; end if;
    select string_agg(quote_ident(attname), ',') into cols from pg_attribute
     where attrelid = t::regclass and attnum > 0 and not attisdropped and attgenerated = '' and r.antes ? attname;
    execute format('insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1)', t, cols, cols, t) using r.antes;
    return 'recriado';
  else
    if atual is null then raise exception '% % foi excluído depois: desfaça a exclusão antes', r.tabela, r.registro_id; end if;
    foreach k in array r.campos loop
      if (atual -> k) is distinct from (r.depois -> k) then raise exception '% % mudou de novo depois (campo %): desfaça as mudanças mais novas antes', r.tabela, r.registro_id, k; end if;
    end loop;
    select string_agg(quote_ident(c), ',') into cols from unnest(r.campos) c;
    execute format('update %s set (%s) = (select %s from jsonb_populate_record(null::%s, $1)) where id::text = $2', t, cols, cols, t)
      using r.antes, r.registro_id;
    return 'voltou';
  end if;
end $$;
revoke all on function public._desfazer_um(auditoria) from public, anon, authenticated;

create or replace function public.desfazer_operacao(p_operacao uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r auditoria; v_emp uuid; res jsonb := '[]'; v_nome text;
begin
  select empresa_id, operacao_nome into v_emp, v_nome from auditoria where operacao = p_operacao limit 1;
  if v_emp is null then raise exception 'Operação não encontrada'; end if;
  if not _pode_operar(v_emp, array['admin', 'diretor']) then raise exception 'Somente o administrador ou o diretor pode desfazer'; end if;
  perform _iniciar_operacao('Desfazer: ' || coalesce(v_nome, p_operacao::text));
  -- de trás para frente; a trava de conciliação é respeitada porque a ordem inversa recria a conciliação por último
  for r in select * from auditoria where operacao = p_operacao order by id desc loop
    res := res || jsonb_build_object('tabela', r.tabela, 'registro', r.registro_id, 'acao', r.acao, 'resultado', _desfazer_um(r));
  end loop;
  return res;
end $$;
revoke all on function public.desfazer_operacao(uuid) from public, anon;
grant execute on function public.desfazer_operacao(uuid) to authenticated;

create or replace function public.desfazer_auditoria(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare r auditoria;
begin
  select * into r from auditoria where id = p_id;
  if r.id is null then raise exception 'Registro de auditoria não encontrado'; end if;
  if r.operacao is not null then return desfazer_operacao(r.operacao)::text; end if;
  if not _pode_operar(r.empresa_id, array['admin', 'diretor']) then raise exception 'Somente o administrador ou o diretor pode desfazer'; end if;
  perform _iniciar_operacao('Desfazer alteração ' || p_id);
  return _desfazer_um(r);
end $$;
revoke all on function public.desfazer_auditoria(bigint) from public, anon;
grant execute on function public.desfazer_auditoria(bigint) to authenticated;

-- conferência: deve listar as 4 funções
select proname from pg_proc where proname in ('mesclar_lancamentos', 'baixar_parcial', 'desfazer_operacao', 'desfazer_auditoria') order by 1;
