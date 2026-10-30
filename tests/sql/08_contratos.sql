-- Contratos (SQL 068): só administradores; numeração por empresa; parcelas sem duplicar e respeitando o fim do mês;
-- reajuste proposto só muda valores depois de aprovado; outra empresa não vê nada.
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

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into contratos(id, empresa_id, tipo, objeto, parte_nome, valor, periodicidade, dia_vencimento, inicio, fim, plano_id, conta_id, data_base)
values ('ca000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'locacao_veiculo', 'Locação de caminhão', 'LOCADORA EXEMPLO', 1000, 'mensal', 31,
        '2026-01-31', '2026-06-30', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', '2026-04-01');
insert into contratos(empresa_id, objeto, parte_nome, inicio, natureza, periodicidade) values ('e000000a-0000-0000-0000-000000000000', 'Confidencialidade', 'PARCEIRO', '2026-01-01', 'sem_valor', 'sem_valor');
select pg_temp.ok((select array_agg(numero order by numero) from contratos) = array[1, 2], 'numeração 1, 2');
select pg_temp.ok(contrato_gerar_parcelas('ca000000-0000-0000-0000-000000000001', '2026-12-31') = 6, '6 parcelas (jan a jun)');
select pg_temp.ok(contrato_gerar_parcelas('ca000000-0000-0000-0000-000000000001', '2026-12-31') = 0, 'não duplica');
select pg_temp.ok((select data from lancamentos where contrato_id = 'ca000000-0000-0000-0000-000000000001' and date_trunc('month', data) = '2026-02-01') = '2026-02-28', 'dia 31 vira 28/02');
select pg_temp.ok((select count(*) from lancamentos where contrato_id is not null and status = 'Em aberto' and origem = 'contrato') = 6, 'parcelas em aberto');
insert into contrato_reajustes(id, empresa_id, contrato_id, data_base, indice, percentual, valor_anterior, valor_novo)
values ('ab000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'ca000000-0000-0000-0000-000000000001', '2026-04-01', 'IPCA', 5, 1000, 1050);
select pg_temp.ok((select valor from contratos where numero = 1) = 1000, 'proposto não muda o valor');
select contrato_decidir_reajuste('ab000000-0000-0000-0000-000000000001', true);
select pg_temp.ok((select valor from contratos where numero = 1) = 1050, 'aprovado muda o valor');
select pg_temp.ok((select count(*) from lancamentos where contrato_id = 'ca000000-0000-0000-0000-000000000001' and valor = 1050) = 3, 'abr, mai e jun reajustadas');
select pg_temp.ok((select data_base from contratos where numero = 1) = '2027-04-01', 'próxima data-base em um ano');
insert into storage.objects(bucket_id, name) values ('contratos', 'e000000a-0000-0000-0000-000000000000/ca000000-0000-0000-0000-000000000001/assinado.pdf');
reset role;

-- financeiro e leitura da A não veem contratos
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select count(*) from contratos) = 0, 'financeiro não vê contratos');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'contratos') = 0, 'financeiro não vê os PDFs');
do $$ begin
  begin perform contrato_gerar_parcelas('ca000000-0000-0000-0000-000000000001');
    raise exception 'FALHOU: financeiro gerou parcelas';
  exception when raise_exception then if sqlerrm like 'FALHOU%' then raise; end if; end;
end $$;
reset role;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from contratos) = 0, 'B não vê contratos da A');
select pg_temp.ok((select count(*) from contrato_reajustes) = 0, 'B não vê reajustes da A');
reset role;
\o
select 'ok 08_contratos' as resultado;
