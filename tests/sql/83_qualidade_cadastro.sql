-- Qualidade do cadastro (SQL 147): mesclar beneficiários (vínculos levados, campos completados, documentos diferentes barrados), ignorados e acesso.
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
insert into favorecidos(id, empresa_id, tipo, nome, documento, email, telefone) values
  ('83000000-0000-0000-0000-0000000000f1', :E, 'FORNECEDORES', 'RESINAS 83 LTDA', '12.345.678/0001-90', null, '8133334444'),
  ('83000000-0000-0000-0000-0000000000f2', :E, 'FORNECEDORES', 'RESINAS 83', '12345678000190', 'compras@resinas83.com', null),
  ('83000000-0000-0000-0000-0000000000f3', :E, 'FORNECEDORES', 'OUTRA 83', '11222333000181', null, null);
insert into lancamentos(empresa_id, data, plano_id, conta_id, valor, favorecido_id) values
  (:E, '2026-10-05', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 10, '83000000-0000-0000-0000-0000000000f2'),
  (:E, '2026-10-06', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 20, '83000000-0000-0000-0000-0000000000f2');

select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');   -- leitura
select pg_temp.falha($$select public.mesclar_favorecidos('83000000-0000-0000-0000-0000000000f1', '83000000-0000-0000-0000-0000000000f2')$$, 'leitura não mescla');
select pg_temp.falha($$insert into qc_ignorados(empresa_id, tabela, a, b) values ('e000000a-0000-0000-0000-000000000000', 'favorecidos', '83000000-0000-0000-0000-0000000000f1', '83000000-0000-0000-0000-0000000000f3')$$, 'leitura não marca');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');   -- financeiro
select pg_temp.falha($$select public.mesclar_favorecidos('83000000-0000-0000-0000-0000000000f1', '83000000-0000-0000-0000-0000000000f3')$$, 'documentos diferentes');
insert into qc_ignorados(empresa_id, tabela, a, b) values (:E, 'favorecidos', '83000000-0000-0000-0000-0000000000f1', '83000000-0000-0000-0000-0000000000f2');
select pg_temp.ok((public.mesclar_favorecidos('83000000-0000-0000-0000-0000000000f1', '83000000-0000-0000-0000-0000000000f2') -> 'movidos' ->> 'lancamentos.favorecido_id')::int = 2, '2 lançamentos levados');
select pg_temp.ok(not exists (select 1 from favorecidos where id = '83000000-0000-0000-0000-0000000000f2'), 'excluído apagado');
select pg_temp.ok((select email = 'compras@resinas83.com' and telefone = '8133334444' and nome = 'RESINAS 83 LTDA' from favorecidos where id = '83000000-0000-0000-0000-0000000000f1'), 'vazios completados, nome mantido');
select pg_temp.ok((select count(*) from lancamentos where favorecido_id = '83000000-0000-0000-0000-0000000000f1') = 2, 'lançamentos no que ficou');
select pg_temp.ok(not exists (select 1 from qc_ignorados where a = '83000000-0000-0000-0000-0000000000f1' and b = '83000000-0000-0000-0000-0000000000f2'), 'ignorado do par some');
select pg_temp.falha($$insert into qc_config(empresa_id, similaridade) values ('e000000a-0000-0000-0000-000000000000', 0.9)$$, 'financeiro não muda os pesos');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into qc_config(empresa_id, similaridade, pesos_fav) values (:E, 0.9, '{"receita": 0}');
select pg_temp.ok((select similaridade = 0.9 from qc_config where empresa_id = :E), 'admin grava');
reset role;
\o
select 'ok 83 qualidade do cadastro';
