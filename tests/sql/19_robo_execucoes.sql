-- Execuções do robô FIDC (SQL 083): financeiro registra; leitura só lê; outra empresa não vê; ninguém altera/apaga pela API.
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
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into robo_execucoes(empresa_id, robo, fonte, status, novos, valor_pago) values ('e000000a-0000-0000-0000-000000000000', 'fidc-liquidacoes', 'Negocial', 'ok', 3, 1000);
select pg_temp.ok((select executado_por from robo_execucoes) = 'd0000000-0000-0000-0000-00000000000d', 'execução registra o usuário do robô');
update robo_execucoes set novos = 99;
select pg_temp.ok((select novos from robo_execucoes) = 3, 'execução não é alterada pela API');
delete from robo_execucoes;
select pg_temp.ok((select count(*) from robo_execucoes) = 1, 'execução não é apagada pela API');
reset role;
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from robo_execucoes) = 1, 'leitura vê');
do $$ begin
  begin insert into robo_execucoes(empresa_id, robo, fonte, status) values ('e000000a-0000-0000-0000-000000000000', 'x', 'y', 'ok'); raise exception 'FALHOU: leitura gravou';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from robo_execucoes) = 0, 'B não vê as execuções da A');
reset role;
\o
select 'ok 19_robo_execucoes' as resultado;
