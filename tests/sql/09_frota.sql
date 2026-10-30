-- Frota (SQL 070): quem edita a logística vê e grava; leitura e outra empresa não veem;
-- km atual acompanha abastecimentos/manutenções; preventiva executada atualiza o plano.
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
grant execute on all functions in schema pg_temp to authenticated, anon;
insert into log_veiculos(id, empresa_id, codigo, placa, carga_kg) values ('fa000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'TRK-01', 'ABC1D23', 8000);

-- financeiro da A (edita a logística)
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into frota_motoristas(id, empresa_id, nome, cnh_categoria, cnh_validade) values ('fb000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'MOTORISTA TESTE', 'D', '2027-01-31');
insert into frota_planos(id, empresa_id, veiculo_id, descricao, a_cada_km) values ('fc000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'fa000000-0000-0000-0000-000000000001', 'Troca de óleo', 20000);
insert into frota_abastecimentos(empresa_id, veiculo_id, motorista_id, data, km, litros, valor) values
  ('e000000a-0000-0000-0000-000000000000', 'fa000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000001', '2026-10-01', 100000, 200, 1200),
  ('e000000a-0000-0000-0000-000000000000', 'fa000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000001', '2026-10-10', 100800, 160, 960);
insert into frota_manutencoes(empresa_id, veiculo_id, plano_id, data, km, tipo, descricao, valor) values
  ('e000000a-0000-0000-0000-000000000000', 'fa000000-0000-0000-0000-000000000001', 'fc000000-0000-0000-0000-000000000001', '2026-10-05', 100400, 'preventiva', 'Óleo e filtros', 900);
insert into frota_multas(empresa_id, veiculo_id, motorista_id, data_infracao, infracao, valor) values ('e000000a-0000-0000-0000-000000000000', 'fa000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000001', '2026-10-03', 'Excesso de velocidade', 130.16);
select pg_temp.ok((select km_atual from log_veiculos where codigo = 'TRK-01') = 100800, 'km atual = maior km');
select pg_temp.ok((select ultimo_km from frota_planos) = 100400 and (select ultima_data from frota_planos) = '2026-10-05', 'plano atualizado pela preventiva');
insert into storage.objects(bucket_id, name) values ('frota', 'e000000a-0000-0000-0000-000000000000/multas/auto.pdf');
reset role;

-- leitura da A não vê
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from frota_motoristas) = 0, 'leitura não vê motoristas');
select pg_temp.ok((select count(*) from frota_multas) = 0, 'leitura não vê multas');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'frota') = 0, 'leitura não vê arquivos da frota');
reset role;
-- outra empresa não vê
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from frota_abastecimentos) = 0, 'B não vê abastecimentos da A');
select pg_temp.ok((select count(*) from frota_manutencoes) = 0, 'B não vê manutenções da A');
reset role;
\o
select 'ok 09_frota' as resultado;
