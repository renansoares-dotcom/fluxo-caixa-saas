-- Painel da Diretoria (SQL 101): faturamento líquido pela regra do CFOP, produção e perdas, RNC, entregas no prazo e
-- pagamentos da recuperação judicial por mês; metas e comentários por papel.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'teste@exemplo.com')::text, false);
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

-- CFOP
select pg_temp.ok(_dir_fat_sinal('5101', true) = 1 and _dir_fat_sinal('6403', true) = 1, 'venda própria');
select pg_temp.ok(_dir_fat_sinal('1201', true) = -1, 'devolução de cliente (nota própria de entrada)');
select pg_temp.ok(_dir_fat_sinal('5202', false) = -1, 'devolução de cliente (nota do cliente)');
select pg_temp.ok(_dir_fat_sinal('5101', false) = 0 and _dir_fat_sinal('5949', true) = 0 and _dir_fat_sinal('x', true) is null, 'compra e outras saídas fora');

-- dados de outubro/2026 (empresa A)
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao) values
  ('d3700000-0000-0000-0000-000000000001', :E, 'CH37-1', 1, '2026-10-05', 'saida', true, 'autorizada'),
  ('d3700000-0000-0000-0000-000000000002', :E, 'CH37-2', 2, '2026-10-06', 'saida', true, 'cancelada'),
  ('d3700000-0000-0000-0000-000000000003', :E, 'CH37-3', 3, '2026-10-20', 'saida', false, 'autorizada'),
  ('d3700000-0000-0000-0000-000000000004', :E, 'CH37-4', 4, '2026-09-10', 'saida', true, 'autorizada');
insert into nfe_itens(empresa_id, nota_id, n_item, cfop, vprod, vdesc, v_ipi) values
  (:E, 'd3700000-0000-0000-0000-000000000001', 1, '5101', 1000, 100, 50),
  (:E, 'd3700000-0000-0000-0000-000000000001', 2, '5949', 500, 0, 0),
  (:E, 'd3700000-0000-0000-0000-000000000002', 1, '5101', 9999, 0, 0),
  (:E, 'd3700000-0000-0000-0000-000000000003', 1, '5202', 200, 0, 0),
  (:E, 'd3700000-0000-0000-0000-000000000004', 1, '5101', 700, 0, 0);
insert into prod_ordens(id, empresa_id, quantidade) values ('d3700000-0000-0000-0000-0000000000a1', :E, 1000);
insert into prod_apontamentos(empresa_id, ordem_id, inicio, qtd_boa, refugo) values
  (:E, 'd3700000-0000-0000-0000-0000000000a1', '2026-10-10 10:00-03', 900, 100),
  (:E, 'd3700000-0000-0000-0000-0000000000a1', '2026-10-31 23:30-03', 50, 0);
insert into qual_rnc(empresa_id, numero, origem, descricao, aberta_em, situacao, custo, encerrada_em) values
  (:E, 3701, 'cliente', 'Reclamação', '2026-10-03', 'aberta', 300, null),
  (:E, 3702, 'processo', 'Processo', '2026-10-04', 'encerrada', 0, '2026-10-20'),
  (:E, 3703, 'cliente', 'Cancelada', '2026-10-05', 'cancelada', 0, null);
update qual_rnc set encerrada_em = '2026-10-20' where numero = 3702;   -- o gatilho grava a data de hoje ao encerrar
insert into log_cargas(id, empresa_id, data, status) values ('d3700000-0000-0000-0000-0000000000c1', :E, '2026-10-06', 'concluida');
insert into log_carga_notas(empresa_id, carga_id, nota_id, situacao, entregue_em) values
  (:E, 'd3700000-0000-0000-0000-0000000000c1', 'd3700000-0000-0000-0000-000000000001', 'entregue', '2026-10-07 10:00-03'),
  (:E, 'd3700000-0000-0000-0000-0000000000c1', 'd3700000-0000-0000-0000-000000000004', 'entregue', '2026-10-07 10:00-03');
insert into plano_contas(id, empresa_id, codigo, nome, natureza, nivel, tipo) values ('d3700000-0000-0000-0000-0000000000b1', :E, '2.09.37', 'PAGAMENTO RJ TESTE', 'D', 2, 'S');
insert into lancamentos(empresa_id, data, plano_id, conta_id, valor, descricao, status) values
  (:E, '2026-10-15', 'd3700000-0000-0000-0000-0000000000b1', 'c000000a-0000-0000-0000-000000000000', 450000, 'PARCELA RJ 37', 'Pago'),
  (:E, '2026-10-16', 'd3700000-0000-0000-0000-0000000000b1', 'c000000a-0000-0000-0000-000000000000', 1000, 'PARCELA RJ EM ABERTO 37', 'Em aberto');

-- quem não é da empresa não vê
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select diretoria_operacional('e000000a-0000-0000-0000-000000000000', '2026-10-31')$$, 'outra empresa');
-- compras não vê o painel
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.falha($$select diretoria_operacional('e000000a-0000-0000-0000-000000000000', '2026-10-31')$$, 'compras não vê');

-- financeiro não altera metas nem parâmetros, mas comenta
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$insert into diretoria_metas(empresa_id, indicador, ano, meta) values ('e000000a-0000-0000-0000-000000000000', 'faturamento', 2026, 1)$$, 'financeiro não grava meta');
insert into diretoria_comentarios(empresa_id, mes, indicador, texto) values (:E, '2026-10-01', 'faturamento', 'Mês com feriado');
select pg_temp.ok((select autor from diretoria_comentarios where empresa_id = :E and indicador = 'faturamento') = 'teste@exemplo.com', 'comentário com autor');

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into diretoria_config(empresa_id, rj_planos, rj_previsto) values (:E, array['d3700000-0000-0000-0000-0000000000b1'::uuid], 450000);
insert into diretoria_metas(empresa_id, indicador, ano, meta) values (:E, 'faturamento', 2026, 800000), (:E, 'perdas', 2026, 6);
create temp table r as select diretoria_operacional('e000000a-0000-0000-0000-000000000000', '2026-10-31') j;
select pg_temp.ok((select jsonb_array_length(j -> 'meses') = 13 and j -> 'meses' ->> 12 = '2026-10' and j -> 'meses' ->> 0 = '2025-10' from r), '13 meses');
select pg_temp.ok((select (j -> 'fat_venda' ->> 12)::numeric = 950 from r), 'venda: 1000 − 100 + 50 de IPI; cancelada e 5.949 fora');
select pg_temp.ok((select (j -> 'fat_devolucao' ->> 12)::numeric = 200 from r), 'devolução do cliente');
select pg_temp.ok((select (j -> 'fat_venda' ->> 11)::numeric = 700 from r), 'setembro');
select pg_temp.ok((select (j -> 'prod_boa' ->> 12)::numeric = 950 and (j -> 'prod_refugo' ->> 12)::numeric = 100 from r), 'produção pelo fuso de Recife (31/10 23h30 fica em outubro)');
select pg_temp.ok((select (j -> 'rnc_mes' ->> 12)::int = 2 and (j -> 'rnc_cliente' ->> 12)::int = 1 and (j -> 'rnc_em_aberto' ->> 12)::int = 1 and (j -> 'rnc_custo' ->> 12)::numeric = 300 from r), 'RNC (cancelada fora)');
select pg_temp.ok((select (j -> 'ent_entregues' ->> 12)::int = 2 and (j -> 'ent_medidas' ->> 12)::int = 2 and (j -> 'ent_no_prazo' ->> 12)::int = 1 from r), 'entrega no prazo: 2 dias sim, 27 dias não');
select pg_temp.ok((select (j -> 'rj_pago' ->> 12)::numeric = 450000 from r), 'RJ: só o pago, nos planos da RJ');
reset role;

-- limpeza
delete from lancamentos where descricao like 'PARCELA RJ%37'; delete from plano_contas where id = 'd3700000-0000-0000-0000-0000000000b1';
delete from log_carga_notas where carga_id = 'd3700000-0000-0000-0000-0000000000c1'; delete from log_cargas where id = 'd3700000-0000-0000-0000-0000000000c1';
delete from qual_rnc where numero between 3701 and 3703;
delete from prod_apontamentos where ordem_id = 'd3700000-0000-0000-0000-0000000000a1'; delete from prod_ordens where id = 'd3700000-0000-0000-0000-0000000000a1';
delete from nfe_itens where nota_id::text like 'd3700000%'; delete from nfe_notas where id::text like 'd3700000%';
delete from diretoria_metas; delete from diretoria_config; delete from diretoria_comentarios;
