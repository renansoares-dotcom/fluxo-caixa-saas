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
-- 193 — endereçamento do almoxarifado (estante, prateleira, nível), etiqueta de prateleira e guia na ordem do corredor
\set E '''e000000a-0000-0000-0000-000000000000'''
\set B '''e000000b-0000-0000-0000-000000000000'''
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set PRD '''87000000-0000-0000-0000-0000000000aa'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
select public._est_configurar(:E::uuid);
update est_ig_inventarios set situacao = 'cancelado' where empresa_id = :E::uuid and situacao = 'aberto';
update est_ig_locais set situacao = 'concluido' where inventario_id in (select id from est_ig_inventarios where empresa_id = :E::uuid and situacao = 'cancelado');
insert into est_locais(id, empresa_id, codigo, nome, finalidade) values
  ('b9000000-0000-0000-0000-0000000000e1', :E, 'B9A', 'Almoxarifado B9', 'uso_consumo'), ('b9000000-0000-0000-0000-0000000000e2', :E, 'B9B', 'Depósito B9', 'uso_consumo');
insert into est_locais(id, empresa_id, codigo, nome, finalidade, controla_saldo) values ('b9000000-0000-0000-0000-0000000000e9', :E, 'B9X', 'Sem saldo B9', 'outro', false);
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade) values
  ('b9000000-0000-0000-0000-0000000000a1', :E, 'B9-LUV', 'LUVA B9', 'uso_consumo', 'PAR'), ('b9000000-0000-0000-0000-0000000000a2', :E, 'B9-ABR', 'ABRACADEIRA B9', 'uso_consumo', 'UN'),
  ('b9000000-0000-0000-0000-0000000000a3', :E, 'B9-ZZZ', 'ZINCO B9', 'uso_consumo', 'KG'), ('b9000000-0000-0000-0000-0000000000b1', :B, 'B9-OUT', 'DE OUTRA EMPRESA B9', 'uso_consumo', 'UN');
create temp table _g (k text primary key, id uuid, j jsonb); grant all on _g to authenticated;
create function pg_temp.en(c text) returns uuid language sql security definer as $$ select id from est_enderecos where local_id = 'b9000000-0000-0000-0000-0000000000e1' and codigo = c $$;
grant execute on function pg_temp.en(text) to authenticated;
create temp view b9 as select (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'COMPRA') compra;
grant select on b9 to authenticated;

-- ============================================================ gerar em massa
select pg_temp.entrar(:LEI::uuid);
select pg_temp.falha($$select public.est_end_gerar('e000000a-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-0000000000e1', '{A,B}', 3, 2)$$, 'perfil de leitura gerando endereços');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.falha($$select public.est_end_gerar('e000000a-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-0000000000e1', '{A,B}', 3, 2)$$, 'outra empresa gerando endereços');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$select public.est_end_gerar('e000000a-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-0000000000e9', '{A}', 3, 2)$$, 'local que não controla saldo');
select pg_temp.falha($$select public.est_end_gerar('e000000a-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-0000000000e1', '{A-1}', 3, 2)$$, 'estante com hífen');
select pg_temp.falha($$select public.est_end_gerar('e000000a-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-0000000000e1', '{A}', 120, 2)$$, 'prateleiras acima de 99');
select pg_temp.falha($$select public.est_end_gerar('e000000a-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-0000000000e1', '{A}', 12, 2, 1)$$, '12 prateleiras com 1 dígito');
select pg_temp.falha($$select public.est_end_gerar('e000000a-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-0000000000e1', '{A,B,C,D,E,F,G,H}', 99, 20)$$, 'mais de 3.000 endereços');
select pg_temp.ok(public.est_end_gerar(:E::uuid, 'b9000000-0000-0000-0000-0000000000e1', '{b, a}', 3, 2) = 12, '2 estantes × 3 prateleiras × 2 níveis = 12 endereços (letra minúscula vira maiúscula)');
select pg_temp.ok(public.est_end_gerar(:E::uuid, 'b9000000-0000-0000-0000-0000000000e1', '{A,C}', 3, 2) = 6, 'gerar de novo só cria o que falta (6 da estante C)');
select pg_temp.ok((select string_agg(codigo, ',' order by ordem) from est_enderecos where local_id = 'b9000000-0000-0000-0000-0000000000e1' and estante = 'A') = 'A-01-1,A-01-2,A-02-1,A-02-2,A-03-1,A-03-2', 'código e ordem: estante, prateleira, nível');
select pg_temp.ok((select bool_and(etiqueta ~ '^E\d{7,}$') and count(distinct etiqueta) = 18 from est_enderecos where local_id = 'b9000000-0000-0000-0000-0000000000e1'), 'cada endereço com a sua etiqueta de prateleira E…');
select pg_temp.ok((select enderecado from est_locais where id = 'b9000000-0000-0000-0000-0000000000e1'), 'o local passa a ser endereçado');
select pg_temp.ok(public.est_end_gerar(:E::uuid, 'b9000000-0000-0000-0000-0000000000e2', '{P}', 2, 0) = 2, 'sem nível: P-01 e P-02');
select pg_temp.ok((select string_agg(codigo, ',' order by ordem) from est_enderecos where local_id = 'b9000000-0000-0000-0000-0000000000e2') = 'P-01,P-02', 'endereço sem nível');

-- ============================================================ sem escrita direta; leitura só da própria empresa
select pg_temp.falha($$insert into est_enderecos(empresa_id, local_id, codigo, estante) values ('e000000a-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-0000000000e1', 'Z-1', 'Z')$$, 'inserir endereço direto na tabela');
select pg_temp.falha($$update est_enderecos set codigo = 'X' where local_id = 'b9000000-0000-0000-0000-0000000000e1'$$, 'alterar endereço direto na tabela');
select pg_temp.falha($$insert into est_produto_enderecos(produto_id, local_id, empresa_id, endereco_id) select 'b9000000-0000-0000-0000-0000000000a1', 'b9000000-0000-0000-0000-0000000000e1', 'e000000a-0000-0000-0000-000000000000', pg_temp.en('A-01-1')$$, 'atribuir direto na tabela');
select pg_temp.falha($$select public._end_local('e000000a-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-0000000000e1')$$, 'chamar a função interna');
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) = 20 from est_enderecos where empresa_id = :E::uuid and local_id in ('b9000000-0000-0000-0000-0000000000e1', 'b9000000-0000-0000-0000-0000000000e2')), 'quem consulta o estoque vê os endereços');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.ok((select count(*) = 0 from est_enderecos where empresa_id = :E::uuid), 'outra empresa não vê os endereços');

-- ============================================================ um endereço: criar, alterar, desativar, excluir
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$select public.est_end_salvar('e000000a-0000-0000-0000-000000000000', '{"local_id":"b9000000-0000-0000-0000-0000000000e1","codigo":"A-01-1","estante":"A"}')$$, 'endereço repetido no local');
select pg_temp.falha($$select public.est_end_salvar('e000000a-0000-0000-0000-000000000000', '{"local_id":"b9000000-0000-0000-0000-0000000000e1","codigo":"A 01","estante":"A"}')$$, 'código com espaço');
insert into _g(k, id) select 'piso', public.est_end_salvar(:E::uuid, '{"local_id":"b9000000-0000-0000-0000-0000000000e1","estante":"piso","prateleira":"1","descricao":"Paletes perto da porta"}');
select pg_temp.ok((select codigo = 'PISO-1' and ordem > (select max(ordem) from est_enderecos e2 where e2.local_id = 'b9000000-0000-0000-0000-0000000000e1' and e2.codigo <> 'PISO-1') from est_enderecos where id = (select id from _g where k = 'piso')), 'código montado da estante e prateleira, no fim do corredor');
select public.est_end_salvar(:E::uuid, jsonb_build_object('id', (select id from _g where k = 'piso'), 'codigo', 'PISO-01', 'estante', 'PISO', 'prateleira', '01', 'descricao', 'Paletes'));
select pg_temp.ok((select codigo = 'PISO-01' and descricao = 'Paletes' from est_enderecos where id = (select id from _g where k = 'piso')), 'endereço alterado');
select pg_temp.ok(public.est_end_excluir(:E::uuid, array[(select id from _g where k = 'piso')]) = 1, 'endereço vazio excluído');

-- ============================================================ atribuir o endereço padrão
select pg_temp.entrar(:LEI::uuid);
select pg_temp.falha($$select public.est_end_atribuir('e000000a-0000-0000-0000-000000000000', jsonb_build_array(jsonb_build_object('produto_id', 'b9000000-0000-0000-0000-0000000000a1', 'endereco_id', pg_temp.en('A-01-1'))))$$, 'perfil de leitura atribuindo endereço');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$select public.est_end_atribuir('e000000a-0000-0000-0000-000000000000', jsonb_build_array(jsonb_build_object('produto_id', 'b9000000-0000-0000-0000-0000000000b1', 'endereco_id', pg_temp.en('A-01-1'))))$$, 'produto de outra empresa');
select pg_temp.falha($$select public.est_end_atribuir('e000000a-0000-0000-0000-000000000000', jsonb_build_array(jsonb_build_object('produto_id', 'b9000000-0000-0000-0000-0000000000a1', 'local_id', 'b9000000-0000-0000-0000-0000000000e2', 'endereco_id', pg_temp.en('A-01-1'))))$$, 'endereço de outro local');
select pg_temp.falha($$select public.est_end_atribuir('e000000a-0000-0000-0000-000000000000', '[]')$$, 'lista vazia');
insert into _g(k, j) select 'a1', public.est_end_atribuir(:E::uuid, jsonb_build_array(
  jsonb_build_object('produto_id', 'b9000000-0000-0000-0000-0000000000a1', 'endereco_id', pg_temp.en('B-02-1')),
  jsonb_build_object('produto_id', 'b9000000-0000-0000-0000-0000000000a2', 'endereco_id', pg_temp.en('A-03-2')),
  jsonb_build_object('produto_id', 'b9000000-0000-0000-0000-0000000000a1', 'endereco_id', (select id from est_enderecos where local_id = 'b9000000-0000-0000-0000-0000000000e2' and codigo = 'P-01'))));
select pg_temp.ok((select (j->>'atribuidos')::int = 3 and jsonb_array_length(j->'trocados') = 0 from _g where k = 'a1'), '3 atribuições (o mesmo produto em dois locais), nenhuma troca');
insert into _g(k, j) select 'a2', public.est_end_atribuir(:E::uuid, jsonb_build_array(jsonb_build_object('produto_id', 'b9000000-0000-0000-0000-0000000000a1', 'endereco_id', pg_temp.en('A-01-2'))));
select pg_temp.ok((select j->'trocados'->0->>'de' = 'B-02-1' and j->'trocados'->0->>'para' = 'A-01-2' from _g where k = 'a2'), 'mudar de endereço avisa de onde saiu');
select pg_temp.ok((select count(*) = 1 from est_produto_enderecos where produto_id = 'b9000000-0000-0000-0000-0000000000a1' and local_id = 'b9000000-0000-0000-0000-0000000000e1'), 'um endereço padrão por produto e local');
select pg_temp.falha(format('select public.est_end_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('id', pg_temp.en('A-03-2'), 'codigo', 'A-03-2', 'estante', 'A', 'prateleira', '03', 'nivel', '2', 'ativo', false)), 'desativar endereço com produto');
select pg_temp.falha(format('select public.est_end_excluir(%L, %L::uuid[])', 'e000000a-0000-0000-0000-000000000000', array[pg_temp.en('A-03-2')]), 'excluir endereço com produto');
select public.est_end_salvar(:E::uuid, jsonb_build_object('id', pg_temp.en('C-03-2'), 'codigo', 'C-03-2', 'estante', 'C', 'prateleira', '03', 'nivel', '2', 'ativo', false));
select pg_temp.falha($$select public.est_end_atribuir('e000000a-0000-0000-0000-000000000000', jsonb_build_array(jsonb_build_object('produto_id', 'b9000000-0000-0000-0000-0000000000a3', 'endereco_id', pg_temp.en('C-03-2'))))$$, 'atribuir a endereço inativo');
insert into _g(k, j) select 'a3', public.est_end_atribuir(:E::uuid, jsonb_build_array(jsonb_build_object('produto_id', 'b9000000-0000-0000-0000-0000000000a1', 'local_id', 'b9000000-0000-0000-0000-0000000000e2', 'endereco_id', null)));
select pg_temp.ok((select (j->>'removidos')::int = 1 from _g where k = 'a3') and not exists (select 1 from est_produto_enderecos where produto_id = 'b9000000-0000-0000-0000-0000000000a1' and local_id = 'b9000000-0000-0000-0000-0000000000e2'), 'tirar o produto do endereço');

-- ordem do corredor: inverter a estante A
select public.est_end_ordenar(:E::uuid, 'b9000000-0000-0000-0000-0000000000e1', (select array_agg(id order by ordem desc) from est_enderecos where local_id = 'b9000000-0000-0000-0000-0000000000e1'));
select pg_temp.ok((select codigo from est_enderecos where local_id = 'b9000000-0000-0000-0000-0000000000e1' order by ordem limit 1) = 'C-03-2', 'ordem do corredor invertida');
select pg_temp.falha(format('select public.est_end_ordenar(%L, %L, %L::uuid[])', 'e000000a-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-0000000000e1',
  array[(select id from est_enderecos where local_id = 'b9000000-0000-0000-0000-0000000000e2' limit 1)]), 'ordenar com endereço de outro local');
select public.est_end_ordenar(:E::uuid, 'b9000000-0000-0000-0000-0000000000e1', (select array_agg(id order by ordem desc) from est_enderecos where local_id = 'b9000000-0000-0000-0000-0000000000e1'));

-- etiqueta de prateleira: tamanho próprio; a etiqueta não se altera
select pg_temp.falha($$select public.etq_config_endereco_salvar('e000000a-0000-0000-0000-000000000000', 100, 40)$$, 'compras mudando a etiqueta');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha($$select public.etq_config_endereco_salvar('e000000a-0000-0000-0000-000000000000', 100, 10)$$, 'altura abaixo de 15 mm');
insert into _g(k, j) select 'merc', jsonb_build_object('w', largura_mm, 'h', altura_mm) from etq_config where empresa_id = :E::uuid;
select public.etq_config_endereco_salvar(:E::uuid, 80, 30);
reset role;
select pg_temp.ok((select end_largura_mm = 80 and end_altura_mm = 30 and largura_mm = coalesce((select (j->>'w')::int from _g where k = 'merc'), 100) and altura_mm = coalesce((select (j->>'h')::int from _g where k = 'merc'), 70) from etq_config where empresa_id = :E::uuid), 'tamanho da etiqueta de prateleira salvo, sem mexer na de mercadoria');
insert into _g(k, j) select 'etq', to_jsonb(etiqueta) from est_enderecos where id = pg_temp.en('A-01-1');
update est_enderecos set etiqueta = 'E9999999' where id = pg_temp.en('A-01-1');
select pg_temp.ok((select to_jsonb(etiqueta) = (select j from _g where k = 'etq') from est_enderecos where id = pg_temp.en('A-01-1')), 'a etiqueta de prateleira não muda');

-- ============================================================ inventário geral: lista na ordem do corredor, com o endereço
select pg_temp.entrar(:ADM::uuid);
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, documento)
  select :E::uuid, (date_trunc('month', current_date) - interval '5 day')::date, p, l, compra, 10, 2, 'NF B9' from b9, (values ('b9000000-0000-0000-0000-0000000000a1'::uuid, 'b9000000-0000-0000-0000-0000000000e1'::uuid),
    ('b9000000-0000-0000-0000-0000000000a2'::uuid, 'b9000000-0000-0000-0000-0000000000e1'::uuid), ('b9000000-0000-0000-0000-0000000000a3'::uuid, 'b9000000-0000-0000-0000-0000000000e1'::uuid),
    ('b9000000-0000-0000-0000-0000000000a3'::uuid, 'b9000000-0000-0000-0000-0000000000e2'::uuid)) v(p, l);
select pg_temp.entrar(:FIN::uuid);
insert into _g(k, id) select 'ig', public.est_ig_abrir(:E::uuid, (date_trunc('month', current_date) - interval '1 day')::date,
  '[{"local_id":"b9000000-0000-0000-0000-0000000000e1","responsavel_id":"f0000000-0000-0000-0000-00000000000f"},{"local_id":"b9000000-0000-0000-0000-0000000000e2","responsavel_id":"87000000-0000-0000-0000-0000000000aa"}]'::jsonb, 'B9');
select pg_temp.entrar(:CMP::uuid);
-- ordem do corredor: C-03-2 … A-01-1 (invertida acima e desfeita: A-01-1 primeiro). LUVA em A-01-2, ABRACADEIRA em A-03-2, ZINCO sem endereço (por último)
insert into _g(k, j) select 'lista', jsonb_agg(jsonb_build_object('c', codigo, 'e', endereco, 'q', quantidade)) from public.est_ig_lista((select id from est_ig_locais where inventario_id = (select id from _g where k = 'ig') and local_id = 'b9000000-0000-0000-0000-0000000000e1'));
select pg_temp.ok((select j->0->>'c' = 'B9-LUV' and j->0->>'e' = 'A-01-2' and j->1->>'c' = 'B9-ABR' and j->1->>'e' = 'A-03-2' and j->2->>'c' = 'B9-ZZZ' and j->2->>'e' is null and j->0->>'q' is null from _g where k = 'lista'),
  'lista do contador na ordem do corredor, com o endereço e sem quantidade');
-- durante a contagem cega quem conta lê os endereços e pode endereçar o que achou (o endereço não revela saldo)
select pg_temp.ok((select count(*) > 0 from est_enderecos where local_id = 'b9000000-0000-0000-0000-0000000000e1'), 'endereços visíveis durante a contagem');
select pg_temp.ok((select count(*) = 0 from est_saldos where local_id = 'b9000000-0000-0000-0000-0000000000e1'), 'saldo do local continua escondido');
select public.est_end_atribuir(:E::uuid, jsonb_build_array(jsonb_build_object('produto_id', 'b9000000-0000-0000-0000-0000000000a3', 'endereco_id', pg_temp.en('B-01-1'))));
select pg_temp.ok((select string_agg(codigo, ',' order by endereco_ordem) = 'B9-LUV,B9-ABR,B9-ZZZ' from public.est_ig_lista((select id from est_ig_locais where inventario_id = (select id from _g where k = 'ig') and local_id = 'b9000000-0000-0000-0000-0000000000e1'))), 'zinco endereçado em B-01-1 entra na ordem');
select pg_temp.entrar(:FIN::uuid);
select public.est_ig_cancelar((select id from _g where k = 'ig'), 'teste B9');
reset role;
\o
\echo b9_enderecamento ok
