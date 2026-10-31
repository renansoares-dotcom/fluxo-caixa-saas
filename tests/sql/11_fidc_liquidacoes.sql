-- Liquidações FIDC (SQL 073): financeiro grava; leitura só lê; outra empresa não vê; título apagado deixa a liquidação sem vínculo.
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
insert into fidc_operacoes(id, empresa_id, fundo, data, bordero) values ('fd000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'Negocial', '2026-09-01', '700');
insert into fidc_titulos(id, empresa_id, operacao_id, fundo, bordero, data_operacao, titulo, vencimento, valor) values
  ('fe000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'fd000000-0000-0000-0000-000000000001', 'Negocial', '700', '2026-09-01', '10001-001', '2026-10-01', 1000);
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into fidc_liquidacoes(empresa_id, fundo, titulo, bordero, fidc_titulo_id, vencimento, quitacao, valor_face, valor_pago, tipo)
  values ('e000000a-0000-0000-0000-000000000000', 'Negocial', '10001-001', '700', 'fe000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-01', 1000, 1000, 'normal');
-- reimportar atualiza (mesmo fundo/título/borderô)
insert into fidc_liquidacoes(empresa_id, fundo, titulo, bordero, fidc_titulo_id, vencimento, quitacao, valor_face, valor_pago, tipo)
  values ('e000000a-0000-0000-0000-000000000000', 'Negocial', '10001-001', '700', 'fe000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-02', 1000, 1012, 'normal')
  on conflict (empresa_id, fundo, titulo, bordero) do update set quitacao = excluded.quitacao, valor_pago = excluded.valor_pago;
select pg_temp.ok((select count(*) from fidc_liquidacoes) = 1 and (select valor_pago from fidc_liquidacoes) = 1012, 'reimportação atualiza sem duplicar');
reset role;
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from fidc_liquidacoes) = 1, 'leitura vê');
do $$ begin
  begin insert into fidc_liquidacoes(empresa_id, fundo, titulo, quitacao) values ('e000000a-0000-0000-0000-000000000000', 'Negocial', 'x', '2026-10-01'); raise exception 'FALHOU: leitura gravou';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from fidc_liquidacoes) = 0, 'B não vê as liquidações da A');
reset role;
delete from fidc_titulos where id = 'fe000000-0000-0000-0000-000000000001';
select pg_temp.ok((select fidc_titulo_id from fidc_liquidacoes) is null, 'título apagado: liquidação fica sem vínculo');
\o
select 'ok 11_fidc_liquidacoes' as resultado;
