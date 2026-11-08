-- Implantação do estoque (SQL 112): etapas e situação; financeiro grava, leitura só lê, outra empresa não vê.
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
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into est_implantacao_etapas(empresa_id, etapa, responsavel, prevista) values ('e000000a-0000-0000-0000-000000000000', 'espelho', 'Renan', '2026-11-10');
select pg_temp.falha($$insert into est_implantacao_etapas(empresa_id, etapa) values ('e000000a-0000-0000-0000-000000000000', 'outra')$$, 'etapa inválida');
create temp table r as select public.est_implantacao_situacao('e000000a-0000-0000-0000-000000000000') j;
select pg_temp.ok((select j ? 'espelho' and j ? 'prontidao' and j ? 'automatico' and (j->'saldo'->>'movimentos')::int >= 0 from r), 'situação com todos os passos');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from est_implantacao_etapas) = 1, 'leitura vê');
update est_implantacao_etapas set responsavel = 'x';
select pg_temp.ok((select responsavel from est_implantacao_etapas) = 'Renan', 'leitura não altera');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from est_implantacao_etapas) = 0, 'outra empresa não vê');
select pg_temp.falha($$select public.est_implantacao_situacao('e000000a-0000-0000-0000-000000000000')$$, 'outra empresa não consulta');
reset role;
delete from est_implantacao_etapas;
\o
select 'ok 48 implantação do estoque';
