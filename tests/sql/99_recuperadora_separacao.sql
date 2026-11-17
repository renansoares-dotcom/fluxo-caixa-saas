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
-- Recuperadora: separação por densidade (SQL 166)
insert into rec_materiais(id, empresa_id, codigo, nome, polimero) values ('99000000-0000-0000-0000-0000000000e1', :E, 'PET-99', 'PET separado no tanque', 'PET');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select not usar_separacao and separacao_custo = 'peso' and prefixo_separado = 'SP' from rec_config where empresa_id = :E), 'nasce desligado');
create temp table b0 as select public.rec_balanco(:E, '2026-11-01') b;
-- ordem: 100 kg do lote LE2-1 (R$ 1,00/kg); 15 kg afundam como PET
insert into rec_ordens(id, empresa_id, data, material_saida_id) values ('99000000-0000-0000-0000-000000000f01', :E, '2026-11-14', '88000000-0000-0000-0000-0000000000e9');
select public.rec_ordem_entrada('99000000-0000-0000-0000-000000000f01', id, 100) from rec_lotes where empresa_id = :E and codigo = 'LE2-1';
insert into rec_ordem_separacoes(empresa_id, ordem_id, material_id, fracao, kg, custo) values (:E, '99000000-0000-0000-0000-000000000f01', '99000000-0000-0000-0000-0000000000e1', 'afundou', 15, 999);
select pg_temp.ok((select custo is null and lote_id is null from rec_ordem_separacoes where ordem_id = '99000000-0000-0000-0000-000000000f01'), 'custo não vem da tela');
select pg_temp.falha($$insert into rec_ordem_separacoes(empresa_id, ordem_id, material_id, kg) values ('e000000a-0000-0000-0000-000000000000', '99000000-0000-0000-0000-000000000f01', '88000000-0000-0000-0000-0000000000e9', 5)$$, 'separar o próprio grão');
select pg_temp.falha($$insert into rec_ordem_separacoes(empresa_id, ordem_id, material_id, kg) values ('e000000a-0000-0000-0000-000000000000', '99000000-0000-0000-0000-000000000f01', '99000000-0000-0000-0000-0000000000e1', 0)$$, 'kg zero');
-- desligado, a conclusão ignora a separação (como antes): 180 kg de 200
-- ligado: a saída não pode passar de 100 − 15 = 85 (+2%)
update rec_config set usar_separacao = true where empresa_id = :E;
select pg_temp.falha($$select public.rec_ordem_concluir('99000000-0000-0000-0000-000000000f01', 95)$$, 'saída maior que entrada − separado');
create temp table r99 as select public.rec_ordem_concluir('99000000-0000-0000-0000-000000000f01', 76.5) r;
select pg_temp.ok((select (r ->> 'entrada')::numeric = 85 and (r ->> 'separado')::numeric = 15 and (r ->> 'lotes_separados')::int = 1 and (r ->> 'rendimento')::numeric = 0.9 and (r ->> 'custo_total')::numeric = 85 from r99), 'conclusão: entrada líquida, custo sem o separado');
select pg_temp.ok((select peso_entrada = 85 and peso_separado = 15 and custo_material = 85 from rec_ordens where id = '99000000-0000-0000-0000-000000000f01'), 'ordem gravada');
select pg_temp.ok((select l.tipo = 'separado' and l.peso_kg = 15 and l.saldo_kg = 15 and l.custo_total = 15 and l.situacao = 'disponivel' and l.codigo = 'SP-261114-' || (select numero from rec_ordens where id = '99000000-0000-0000-0000-000000000f01') || '-1'
  from rec_lotes l join rec_ordem_separacoes s on s.lote_id = l.id where s.ordem_id = '99000000-0000-0000-0000-000000000f01'), 'lote separado com o custo pelo peso');
-- rendimento: a ordem rende 90%; o fornecedor é medido sobre o bruto (76,5 ÷ 100)
select pg_temp.ok((select (public.rec_rendimento(:E, '2026-11-14', '2026-11-14') -> 'total' ->> 'separado')::numeric = 15 and (public.rec_rendimento(:E, '2026-11-14', '2026-11-14') -> 'total' ->> 'rendimento')::numeric = 0.9), 'rendimento da ordem sobre a entrada líquida');
select pg_temp.ok((select (f ->> 'grao')::numeric = 76.5 and (f ->> 'rendimento')::numeric = 0.765 from jsonb_array_elements(public.rec_rendimento(:E, '2026-11-14', '2026-11-14') -> 'fornecedores') f), 'fornecedor medido sobre o bruto');
-- o lote separado entra em outra ordem e pode ser vendido direto
select public.rec_lote_baixar(s.lote_id, 10, 'venda', '2026-11-15', null, 'NF 99') from rec_ordem_separacoes s where s.ordem_id = '99000000-0000-0000-0000-000000000f01';
-- balanço: o material fecha com os separados (+15) e a saída direta (−10)
create temp table b1 as select public.rec_balanco(:E, '2026-11-01') b;
select pg_temp.ok((select (b1.b -> 'material' ->> 'separados')::numeric - (b0.b -> 'material' ->> 'separados')::numeric = 15 and (b1.b -> 'material' ->> 'saidas')::numeric - (b0.b -> 'material' ->> 'saidas')::numeric = 10 from b0, b1), 'balanço: separados e saídas do material');
select pg_temp.ok((select ((b -> 'material' ->> 'estoque_inicial')::numeric + (b -> 'material' ->> 'comprado')::numeric + (b -> 'material' ->> 'aparas')::numeric + (b -> 'material' ->> 'outras')::numeric + (b -> 'material' ->> 'separados')::numeric
  - (b -> 'material' ->> 'consumido')::numeric - (b -> 'material' ->> 'saidas')::numeric) - (b -> 'material' ->> 'estoque_final')::numeric from b1) = (select ((b -> 'material' ->> 'estoque_inicial')::numeric + (b -> 'material' ->> 'comprado')::numeric + (b -> 'material' ->> 'aparas')::numeric + (b -> 'material' ->> 'outras')::numeric + (b -> 'material' ->> 'separados')::numeric
  - (b -> 'material' ->> 'consumido')::numeric - (b -> 'material' ->> 'saidas')::numeric) - (b -> 'material' ->> 'estoque_final')::numeric from b0), 'a conta do material não muda com a separação e a venda');
-- custo zero no separado: tudo fica no grão; separar tudo é barrado
update rec_config set separacao_custo = 'zero' where empresa_id = :E;
insert into rec_ordens(id, empresa_id, data, material_saida_id) values ('99000000-0000-0000-0000-000000000f02', :E, '2026-11-15', '88000000-0000-0000-0000-0000000000e9');
select public.rec_ordem_entrada('99000000-0000-0000-0000-000000000f02', id, 100) from rec_lotes where empresa_id = :E and codigo = 'LE2-1';
insert into rec_ordem_separacoes(empresa_id, ordem_id, material_id, fracao, kg) values (:E, '99000000-0000-0000-0000-000000000f02', '99000000-0000-0000-0000-0000000000e1', 'afundou', 100);
select pg_temp.falha($$select public.rec_ordem_concluir('99000000-0000-0000-0000-000000000f02', 1)$$, 'separar tudo');
update rec_ordem_separacoes set kg = 20 where ordem_id = '99000000-0000-0000-0000-000000000f02';
select pg_temp.ok((public.rec_ordem_concluir('99000000-0000-0000-0000-000000000f02', 76) ->> 'custo_total')::numeric = 100, 'custo zero: tudo no grão');
select pg_temp.ok((select l.custo_total = 0 from rec_lotes l join rec_ordem_separacoes s on s.lote_id = l.id where s.ordem_id = '99000000-0000-0000-0000-000000000f02'), 'lote separado sem custo');
update rec_ordem_separacoes set kg = 1 where ordem_id = '99000000-0000-0000-0000-000000000f02';
select pg_temp.ok((select kg = 20 from rec_ordem_separacoes where ordem_id = '99000000-0000-0000-0000-000000000f02'), 'ordem concluída não aceita mudança');
update rec_config set usar_separacao = false, separacao_custo = 'peso' where empresa_id = :E;
reset role;
