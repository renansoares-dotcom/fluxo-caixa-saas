-- Programação inteligente (SQL 121): impedimentos (arte, clichê, tinta, material), cores e aplicar a fila da máquina.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;
-- base: setores extrusão e impressão, máquina de impressão, produto impresso com estrutura e duas cores
insert into prod_setores(id, empresa_id, nome, ordem, horas_dia) values ('57000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'Extrusão PI', 1, 20),
  ('57000000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', 'Impressão PI', 2, 10);
insert into prod_maquinas(id, empresa_id, setor_id, codigo, nome) values ('57000000-0000-0000-0000-000000000003', 'e000000a-0000-0000-0000-000000000000', '57000000-0000-0000-0000-000000000002', 'IMP-PI', 'IMPRESSORA PI');
insert into favorecidos(id, empresa_id, nome) values ('57000000-0000-0000-0000-000000000004', 'e000000a-0000-0000-0000-000000000000', 'CLIENTE PI');
insert into produtos(id, empresa_id, codigo, descricao, unidade, controla_lote) values
  ('57000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'PA-PI', 'SACO IMPRESSO PI', 'KG', false),
  ('57000000-0000-0000-0000-0000000000f2', 'e000000a-0000-0000-0000-000000000000', 'MP-PI', 'RESINA PI', 'KG', false),
  ('57000000-0000-0000-0000-0000000000f3', 'e000000a-0000-0000-0000-000000000000', 'TN-PI', 'TINTA PRONTA AMARELA PI', 'KG', false);
update produtos set controla_lote = false where codigo in ('PA-PI', 'MP-PI', 'TN-PI') and empresa_id = 'e000000a-0000-0000-0000-000000000000';
insert into produto_estrutura(empresa_id, produto_id, componente_id, quantidade) values ('e000000a-0000-0000-0000-000000000000', '57000000-0000-0000-0000-0000000000f1', '57000000-0000-0000-0000-0000000000f2', 1);
insert into tin_cores(id, empresa_id, codigo, nome, hex, produto_id) values ('57000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', 'AM-PI', 'AMARELO PI', '#FFE000', '57000000-0000-0000-0000-0000000000f3'),
  ('57000000-0000-0000-0000-0000000000a2', 'e000000a-0000-0000-0000-000000000000', 'PT-PI', 'PRETO PI', '#111111', null);
insert into tin_produto_cores(empresa_id, produto_id, cor_id, consumo_g_kg) values ('e000000a-0000-0000-0000-000000000000', '57000000-0000-0000-0000-0000000000f1', '57000000-0000-0000-0000-0000000000a1', 10),
  ('e000000a-0000-0000-0000-000000000000', '57000000-0000-0000-0000-0000000000f1', '57000000-0000-0000-0000-0000000000a2', 5);
insert into prod_prog_config(empresa_id, setor_impressao_id) values ('e000000a-0000-0000-0000-000000000000', '57000000-0000-0000-0000-000000000002');
-- duas OPs de 600 kg (resina: 1 kg/kg); saldo de resina 1.000 kg → a segunda (entrega depois) fica sem 200 kg
insert into prod_ordens(id, empresa_id, numero, quantidade, produto_id, status, entrega, prioridade) values
  ('57000000-0000-0000-0000-0000000000c1', 'e000000a-0000-0000-0000-000000000000', 99571, 600, '57000000-0000-0000-0000-0000000000f1', 'liberada', current_date + 3, 3),
  ('57000000-0000-0000-0000-0000000000c2', 'e000000a-0000-0000-0000-000000000000', 99572, 600, '57000000-0000-0000-0000-0000000000f1', 'liberada', current_date + 6, 3);
insert into prod_ordem_etapas(id, empresa_id, ordem_id, seq, setor_id, horas_previstas) values
  ('57000000-0000-0000-0000-0000000000d1', 'e000000a-0000-0000-0000-000000000000', '57000000-0000-0000-0000-0000000000c1', 1, '57000000-0000-0000-0000-000000000001', 5),
  ('57000000-0000-0000-0000-0000000000d2', 'e000000a-0000-0000-0000-000000000000', '57000000-0000-0000-0000-0000000000c1', 2, '57000000-0000-0000-0000-000000000002', 6),
  ('57000000-0000-0000-0000-0000000000d3', 'e000000a-0000-0000-0000-000000000000', '57000000-0000-0000-0000-0000000000c2', 1, '57000000-0000-0000-0000-000000000001', 5),
  ('57000000-0000-0000-0000-0000000000d4', 'e000000a-0000-0000-0000-000000000000', '57000000-0000-0000-0000-0000000000c2', 2, '57000000-0000-0000-0000-000000000002', 6);
-- arte da OP 99571 aguardando o cliente
alter table pre_projetos disable trigger user;
insert into pre_projetos(id, empresa_id, numero, favorecido_id, produto_id, ordem_id, nome, situacao) values
  ('57000000-0000-0000-0000-0000000000e1', 'e000000a-0000-0000-0000-000000000000', 99571, '57000000-0000-0000-0000-000000000004', '57000000-0000-0000-0000-0000000000f1', '57000000-0000-0000-0000-0000000000c1', 'Saco PI', 'aguardando_cliente');
alter table pre_projetos enable trigger user;
create temp table loc as select (select id from est_locais where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'MP') mp,
  (select id from est_tipos_movimento where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'COMPRA') compra;
grant select on loc to authenticated;
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario)
  select 'e000000a-0000-0000-0000-000000000000', current_date - 2, '57000000-0000-0000-0000-0000000000f2', mp, compra, 1000, 8 from loc;
-- tinta amarela pronta em estoque: 10 kg (a OP precisa de 6 kg)
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario)
  select 'e000000a-0000-0000-0000-000000000000', current_date - 2, '57000000-0000-0000-0000-0000000000f3', mp, compra, 10, 30 from loc;
create temp table pr as select * from public.prod_prontidao('e000000a-0000-0000-0000-000000000000') where numero in (99571, 99572);
select pg_temp.ok((select count(*) from pr) = 4, 'quatro etapas abertas');
select pg_temp.ok((select impedimentos @> '[{"tipo":"arte"}]' from pr where etapa_id = '57000000-0000-0000-0000-0000000000d2'), 'arte não aprovada na impressão');
select pg_temp.ok((select not impedimentos @> '[{"tipo":"arte"}]' from pr where etapa_id = '57000000-0000-0000-0000-0000000000d1'), 'arte não pesa na extrusão');
select pg_temp.ok((select impedimentos @> '[{"tipo":"tinta"}]' and impedimentos::text like '%PT-PI%' and impedimentos::text not like '%AM-PI%' from pr where etapa_id = '57000000-0000-0000-0000-0000000000d2'), 'preto sem tinta; amarelo com saldo');
select pg_temp.ok((select not impedimentos @> '[{"tipo":"material"}]' from pr where etapa_id = '57000000-0000-0000-0000-0000000000d1'), 'primeira OP com material');
select pg_temp.ok((select impedimentos @> '[{"tipo":"material"}]' and impedimentos::text like '%faltam 200%' from pr where etapa_id = '57000000-0000-0000-0000-0000000000d3'), 'segunda OP: faltam 200');
select pg_temp.ok((select avisos @> '[{"tipo":"etapa"}]' from pr where etapa_id = '57000000-0000-0000-0000-0000000000d2'), 'aguarda a extrusão');
select pg_temp.ok((select jsonb_array_length(cores) = 2 and escuridao > 90 and (cores->0->>'codigo') = 'AM-PI' from pr where etapa_id = '57000000-0000-0000-0000-0000000000d2'), 'cores do claro ao escuro');
select pg_temp.ok(public._cor_escuridao(null, '#FFFFFF') = 0 and public._cor_escuridao(30, null) = 70, 'escuridão pelo hex e pelo L*');
-- desligar a arte nos parâmetros tira o impedimento
update prod_prog_config set considerar_arte = false where empresa_id = 'e000000a-0000-0000-0000-000000000000';
select pg_temp.ok((select not impedimentos @> '[{"tipo":"arte"}]' from public.prod_prontidao('e000000a-0000-0000-0000-000000000000') where etapa_id = '57000000-0000-0000-0000-0000000000d2'), 'arte desligada');
-- aplicar a fila: 6 h + 6 h num setor de 10 h/dia → a segunda vai para o dia seguinte
select pg_temp.ok(public.prod_prog_aplicar('57000000-0000-0000-0000-000000000003', array['57000000-0000-0000-0000-0000000000d4', '57000000-0000-0000-0000-0000000000d2']::uuid[], current_date + 1) = 2, 'duas na fila');
select pg_temp.ok((select ordem_maquina = 1 and inicio_previsto = current_date + 1 and maquina_id = '57000000-0000-0000-0000-000000000003' from prod_ordem_etapas where id = '57000000-0000-0000-0000-0000000000d4'), 'primeira da fila');
select pg_temp.ok((select ordem_maquina = 2 and inicio_previsto = current_date + 2 from prod_ordem_etapas where id = '57000000-0000-0000-0000-0000000000d2'), 'segunda no dia seguinte');
select pg_temp.falha($$select public.prod_prog_aplicar('57000000-0000-0000-0000-000000000003', array['57000000-0000-0000-0000-0000000000d1']::uuid[], current_date)$$, 'etapa de outro setor');
select pg_temp.falha($$select public.prod_prog_aplicar('57000000-0000-0000-0000-000000000003', array['57000000-0000-0000-0000-0000000000d2', '57000000-0000-0000-0000-0000000000d2']::uuid[], current_date)$$, 'repetida');
select pg_temp.falha($$update prod_prog_config set troca_cor_min = 999$$, 'troca fora da faixa');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select public.prod_prog_aplicar('57000000-0000-0000-0000-000000000003', array['57000000-0000-0000-0000-0000000000d2']::uuid[], current_date)$$, 'leitura não programa');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select * from public.prod_prontidao('e000000a-0000-0000-0000-000000000000')$$, 'outra empresa');
reset role;
\o
select 'ok 57 programação inteligente';
