-- Minhas aprovações (SQL 091): cada tipo só para quem decide; leitura e outra empresa não veem nada.
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
grant execute on all functions in schema pg_temp to authenticated, anon;

-- empresa A: a prorrogação pendente (teste 26) aparece para admin e financeiro, não para leitura
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) from minhas_aprovacoes('e000000a-0000-0000-0000-000000000000') where tipo = 'prorrogacao') = 1, 'admin vê a prorrogação');
select pg_temp.ok((select count(*) from minhas_aprovacoes('e000000b-0000-0000-0000-000000000000')) = 0, 'outra empresa: nada');
reset role;
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select count(*) from minhas_aprovacoes('e000000a-0000-0000-0000-000000000000') where tipo = 'prorrogacao') = 1, 'financeiro vê a prorrogação');
select pg_temp.ok((select count(*) from minhas_aprovacoes('e000000a-0000-0000-0000-000000000000') where tipo in ('bordero', 'reajuste', 'pedido')) = 0, 'financeiro não decide borderô, reajuste nem pedido');
reset role;
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from minhas_aprovacoes('e000000a-0000-0000-0000-000000000000')) = 0, 'leitura não tem aprovações');
reset role;
-- empresa B: a arte aprovada esperando liberação (teste 25)
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from minhas_aprovacoes('e000000b-0000-0000-0000-000000000000') where tipo = 'arte' and lote) = 1, 'admin vê a arte para liberar');
reset role;
\o
select 'minhas aprovacoes ok';
