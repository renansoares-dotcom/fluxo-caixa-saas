-- Ponto de pedido pelo consumo (SQL 119): consumo pelas compras, segurança, ponto, máximo, prazo real e aplicar no cadastro.
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
insert into favorecidos(id, empresa_id, nome, documento) values ('59000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', 'FORNECEDOR PP', '11.111.111/0001-11');
insert into produtos(id, empresa_id, codigo, descricao, unidade, lead_time_dias) values ('59000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'MP-PP', 'RESINA PP', 'KG', 10);
insert into produto_fornecedores(empresa_id, produto_id, emit_doc, codigo_fornecedor, fator) values ('e000000a-0000-0000-0000-000000000000', '59000000-0000-0000-0000-0000000000f1', '11111111000111', 'R1', 25);
-- 90 dias: uma compra de 40 sacos (1.000 kg) por semana, nas 12 semanas mais recentes (sem variação nas semanas com compra)
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, emit_doc)
select ('59000000-0000-0000-0000-0000000001' || lpad(w::text, 2, '0'))::uuid, 'e000000a-0000-0000-0000-000000000000', 'PP' || w, 99500 + w, current_date - 7 * w - 1, 'entrada', false, 'autorizada', '11111111000111' from generate_series(0, 11) w;
insert into nfe_itens(empresa_id, nota_id, n_item, cprod, qcom, vprod) select 'e000000a-0000-0000-0000-000000000000', id, 1, 'R1', 40, 8000 from nfe_notas where chave like 'PP%' and empresa_id = 'e000000a-0000-0000-0000-000000000000';
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
create temp table r as select * from public.est_reposicao('e000000a-0000-0000-0000-000000000000') where codigo = 'MP-PP';
-- 12.000 kg em 12 das 13 semanas da janela (90 ÷ 7 = 12 semanas: todas com compra) → 1.000 kg/semana = 142,857 kg/dia
select pg_temp.ok((select fonte = 'compras' and consumo_janela = 12000 and consumo_dia between 142.8 and 142.9 from r), (select format('consumo: %s %s %s', fonte, consumo_janela, consumo_dia) from r));
select pg_temp.ok((select lead_time = 10 and lead_fonte = 'produto' and estoque_seguranca = 0 and ponto_pedido between 1428 and 1429 from r), (select format('ponto: %s %s %s %s', lead_time, lead_fonte, estoque_seguranca, ponto_pedido) from r));
select pg_temp.ok((select estoque_maximo between 3571 and 3572 and situacao = 'sem_estoque' and sugestao = 0 from r), 'máximo = ponto + 15 dias; sem estoque implantado');
select pg_temp.ok(public.est_reposicao_aplicar('e000000a-0000-0000-0000-000000000000', jsonb_build_array(jsonb_build_object('produto_id', '59000000-0000-0000-0000-0000000000f1', 'minimo', 200, 'ponto_pedido', 1430, 'maximo', 3572))) = 1, 'aplicou');
select pg_temp.ok((select ponto_pedido = 1430 and estoque_minimo = 200 and reposicao_calc_em is not null from produtos where codigo = 'MP-PP'), 'no cadastro');
select pg_temp.ok(public.est_reposicao_aplicar('e000000a-0000-0000-0000-000000000000', jsonb_build_array(jsonb_build_object('produto_id', '59000000-0000-0000-0000-0000000000f1', 'minimo', 500, 'ponto_pedido', 100))) = 0, 'ponto abaixo do mínimo não aplica');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select public.est_reposicao_aplicar('e000000a-0000-0000-0000-000000000000', '[]')$$, 'leitura não aplica');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select * from public.est_reposicao('e000000a-0000-0000-0000-000000000000')$$, 'outra empresa');
reset role;
delete from nfe_notas where chave like 'PP%' and empresa_id = 'e000000a-0000-0000-0000-000000000000'; delete from produto_fornecedores where codigo_fornecedor = 'R1' and emit_doc = '11111111000111';
delete from produtos where codigo = 'MP-PP'; delete from favorecidos where nome = 'FORNECEDOR PP';
\o
select 'ok 55 ponto de pedido';
