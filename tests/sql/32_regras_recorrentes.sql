-- Regras de classificação, rateio, divisão, edição em lote e recorrentes (SQL 096).
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'admin.a@exemplo.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;

insert into plano_contas(id, empresa_id, codigo, nome, natureza, nivel, tipo) values
  ('f3200000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', '2.06.02', 'COMBUSTÍVEL', 'D', 2, 'S'),
  ('f3200000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', '2.03.01', 'ALUGUEL', 'D', 2, 'S');
insert into centros_custo(id, empresa_id, nome) values
  ('cc320000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'EXTRUSÃO'),
  ('cc320000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', 'CORTE'),
  ('cc320000-0000-0000-0000-000000000003', 'e000000b-0000-0000-0000-000000000000', 'OUTRA EMPRESA');

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
-- rateio: soma 100, dois centros, da mesma empresa
select pg_temp.falha($q$insert into cc_rateios(empresa_id, nome, partes) values ('e000000a-0000-0000-0000-000000000000', 'x', '[{"centro_custo_id":"cc320000-0000-0000-0000-000000000001","pct":60},{"centro_custo_id":"cc320000-0000-0000-0000-000000000002","pct":30}]')$q$, 'rateio precisa somar 100');
select pg_temp.falha($q$insert into cc_rateios(empresa_id, nome, partes) values ('e000000a-0000-0000-0000-000000000000', 'x', '[{"centro_custo_id":"cc320000-0000-0000-0000-000000000001","pct":50},{"centro_custo_id":"cc320000-0000-0000-0000-000000000003","pct":50}]')$q$, 'centro de outra empresa');
insert into cc_rateios(empresa_id, nome, partes) values ('e000000a-0000-0000-0000-000000000000', 'Energia', '[{"centro_custo_id":"cc320000-0000-0000-0000-000000000001","pct":70},{"centro_custo_id":"cc320000-0000-0000-0000-000000000002","pct":30}]');
-- regra
insert into lanc_regras(empresa_id, texto, natureza, plano_id, centro_custo_id) values ('e000000a-0000-0000-0000-000000000000', 'POSTO', 'S', 'f3200000-0000-0000-0000-000000000001', 'cc320000-0000-0000-0000-000000000001');
select pg_temp.falha($q$insert into lanc_regras(empresa_id, texto, operador, plano_id) values ('e000000a-0000-0000-0000-000000000000', '([', 'regex', 'f3200000-0000-0000-0000-000000000001')$q$, 'regex inválida');
select pg_temp.falha($q$insert into lanc_regras(empresa_id, texto, plano_id) values ('e000000a-0000-0000-0000-000000000000', 'X', 'f000000b-0000-0000-0000-000000000000')$q$, 'plano de outra empresa');

-- dividir
insert into lancamentos(id, empresa_id, data, plano_id, conta_id, valor, descricao, status) values
  ('ab320000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', '2026-10-05', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 1000, 'ENERGIA', 'Pago'),
  ('ab320000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', '2026-10-06', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 80, 'POSTO SHELL', 'Pago'),
  ('ab320000-0000-0000-0000-000000000003', 'e000000a-0000-0000-0000-000000000000', '2026-10-07', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 90, 'POSTO IPIRANGA', 'Pago');
select pg_temp.falha($q$select lanc_dividir('ab320000-0000-0000-0000-000000000001', '[{"centro_custo_id":"cc320000-0000-0000-0000-000000000001","valor":700},{"centro_custo_id":"cc320000-0000-0000-0000-000000000002","valor":200}]')$q$, 'partes têm de somar o valor');
select pg_temp.ok(lanc_dividir('ab320000-0000-0000-0000-000000000001', '[{"centro_custo_id":"cc320000-0000-0000-0000-000000000001","valor":700},{"centro_custo_id":"cc320000-0000-0000-0000-000000000002","valor":300}]') = 2, 'dividiu em 2');
select pg_temp.ok((select sum(valor) = 1000 and count(*) = 2 from lancamentos where id = 'ab320000-0000-0000-0000-000000000001' or origem = 'divisao:ab320000-0000-0000-0000-000000000001'), 'soma preservada');
select pg_temp.ok((select centro_custo_id = 'cc320000-0000-0000-0000-000000000002' and descricao like '%(rateio 2/2)' from lancamentos where origem = 'divisao:ab320000-0000-0000-0000-000000000001'), 'segunda parte com o centro');

-- edição em lote (o conciliado fica de fora)
reset role;
insert into extrato_itens(id, empresa_id, conta_id, data, valor, fitid, status) values ('aa320000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', '2026-10-07', -90, 't32', 'conciliado');
insert into conciliacoes(empresa_id, conta_id, extrato_id, lancamento_id) values ('e000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 'aa320000-0000-0000-0000-000000000001', 'ab320000-0000-0000-0000-000000000003');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select (r ->> 'alterados')::int = 1 and (r ->> 'conciliados')::int = 1 from (select lanc_editar_lote(array['ab320000-0000-0000-0000-000000000002', 'ab320000-0000-0000-0000-000000000003']::uuid[], '{"plano_id":"f3200000-0000-0000-0000-000000000001","centro_custo_id":"cc320000-0000-0000-0000-000000000001"}') r) x), 'lote altera 1 e pula o conciliado');
select pg_temp.ok((select plano_id = 'f3200000-0000-0000-0000-000000000001' from lancamentos where id = 'ab320000-0000-0000-0000-000000000002'), 'plano trocado');
select pg_temp.falha($q$select lanc_dividir('ab320000-0000-0000-0000-000000000003', '[{"centro_custo_id":"cc320000-0000-0000-0000-000000000001","valor":45},{"centro_custo_id":"cc320000-0000-0000-0000-000000000002","valor":45}]')$q$, 'não divide conciliado');

-- recorrentes: mensal dia 31 (último dia), postergando fim de semana; não duplica; atualiza futuros; encerra
insert into lanc_recorrentes(id, empresa_id, descricao, plano_id, valor, dia, inicio, meses_a_frente, ajuste_fds) values
  ('ac320000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'ALUGUEL GALPÃO', 'f3200000-0000-0000-0000-000000000002', 8500, 31, date_trunc('month', current_date)::date, 2, 'postergar');
select pg_temp.ok(lanc_recorrentes_gerar('e000000a-0000-0000-0000-000000000000') = 3, 'gera o mês atual e mais 2');
select pg_temp.ok(lanc_recorrentes_gerar('e000000a-0000-0000-0000-000000000000') = 0, 'não duplica');
select pg_temp.ok((select bool_and(status = 'Em aberto' and valor = 8500 and extract(isodow from data) < 6) from lancamentos where recorrente_id = 'ac320000-0000-0000-0000-000000000001'), 'em aberto, sem cair no fim de semana');
select pg_temp.ok((select count(*) from _recorrente_vencimentos((select r from lanc_recorrentes r where id = 'ac320000-0000-0000-0000-000000000001'), '2027-12-31')) >= 13, 'datas futuras');
update lanc_recorrentes set valor = 9000 where id = 'ac320000-0000-0000-0000-000000000001';
select lanc_recorrente_atualizar_futuros('ac320000-0000-0000-0000-000000000001');
select pg_temp.ok((select bool_and(valor = 9000) from lancamentos where recorrente_id = 'ac320000-0000-0000-0000-000000000001' and data >= current_date), 'futuros com o valor novo');
update lanc_recorrentes set ativo = false where id = 'ac320000-0000-0000-0000-000000000001';
select lanc_recorrente_atualizar_futuros('ac320000-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) from lancamentos where recorrente_id = 'ac320000-0000-0000-0000-000000000001' and data >= current_date and status = 'Em aberto') = 0, 'desativado apaga os em aberto futuros');
select pg_temp.ok((select abertos = 0 from lanc_recorrentes_lista('e000000a-0000-0000-0000-000000000000') where id = 'ac320000-0000-0000-0000-000000000001'), 'lista');
reset role;

-- leitura não grava; outra empresa não vê
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($q$select lanc_recorrentes_gerar('e000000a-0000-0000-0000-000000000000')$q$, 'leitura não gera');
select pg_temp.falha($q$select lanc_editar_lote(array['ab320000-0000-0000-0000-000000000002']::uuid[], '{}')$q$, 'leitura não edita em lote');
select pg_temp.falha($q$insert into lanc_regras(empresa_id, texto, plano_id) values ('e000000a-0000-0000-0000-000000000000', 'X', 'f3200000-0000-0000-0000-000000000001')$q$, 'leitura não cria regra');
reset role;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from lanc_regras) + (select count(*) from cc_rateios) + (select count(*) from lanc_recorrentes) = 0, 'outra empresa não vê');
select pg_temp.falha($q$select lanc_dividir('ab320000-0000-0000-0000-000000000002', '[]')$q$, 'outra empresa não divide');
reset role;
\o
select 'regras e recorrentes ok';
