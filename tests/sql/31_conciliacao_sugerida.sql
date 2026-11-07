-- Conciliação sugerida (SQL 095): parâmetros por empresa com faixas válidas; situação dos extratos por conta; permissões.
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
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into extrato_importacoes(id, empresa_id, conta_id, arquivo, dt_inicio, dt_fim, saldo_final, saldo_data, qtd, formato) values
  ('aa310000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 'extrato.ret', '2026-11-01', '2026-11-04', 1860.3, '2026-11-04', 2, 'cnab240');
insert into extrato_itens(empresa_id, conta_id, importacao_id, data, valor, fitid, descricao) values
  ('e000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 'aa310000-0000-0000-0000-000000000001', '2026-11-03', 1500.5, 'cnab:t1', 'PIX'),
  ('e000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 'aa310000-0000-0000-0000-000000000001', '2026-11-03', -320.1, 'cnab:t2', 'TARIFA');

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into conc_config(empresa_id, dias_exato, conf_alta, conf_media, pesos, alerta_dias, contas_sem_alerta)
  values ('e000000a-0000-0000-0000-000000000000', 2, 90, 65, '{"mesmo_dia": 25}', 3, array['c100000a-0000-0000-0000-000000000002'::uuid]);
select pg_temp.falha($q$update conc_config set conf_media = 95 where empresa_id = 'e000000a-0000-0000-0000-000000000000'$q$, 'faixa média tem de ficar abaixo da alta');
select pg_temp.falha($q$update conc_config set dias_exato = 40 where empresa_id = 'e000000a-0000-0000-0000-000000000000'$q$, 'janela de dias limitada');
select pg_temp.ok((select ultimo_fim = '2026-11-04' and formato = 'cnab240' and pendentes = 2 and pendentes_valor = 1180.4
                     from conc_extratos_situacao('e000000a-0000-0000-0000-000000000000') where conta_id = 'c000000a-0000-0000-0000-000000000000'), 'situação da conta com o último extrato');
reset role;
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from conc_config where empresa_id = 'e000000a-0000-0000-0000-000000000000') = 1, 'leitura vê os parâmetros');
reset role;
update conc_config set alerta_dias = 3 where true;
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
update conc_config set alerta_dias = 10 where empresa_id = 'e000000a-0000-0000-0000-000000000000';
reset role;
select pg_temp.ok((select alerta_dias = 3 from conc_config where empresa_id = 'e000000a-0000-0000-0000-000000000000'), 'leitura não altera (RLS)');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from conc_config) = 0, 'outra empresa não vê');
select pg_temp.ok((select count(*) from conc_extratos_situacao('e000000a-0000-0000-0000-000000000000')) = 0, 'outra empresa não vê a situação');
reset role;
\o
select 'conciliacao sugerida ok';
