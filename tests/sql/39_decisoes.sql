-- Central de Decisões (SQL 103): resolver, adiar e delegar alertas, situação atual e histórico, foto da saúde.
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

select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select decisoes_tratar('e000000a-0000-0000-0000-000000000000', 'k1', 'Caixa', 'T', 'adiado', current_date + 3)$$, 'leitura não trata alertas');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$select decisoes_tratar('e000000a-0000-0000-0000-000000000000', 'k1', 'Caixa', 'T', 'resolvido')$$, 'resolver exige o que foi feito');
select pg_temp.falha($$select decisoes_tratar('e000000a-0000-0000-0000-000000000000', 'k1', 'Caixa', 'T', 'adiado', current_date)$$, 'adiar exige data futura');
select pg_temp.falha($$select decisoes_tratar('e000000a-0000-0000-0000-000000000000', 'k1', 'Caixa', 'T', 'delegado', null, 'b0000000-0000-0000-0000-00000000000b')$$, 'delegar só para quem é da empresa');
select decisoes_tratar(:E, 'k1', 'Caixa', 'Caixa abaixo do mínimo', 'adiado', current_date + 3, null, 'esperar o borderô');
select decisoes_tratar(:E, 'k2', 'Conciliação', 'Extratos atrasados', 'delegado', null, 'a0000000-0000-0000-0000-00000000000a', 'importar o OFX do Itaú');
select decisoes_tratar(:E, 'k3', 'Fiscal', 'Notas de débito', 'resolvido', null, null, 'emitidas as 3 notas', 'assinatura-1');
reset role;
select pg_temp.ok((select count(*) from notificacoes where tipo = 'decisao' and user_id = 'a0000000-0000-0000-0000-00000000000a') = 1, 'delegado recebe o aviso');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
create temp table s as select decisoes_situacao('e000000a-0000-0000-0000-000000000000') j;
grant select on s to authenticated;
select pg_temp.ok((select j #>> '{atual,k1,situacao}' = 'adiado' and j #>> '{atual,k2,delegado_nome}' = 'admin.a' and j #>> '{atual,k3,assinatura}' = 'assinatura-1' from s), 'situação atual por alerta');
select decisoes_tratar(:E, 'k1', 'Caixa', 'Caixa abaixo do mínimo', 'reaberto');
select pg_temp.ok((select decisoes_situacao(:E) #>> '{atual,k1,situacao}') = 'reaberto', 'o último registro vale');
select pg_temp.ok((select jsonb_array_length(decisoes_situacao(:E) -> 'historico')) = 4, 'histórico completo');
-- foto da saúde
insert into saude_historico(empresa_id, geral, areas, alertas) values (:E, 72, '{"Financeiro": 60}', 5);
update saude_historico set geral = 75 where empresa_id = :E and dia = current_date;
-- parâmetros: só administrador e diretor
select pg_temp.falha($$insert into decisoes_config(empresa_id, adiar_dias) values ('e000000a-0000-0000-0000-000000000000', 10) returning 1$$, 'financeiro não altera os pesos');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into decisoes_config(empresa_id, adiar_dias) values (:E, 10);
select pg_temp.falha($$update decisoes_config set faixa_atencao = 90 where empresa_id = 'e000000a-0000-0000-0000-000000000000' returning 1$$, 'faixa de atenção menor que a boa');
reset role;
select pg_temp.ok((select geral from saude_historico where empresa_id = :E) = 75, 'uma foto por dia');
delete from decisoes_tratativas; delete from saude_historico; delete from decisoes_config;
