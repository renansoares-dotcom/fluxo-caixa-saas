-- Rastreabilidade (SQL 115): expedição na NF-e e busca de ponta a ponta (lote → OP → bobinas mãe e filha → nota).
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
insert into produtos(id, empresa_id, codigo, descricao, unidade) values ('5b000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'MP-R', 'RESINA RASTREIO', 'KG');
insert into prod_ordens(id, empresa_id, numero, quantidade) values
  ('5b000000-0000-0000-0000-0000000000c1', 'e000000a-0000-0000-0000-000000000000', 99101, 500),   -- extrusão
  ('5b000000-0000-0000-0000-0000000000c2', 'e000000a-0000-0000-0000-000000000000', 99102, 480);   -- impressão
insert into prod_consumos(empresa_id, ordem_id, produto_id, quantidade, lote) values ('e000000a-0000-0000-0000-000000000000', '5b000000-0000-0000-0000-0000000000c1', '5b000000-0000-0000-0000-0000000000f1', 510, 'LT-RES-77');
insert into prod_bobinas(id, empresa_id, codigo, ordem_id, peso_kg, lote_materia) values ('5b000000-0000-0000-0000-0000000000b1', 'e000000a-0000-0000-0000-000000000000', 'B-EXT-1', '5b000000-0000-0000-0000-0000000000c1', 500, 'LT-RES-77');
insert into prod_bobinas(id, empresa_id, codigo, ordem_id, peso_kg, mae_id) values ('5b000000-0000-0000-0000-0000000000b2', 'e000000a-0000-0000-0000-000000000000', 'B-IMP-1', '5b000000-0000-0000-0000-0000000000c2', 480, '5b000000-0000-0000-0000-0000000000b1');
update prod_bobinas set situacao = 'consumida' where id = '5b000000-0000-0000-0000-0000000000b1';
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, dest_nome) values
  ('5b000000-0000-0000-0000-0000000000e1', 'e000000a-0000-0000-0000-000000000000', 'RASTRO1', 99101, current_date, 'saida', true, 'autorizada', 'CLIENTE RASTREIO'),
  ('5b000000-0000-0000-0000-0000000000e2', 'e000000a-0000-0000-0000-000000000000', 'RASTRO2', 99102, current_date, 'entrada', false, 'autorizada', null);
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$select public.prod_bobina_expedir(array['5b000000-0000-0000-0000-0000000000b2']::uuid[], '5b000000-0000-0000-0000-0000000000e2')$$, 'nota de entrada não serve');
select pg_temp.falha($$select public.prod_bobina_expedir(array['5b000000-0000-0000-0000-0000000000b1']::uuid[], '5b000000-0000-0000-0000-0000000000e1')$$, 'bobina consumida não sai');
select pg_temp.ok(public.prod_bobina_expedir(array['5b000000-0000-0000-0000-0000000000b2']::uuid[], '5b000000-0000-0000-0000-0000000000e1') = 1, 'expediu na nota');
-- pelo lote da resina chega na nota do cliente
create temp table r as select public.prod_rastrear('e000000a-0000-0000-0000-000000000000', 'lt-res-77') j;
select pg_temp.ok((select jsonb_array_length(j->'ops') = 2 and jsonb_array_length(j->'bobinas') = 2 from r), 'lote → as duas OPs e as duas bobinas');
select pg_temp.ok((select j->'notas'->0->>'cliente' = 'CLIENTE RASTREIO' and (j->'notas'->0->>'kg')::numeric = 480 from r), 'lote → nota do cliente');
select pg_temp.ok((select j->'achados'->0->>'tipo' = 'lote' from r), 'achado como lote');
-- pela nota volta ao lote da resina; pelo QR com link também
select pg_temp.ok((select jsonb_array_length(public.prod_rastrear('e000000a-0000-0000-0000-000000000000', '99101')->'materiais') >= 1), 'nota/OP → materiais');
select pg_temp.ok((select (public.prod_rastrear('e000000a-0000-0000-0000-000000000000', 'https://x/#/producao/rastreio?b=B-IMP-1')->'materiais'->0->>'lote') = 'LT-RES-77'), 'QR com link → lote da resina');
select pg_temp.falha($$select public.prod_rastrear('e000000a-0000-0000-0000-000000000000', 'x')$$, 'termo curto');
select pg_temp.falha($$select public.prod_bobina_desfazer_expedicao('5b000000-0000-0000-0000-0000000000b2', 'x')$$, 'motivo obrigatório');
select public.prod_bobina_desfazer_expedicao('5b000000-0000-0000-0000-0000000000b2', 'nota cancelada e reemitida');
select pg_temp.ok((select situacao = 'estoque' and nota_id is null from prod_bobinas where id = '5b000000-0000-0000-0000-0000000000b2'), 'voltou ao estoque');
insert into prod_rastreio_config(empresa_id, exigir_nota) values ('e000000a-0000-0000-0000-000000000000', true);
select pg_temp.falha($$select public.prod_bobina_expedir(array['5b000000-0000-0000-0000-0000000000b2']::uuid[], null)$$, 'exige nota');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select public.prod_rastrear('e000000a-0000-0000-0000-000000000000', 'B-IMP-1')$$, 'outra empresa');
reset role;
delete from prod_rastreio_config; delete from prod_bobinas where codigo in ('B-IMP-1', 'B-EXT-1'); delete from nfe_notas where chave in ('RASTRO1', 'RASTRO2');
delete from prod_ordens where numero in (99101, 99102); delete from produtos where codigo = 'MP-R';
\o
select 'ok 51 rastreabilidade';
