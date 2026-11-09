-- Centros de custo em níveis e rateio (SQL 143): hierarquia, limite de níveis, ciclo, rateio em cascata, avisos, critérios, aplicar, fechar e acesso.
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
create or replace function pg_temp.reg(p_nome text) returns jsonb language sql as $$
  select x from jsonb_array_elements(public.cc_rateio_calcular('e000000a-0000-0000-0000-000000000000', '2026-12-01')) x where x ->> 'nome' = p_nome
$$;
create or replace function pg_temp.dest(p_nome text, p_cc text) returns numeric language sql as $$
  select (d ->> 'valor')::numeric from jsonb_array_elements(pg_temp.reg(p_nome) -> 'destinos') d where d ->> 'cc_id' = p_cc
$$;
\set E '''e000000a-0000-0000-0000-000000000000'''
insert into centros_custo(id, empresa_id, nome) values ('79000000-0000-0000-0000-000000000001', :E, 'ADM 79'), ('79000000-0000-0000-0000-000000000004', :E, 'PROD 79');
insert into centros_custo(id, empresa_id, nome, pai_id) values ('79000000-0000-0000-0000-000000000002', :E, 'TI 79', '79000000-0000-0000-0000-000000000001'),
  ('79000000-0000-0000-0000-000000000005', :E, 'EXTRUSAO 79', '79000000-0000-0000-0000-000000000004'), ('79000000-0000-0000-0000-000000000006', :E, 'IMPRESSAO 79', '79000000-0000-0000-0000-000000000004');
insert into centros_custo(id, empresa_id, nome, pai_id) values ('79000000-0000-0000-0000-000000000003', :E, 'SUPORTE 79', '79000000-0000-0000-0000-000000000002');
select pg_temp.ok((select nivel from centros_custo where id = '79000000-0000-0000-0000-000000000003') = 3, 'nível 3');
select pg_temp.falha($$insert into centros_custo(empresa_id, nome, pai_id) values ('e000000a-0000-0000-0000-000000000000', 'NIVEL4 79', '79000000-0000-0000-0000-000000000003')$$, 'quarto nível');
select pg_temp.falha($$update centros_custo set pai_id = '79000000-0000-0000-0000-000000000003' where id = '79000000-0000-0000-0000-000000000001'$$, 'ciclo');
select pg_temp.falha($$insert into centros_custo(empresa_id, nome, pai_id) values ('e000000b-0000-0000-0000-000000000000', 'OUTRA 79', '79000000-0000-0000-0000-000000000001')$$, 'pai de outra empresa');
-- mover TI para PROD: o filho SUPORTE acompanha
update centros_custo set pai_id = '79000000-0000-0000-0000-000000000004' where id = '79000000-0000-0000-0000-000000000002';
select pg_temp.ok((select nivel from centros_custo where id = '79000000-0000-0000-0000-000000000003') = 3, 'filho acompanha');
update centros_custo set pai_id = '79000000-0000-0000-0000-000000000001' where id = '79000000-0000-0000-0000-000000000002';
select pg_temp.ok((select count(*) from public.cc_subarvore('79000000-0000-0000-0000-000000000001')) = 3, 'subárvore');

insert into lancamentos(empresa_id, data, plano_id, conta_id, valor, centro_custo_id, status) values
  (:E, '2026-12-05', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 1000, '79000000-0000-0000-0000-000000000002', 'Pago'),
  (:E, '2026-12-06', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 500, '79000000-0000-0000-0000-000000000003', 'Pago'),
  (:E, '2026-12-07', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 300, '79000000-0000-0000-0000-000000000002', 'Em aberto'),
  (:E, '2026-12-08', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 2000, '79000000-0000-0000-0000-000000000005', 'Pago');

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into cc_rateio_regras(id, empresa_id, nome, ordem, origem_cc_id, criterio) values
  ('79000000-0000-0000-0000-0000000000a1', :E, 'ADM 79 para produção', 10, '79000000-0000-0000-0000-000000000001', 'percentual'),
  ('79000000-0000-0000-0000-0000000000a2', :E, 'EXTRUSAO 79 para impressão', 20, '79000000-0000-0000-0000-000000000005', 'base');
insert into cc_rateio_destinos(regra_id, cc_id, percentual) values ('79000000-0000-0000-0000-0000000000a1', '79000000-0000-0000-0000-000000000005', 60), ('79000000-0000-0000-0000-0000000000a1', '79000000-0000-0000-0000-000000000006', 30);
insert into cc_rateio_destinos(regra_id, cc_id, base) values ('79000000-0000-0000-0000-0000000000a2', '79000000-0000-0000-0000-000000000006', 1);
select pg_temp.falha($$insert into cc_rateio_destinos(regra_id, cc_id, base) values ('79000000-0000-0000-0000-0000000000a2', '79000000-0000-0000-0000-000000000005', 1)$$, 'destino = origem');
select pg_temp.ok(pg_temp.reg('ADM 79 para produção') ->> 'aviso' like '%somam 90%', 'percentuais que não fecham 100');
update cc_rateio_destinos set percentual = 40 where regra_id = '79000000-0000-0000-0000-0000000000a1' and cc_id = '79000000-0000-0000-0000-000000000006';
select pg_temp.ok((pg_temp.reg('ADM 79 para produção') ->> 'total')::numeric = 1500, 'total da subárvore, só pago');
select pg_temp.ok(pg_temp.dest('ADM 79 para produção', '79000000-0000-0000-0000-000000000005') = 900 and pg_temp.dest('ADM 79 para produção', '79000000-0000-0000-0000-000000000006') = 600, '60/40');
select pg_temp.ok((pg_temp.reg('EXTRUSAO 79 para impressão') ->> 'recebido')::numeric = 900 and (pg_temp.reg('EXTRUSAO 79 para impressão') ->> 'total')::numeric = 2900, 'cascata: direto + recebido');
insert into cc_config(empresa_id, base_valores) values (:E, 'todos') on conflict (empresa_id) do update set base_valores = 'todos';
select pg_temp.ok((pg_temp.reg('ADM 79 para produção') ->> 'total')::numeric = 1800, 'base todos inclui em aberto');
update cc_config set base_valores = 'pago' where empresa_id = :E;
-- arredondamento: 1500 em 3 partes iguais
update cc_rateio_destinos set percentual = 33.3333 where regra_id = '79000000-0000-0000-0000-0000000000a1';
insert into cc_rateio_destinos(regra_id, cc_id, percentual) values ('79000000-0000-0000-0000-0000000000a1', '79000000-0000-0000-0000-000000000004', 33.3334);
select pg_temp.ok((select sum((d ->> 'valor')::numeric) from jsonb_array_elements(pg_temp.reg('ADM 79 para produção') -> 'destinos') d) = 1500, 'soma fecha no centavo');
delete from cc_rateio_destinos where regra_id = '79000000-0000-0000-0000-0000000000a1' and cc_id = '79000000-0000-0000-0000-000000000004';
update cc_rateio_destinos set percentual = case when cc_id = '79000000-0000-0000-0000-000000000005' then 60 else 40 end where regra_id = '79000000-0000-0000-0000-0000000000a1';

-- aplicar, resultado, fechar
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');   -- financeiro
select pg_temp.ok(public.cc_rateio_aplicar(:E, '2026-12-01') = 3, '3 linhas gravadas');
select pg_temp.ok((select (x ->> 'rateio_recebido')::numeric = 3500 from jsonb_array_elements(public.cc_resultado(:E, '2026-12-01', '2026-12-31') -> 'linhas') x where x ->> 'cc_id' = '79000000-0000-0000-0000-000000000006'), 'impressão recebe 600 + 2900');
select pg_temp.ok((select (x ->> 'rateio_enviado')::numeric = 1500 and (x ->> 'despesas')::numeric = 0 from jsonb_array_elements(public.cc_resultado(:E, '2026-12-01', '2026-12-31') -> 'linhas') x where x ->> 'cc_id' = '79000000-0000-0000-0000-000000000001'), 'ADM envia 1500');
select public.cc_rateio_situacao(:E, '2026-12-01', true);
select pg_temp.falha($$select public.cc_rateio_aplicar('e000000a-0000-0000-0000-000000000000', '2026-12-01')$$, 'fechado não reaplica');
select pg_temp.falha($$select public.cc_rateio_situacao('e000000a-0000-0000-0000-000000000000', '2026-12-01', false)$$, 'financeiro não reabre');
select pg_temp.falha($$insert into cc_rateio_regras(empresa_id, nome, origem_cc_id, criterio) values ('e000000a-0000-0000-0000-000000000000', 'X', '79000000-0000-0000-0000-000000000001', 'base')$$, 'financeiro não cria regra');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select public.cc_rateio_situacao(:E, '2026-12-01', false);
-- critério pessoas
reset role;
insert into rh_colaboradores(empresa_id, nome, vinculo, situacao, salario, centro_custo_id) values (:E, 'P1 79', 'clt', 'ativo', 1000, '79000000-0000-0000-0000-000000000005'),
  (:E, 'P2 79', 'clt', 'ativo', 1000, '79000000-0000-0000-0000-000000000005'), (:E, 'P3 79', 'clt', 'ativo', 4000, '79000000-0000-0000-0000-000000000006');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
update cc_rateio_regras set criterio = 'pessoas' where id = '79000000-0000-0000-0000-0000000000a1';
select pg_temp.ok(pg_temp.dest('ADM 79 para produção', '79000000-0000-0000-0000-000000000005') = 1000, 'pessoas: 2 de 3');
update cc_rateio_regras set criterio = 'folha' where id = '79000000-0000-0000-0000-0000000000a1';
select pg_temp.ok(pg_temp.dest('ADM 79 para produção', '79000000-0000-0000-0000-000000000006') = 1000, 'folha: 4000 de 6000');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select public.cc_resultado('e000000a-0000-0000-0000-000000000000', '2026-12-01', '2026-12-31')$$, 'leitura sem acesso');
reset role;
\o
select 'ok 79 centros e rateio';
