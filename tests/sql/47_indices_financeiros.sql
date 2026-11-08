-- Índices financeiros (SQL 111): parâmetros e comentário por mês; financeiro grava, leitura só lê, outra empresa não vê.
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
insert into indices_config(empresa_id, grupos, faixas) values ('e000000a-0000-0000-0000-000000000000', '{"emprest":["2.1.1.1"]}', '{"lc":{"bom":1.5,"atencao":1.1}}');
select pg_temp.ok((select fonte from indices_config) = 'plataforma' and (select meses from indices_config) = 12, 'padrões');
select pg_temp.falha($$update indices_config set meses = 30$$, 'meses fora da faixa');
select pg_temp.falha($$update indices_config set fonte = 'outra'$$, 'fonte inválida');
select pg_temp.falha($$update indices_config set grupos = '[]'$$, 'grupos precisa ser objeto');
insert into indices_comentarios(empresa_id, mes, texto) values ('e000000a-0000-0000-0000-000000000000', '2026-10-01', 'Liquidez caiu pela parcela da RJ.');
select pg_temp.falha($$insert into indices_comentarios(empresa_id, mes, texto) values ('e000000a-0000-0000-0000-000000000000', '2026-10-15', 'x')$$, 'mês precisa ser dia 1');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from indices_comentarios) = 1, 'leitura vê o comentário');
update indices_config set meses = 6;
update indices_comentarios set texto = 'alterado';
select pg_temp.ok((select meses from indices_config) = 12 and (select texto from indices_comentarios) <> 'alterado', 'leitura não altera');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from indices_config) = 0 and (select count(*) from indices_comentarios) = 0, 'outra empresa não vê');
reset role;
select pg_temp.ok((select count(*) from auditoria where tabela in ('indices_config', 'indices_comentarios')) >= 2, 'auditoria registrou');
delete from indices_comentarios; delete from indices_config;
\o
select 'ok 47 índices financeiros';
