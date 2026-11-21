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
-- 175 — etiquetas de mercadoria: código por lote e por produto, parâmetros
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade) values ('a7000000-0000-0000-0000-0000000000a1', :E, 'A7-RES', 'RESINA A7', 'materia_prima', 'KG'), ('a7000000-0000-0000-0000-0000000000a2', :E, 'A7-MB', 'MASTER A7', 'materia_prima', 'KG');
insert into est_lotes(id, empresa_id, produto_id, codigo) values ('a7000000-0000-0000-0000-0000000000c1', :E, 'a7000000-0000-0000-0000-0000000000a1', 'NF100-1'), ('a7000000-0000-0000-0000-0000000000c2', :E, 'a7000000-0000-0000-0000-0000000000a1', 'NF100-2');
select pg_temp.ok((select bool_and(etiqueta ~ '^P[0-9]{7,}$') and count(distinct etiqueta) = 2 from produtos where id::text like 'a7%'), 'produto novo nasce com etiqueta P única');
select pg_temp.ok((select bool_and(etiqueta ~ '^L[0-9]{7,}$') and count(distinct etiqueta) = 2 from est_lotes where id::text like 'a7%'), 'lote novo nasce com etiqueta L única');
select pg_temp.ok((select count(*) = 0 from produtos where etiqueta is null) and (select count(*) = 0 from est_lotes where etiqueta is null), 'nenhum produto ou lote sem etiqueta');
select pg_temp.ok((select count(*) = count(distinct etiqueta) from (select etiqueta from produtos union all select etiqueta from est_lotes) x), 'códigos não se repetem entre produtos e lotes');
-- o código não muda
create temp table _e as select etiqueta from est_lotes where id = 'a7000000-0000-0000-0000-0000000000c1';
update est_lotes set etiqueta = 'L9999999', lote_fornecedor = 'F-1' where id = 'a7000000-0000-0000-0000-0000000000c1';
select pg_temp.ok((select l.etiqueta = e.etiqueta and l.lote_fornecedor = 'F-1' from est_lotes l, _e e where l.id = 'a7000000-0000-0000-0000-0000000000c1'), 'etiqueta do lote não se altera (o resto da linha, sim)');
update produtos set etiqueta = 'P9999999' where id = 'a7000000-0000-0000-0000-0000000000a1';
select pg_temp.ok((select etiqueta <> 'P9999999' from produtos where id = 'a7000000-0000-0000-0000-0000000000a1'), 'etiqueta do produto não se altera');
-- usuário comum cria lote (como o Kardex faz) e a etiqueta nasce
select pg_temp.entrar(:ADM::uuid);
insert into est_lotes(empresa_id, produto_id, codigo) values (:E, 'a7000000-0000-0000-0000-0000000000a2', 'MAN-1');
select pg_temp.ok((select etiqueta ~ '^L[0-9]{7,}$' from est_lotes where codigo = 'MAN-1'), 'lote criado pela tela ganha etiqueta');
-- parâmetros
select pg_temp.ok((select count(*) = 0 from etq_config), 'sem linha: vale o padrão');
select pg_temp.falha($$select public.etq_config_salvar('e000000a-0000-0000-0000-000000000000', 'laser', 100, 70, 1, true)$$, 'tipo de código inválido');
select pg_temp.falha($$select public.etq_config_salvar('e000000a-0000-0000-0000-000000000000', 'qr', 10, 70, 1, true)$$, 'largura fora da faixa');
select pg_temp.falha($$select public.etq_config_salvar('e000000a-0000-0000-0000-000000000000', 'qr', 100, 70, 0, true)$$, 'cópias fora da faixa');
select public.etq_config_salvar(:E::uuid, 'barras', 100, 50, 2, false);
select public.etq_config_salvar(:E::uuid, 'qr', 80, 40, 3, true);
select pg_temp.ok((select codigo = 'qr' and largura_mm = 80 and altura_mm = 40 and copias = 3 and mostrar_fornecedor from etq_config where empresa_id = :E::uuid), 'parâmetros gravados e regravados');
select pg_temp.falha($$insert into etq_config (empresa_id) values ('e000000a-0000-0000-0000-000000000000')$$, 'gravação direta bloqueada');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha($$select public.etq_config_salvar('e000000a-0000-0000-0000-000000000000', 'qr', 100, 70, 1, true)$$, 'financeiro não muda os parâmetros');
select pg_temp.ok((select count(*) = 1 from etq_config), 'financeiro lê os parâmetros');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.ok((select count(*) = 0 from etq_config), 'outra empresa não lê');
select pg_temp.falha($$select public.etq_config_salvar('e000000a-0000-0000-0000-000000000000', 'qr', 100, 70, 1, true)$$, 'outra empresa não grava');
\o
\echo a7_etiquetas_leitor ok
