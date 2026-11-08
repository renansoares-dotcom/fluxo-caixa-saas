-- Cenários de caixa (SQL 106): quem altera, um cenário de cada tipo padrão e o aviso de caixa mínimo.
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
\set E '''e000000a-0000-0000-0000-000000000000'''

-- financeiro cria os parâmetros e os cenários
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into caixa_config(empresa_id, caixa_minimo, avisar_semanas) values (:E, 80000, 4);
insert into caixa_cenarios(empresa_id, nome, tipo, premissas) values (:E, 'Pessimista', 'pessimista', '{"receber_pct": 90}');
select pg_temp.falha($$insert into caixa_cenarios(empresa_id, nome, tipo) values ('e000000a-0000-0000-0000-000000000000', 'Outro pessimista', 'pessimista')$$, 'um só pessimista');
insert into caixa_cenarios(empresa_id, nome, tipo, premissas) values (:E, 'RJ em março', 'personalizado', '{"rj": {"ativo": true}}');
select pg_temp.falha($$insert into caixa_cenarios(empresa_id, nome, tipo) values ('e000000a-0000-0000-0000-000000000000', 'rj EM MARÇO', 'personalizado')$$, 'nome repetido');
select pg_temp.falha($$insert into caixa_cenarios(empresa_id, nome, premissas) values ('e000000a-0000-0000-0000-000000000000', 'X', '[]')$$, 'premissas precisam ser um objeto');
delete from caixa_cenarios where tipo = 'pessimista';
select pg_temp.ok((select count(*) from caixa_cenarios where tipo = 'pessimista') = 1, 'cenário padrão não se exclui (só se restaura)');

-- leitura vê, mas não altera
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from caixa_cenarios) = 2, 'leitura vê os cenários');
update caixa_config set caixa_minimo = 1;
select pg_temp.ok((select caixa_minimo from caixa_config) = 80000, 'leitura não altera os parâmetros');
select pg_temp.falha($$insert into caixa_cenarios(empresa_id, nome) values ('e000000a-0000-0000-0000-000000000000', 'Meu')$$, 'leitura não cria cenário');

-- aviso: uma vez por semana crítica; de novo só se piorar 20%; fora da janela não avisa
select pg_temp.ok(caixa_registrar_alerta(:E, current_date + 7, 10000, 70000, 'Base'), 'avisa a 1ª vez');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'caixa_minimo') = 0, 'leitura não vê os avisos dos outros') ;
select pg_temp.ok(not caixa_registrar_alerta(:E, current_date + 7, 11000, 69000, 'Base'), 'não repete o aviso');
select pg_temp.ok(caixa_registrar_alerta(:E, current_date + 7, 13000, 67000, 'Base'), 'avisa de novo quando piora mais de 20%');
select pg_temp.ok(not caixa_registrar_alerta(:E, current_date + 60, 5000, 75000, 'Base'), 'fora da janela de 4 semanas não avisa');
select pg_temp.ok(not caixa_registrar_alerta(:E, current_date + 7, 0, 90000, 'Base'), 'sem falta não avisa');
reset role;
select pg_temp.ok((select count(*) from notificacoes where tipo = 'caixa_minimo') = 4, 'avisou o administrador e o financeiro, 2 vezes');
update caixa_config set avisar = false where empresa_id = :E;
delete from caixa_alertas;
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok(not caixa_registrar_alerta(:E, current_date + 7, 10000, 70000, 'Base'), 'aviso desligado nos parâmetros');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from caixa_cenarios) = 0, 'outra empresa não vê');
select pg_temp.falha($$select caixa_registrar_alerta('e000000a-0000-0000-0000-000000000000', current_date + 7, 1, 1, 'x')$$, 'outra empresa não registra alerta');
reset role;
delete from notificacoes where tipo = 'caixa_minimo';
delete from caixa_alertas; delete from caixa_cenarios; delete from caixa_config;
\o
select 'ok 42 cenários de caixa';
