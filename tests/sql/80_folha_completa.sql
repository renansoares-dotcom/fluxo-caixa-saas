-- Folha completa (SQL 144): férias e rescisão com previsão no fluxo, confirmação/cancelamento, folha real e acesso do RH.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'u@t.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;
\set E '''e000000a-0000-0000-0000-000000000000'''
insert into rh_colaboradores(id, empresa_id, nome, vinculo, situacao, admissao, salario) values ('80000000-0000-0000-0000-0000000000c1', :E, 'COLAB 80', 'clt', 'ativo', '2021-05-10', 3000);
insert into rh_parametros(empresa_id, conta_id, planos) values (:E, 'c000000a-0000-0000-0000-000000000000', jsonb_build_object('salarios', 'f000000a-0000-0000-0000-000000000000'))
  on conflict (empresa_id) do update set conta_id = excluded.conta_id, planos = excluded.planos;
update membros set areas = array['rh'] where empresa_id = :E and user_id = 'd0000000-0000-0000-0000-00000000000d';

select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');   -- financeiro com a área RH
insert into rh_ferias(id, empresa_id, colaborador_id, aquisitivo_ini, gozo_ini, dias, abono_dias, salario, total, pagamento)
  values ('80000000-0000-0000-0000-0000000000f1', :E, '80000000-0000-0000-0000-0000000000c1', '2025-05-10', '2026-12-14', 20, 10, 3000, 5500, '2026-12-12');
select pg_temp.falha($$insert into rh_ferias(empresa_id, colaborador_id, aquisitivo_ini, gozo_ini, dias, abono_dias, pagamento) values ('e000000a-0000-0000-0000-000000000000', '80000000-0000-0000-0000-0000000000c1', '2025-05-10', '2026-12-14', 25, 10, '2026-12-12')$$, 'mais de 30 dias');
select public.rh_ferias_lancar('80000000-0000-0000-0000-0000000000f1');
select pg_temp.ok((select l.valor = 5500 and l.status = 'Em aberto' and l.data = '2026-12-12' from rh_ferias f join lancamentos l on l.id = f.lancamento_id where f.id = '80000000-0000-0000-0000-0000000000f1'), 'previsão das férias');
update rh_ferias set total = 5600 where id = '80000000-0000-0000-0000-0000000000f1';
select public.rh_ferias_lancar('80000000-0000-0000-0000-0000000000f1');
select pg_temp.ok((select count(*) = 1 and max(valor) = 5600 from lancamentos where origem = 'rh:ferias:80000000-0000-0000-0000-0000000000f1'), 'atualiza sem duplicar');
update rh_ferias set situacao = 'cancelada' where id = '80000000-0000-0000-0000-0000000000f1';
select public.rh_ferias_lancar('80000000-0000-0000-0000-0000000000f1');
select pg_temp.ok((select count(*) = 0 from lancamentos where origem = 'rh:ferias:80000000-0000-0000-0000-0000000000f1'), 'cancelada tira a previsão');

-- rescisão
insert into rh_rescisoes(id, empresa_id, colaborador_id, data_desligamento, motivo, aviso, salario, saldo_fgts, total, multa_fgts, pagamento)
  values ('80000000-0000-0000-0000-0000000000e1', :E, '80000000-0000-0000-0000-0000000000c1', '2026-11-10', 'sem_justa_causa', 'indenizado', 3000, 10000, 12833.33, 4272, '2026-11-20');
select public.rh_rescisao_lancar('80000000-0000-0000-0000-0000000000e1', true);
select pg_temp.ok((select situacao = 'confirmada' and lancamento_id is not null and lancamento_multa_id is not null from rh_rescisoes where id = '80000000-0000-0000-0000-0000000000e1'), 'confirmada com 2 previsões');
select pg_temp.ok((select situacao = 'desligado' and demissao = '2026-11-10' from rh_colaboradores where id = '80000000-0000-0000-0000-0000000000c1'), 'colaborador desligado');
select public.rh_rescisao_cancelar('80000000-0000-0000-0000-0000000000e1');
select pg_temp.ok((select situacao = 'ativo' and demissao is null from rh_colaboradores where id = '80000000-0000-0000-0000-0000000000c1'), 'cancelar volta a ativo');
select pg_temp.ok((select count(*) = 0 from lancamentos where origem like 'rh:rescisao%80000000-0000-0000-0000-0000000000e1'), 'previsões removidas');
-- paga não muda
reset role;
update rh_rescisoes set situacao = 'paga' where id = '80000000-0000-0000-0000-0000000000e1';
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$update rh_rescisoes set total = 1 where id = '80000000-0000-0000-0000-0000000000e1'$$, 'paga não muda');
select pg_temp.falha($$select public.rh_rescisao_lancar('80000000-0000-0000-0000-0000000000e1')$$, 'paga não relança');

-- folha real
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into rh_folhas(id, empresa_id, competencia, tipo, status) values ('80000000-0000-0000-0000-0000000000a1', :E, '2026-10-01', 'mensal', 'prevista');
insert into rh_folha_itens(id, empresa_id, folha_id, colaborador_id, salario, adiantamento, liquido) values ('80000000-0000-0000-0000-0000000000a2', :E, '80000000-0000-0000-0000-0000000000a1', '80000000-0000-0000-0000-0000000000c1', 3000, 1200, 1560);
insert into lancamentos(id, empresa_id, data, plano_id, conta_id, valor, status, descricao) values ('80000000-0000-0000-0000-0000000000a9', :E, '2026-11-05', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 1560, 'Em aberto', 'saldo');
insert into rh_folha_eventos(empresa_id, folha_id, evento, vencimento, valor, lancamento_id) values (:E, '80000000-0000-0000-0000-0000000000a1', 'saldo', '2026-11-05', 1560, '80000000-0000-0000-0000-0000000000a9'),
  (:E, '80000000-0000-0000-0000-0000000000a1', 'inss', '2026-11-18', 315, null);
select public.rh_folha_real('80000000-0000-0000-0000-0000000000a1', '[{"item_id":"80000000-0000-0000-0000-0000000000a2","liquido":2650.4,"inss":330,"fgts":240}]'::jsonb, null, true);
select pg_temp.ok((select valor = 1450.4 from rh_folha_eventos where folha_id = '80000000-0000-0000-0000-0000000000a1' and evento = 'saldo'), 'saldo = real − adiantamento');
select pg_temp.ok((select valor = 1450.4 from lancamentos where id = '80000000-0000-0000-0000-0000000000a9'), 'previsão em aberto atualizada');
select pg_temp.ok((select valor = 330 from rh_folha_eventos where folha_id = '80000000-0000-0000-0000-0000000000a1' and evento = 'inss'), 'INSS do real');
select pg_temp.ok((select (real_totais ->> 'itens')::int = 1 and real_importado_em is not null from rh_folhas where id = '80000000-0000-0000-0000-0000000000a1'), 'totais do real');

select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');   -- leitura sem área RH
select pg_temp.ok((select count(*) from rh_ferias where empresa_id = :E) = 0, 'sem RH não vê férias');
select pg_temp.falha($$select public.rh_ferias_lancar('80000000-0000-0000-0000-0000000000f1')$$, 'sem RH não lança');
reset role;
update membros set areas = null where empresa_id = :E and user_id = 'd0000000-0000-0000-0000-00000000000d';
\o
select 'ok 80 folha completa';
