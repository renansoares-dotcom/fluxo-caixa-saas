-- Forecast contínuo (SQL 108): rolar pelo realizado, versões, orçamento por centro de custo com aprovação e desvios.
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
\set P '''f000000a-0000-0000-0000-000000000000'''

-- budget 2025: R$ 1.000 por mês; realizado jan 1.200, fev 1.300, mar 1.100
insert into orcamentos(empresa_id, cenario, ano, mes, plano_id, valor) select :E, 'budget', 2025, m, :P, 1000 from generate_series(1, 12) m;
insert into orcamentos(empresa_id, cenario, ano, mes, plano_id, valor) select :E, 'forecast', 2025, m, :P, 900 from generate_series(1, 12) m;
insert into lancamentos(id, empresa_id, data, plano_id, conta_id, valor, descricao, status) values
  ('aa000108-0000-0000-0000-000000000001', :E, '2025-01-15', :P, 'c000000a-0000-0000-0000-000000000000', 1200, 'jan', 'Pago'),
  ('aa000108-0000-0000-0000-000000000002', :E, '2025-02-15', :P, 'c000000a-0000-0000-0000-000000000000', 1300, 'fev', 'Pago'),
  ('aa000108-0000-0000-0000-000000000003', :E, '2025-03-15', :P, 'c000000a-0000-0000-0000-000000000000', 1100, 'mar', 'Pago'),
  ('aa000108-0000-0000-0000-000000000004', :E, '2025-03-20', :P, 'c000000a-0000-0000-0000-000000000000', 999, 'em aberto não conta', 'Em aberto');

-- quem rola
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select forecast_rolar('e000000a-0000-0000-0000-000000000000', 2025, 3)$$, 'leitura não atualiza o forecast');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$select forecast_rolar('e000000a-0000-0000-0000-000000000000', 2025, 3, 'xyz')$$, 'método inválido');

-- tendência: realizado ÷ budget acumulado = 3.600 ÷ 3.000 = 1,2 (dentro do limite de 30%)
select forecast_rolar(:E, 2025, 3, 'tendencia');
select pg_temp.ok((select valor from orcamentos where cenario = 'forecast' and ano = 2025 and mes = 2) = 1300, 'fevereiro = realizado');
select pg_temp.ok((select valor from orcamentos where cenario = 'forecast' and ano = 2025 and mes = 7) = 1200, 'julho = budget × 1,2');
select pg_temp.ok((select count(*) from forecast_versoes where ano = 2025) = 2, 'versão inicial + versão nova');
select pg_temp.ok((select saidas from forecast_versoes where ano = 2025 and motivo = 'inicial') = 10800, 'inicial guarda o forecast antigo');
select pg_temp.ok((select status from forecast_status where empresa_id = :E and ano = 2025 and mes = 3) = 'Realizado' and (select status from forecast_status where empresa_id = :E and ano = 2025 and mes = 4) = 'Prev. Ajustada', 'situação dos meses');
-- limite da tendência
insert into orcamento_config(empresa_id, tendencia_limite) values (:E, 10);
select forecast_rolar(:E, 2025, 3, 'tendencia');
select pg_temp.ok((select valor from orcamentos where cenario = 'forecast' and ano = 2025 and mes = 7) = 1100, 'tendência limitada a +10%');
-- média dos 2 últimos meses (1.300 + 1.100) / 2
select forecast_rolar(:E, 2025, 3, 'media', 2);
select pg_temp.ok((select valor from orcamentos where cenario = 'forecast' and ano = 2025 and mes = 12) = 1200, 'média de 2 meses');
-- budget
select forecast_rolar(:E, 2025, 3, 'budget');
select pg_temp.ok((select valor from orcamentos where cenario = 'forecast' and ano = 2025 and mes = 12) = 1000, 'futuro = budget');
-- manter
update orcamentos set valor = 777 where cenario = 'forecast' and ano = 2025 and mes = 11;
select forecast_rolar(:E, 2025, 3, 'manter');
select pg_temp.ok((select valor from orcamentos where cenario = 'forecast' and ano = 2025 and mes = 11) = 777, 'manter não mexe no futuro');
select pg_temp.ok((select count(*) from orcamentos where cenario = 'forecast' and ano = 2025 and mes = 3) = 1, 'realizado sem duplicar');

-- desvios: tolerância dos parâmetros (10% ou R$ 100) — fevereiro gastou 300 a mais
update orcamento_config set tol_valor = 100 where empresa_id = :E;
select pg_temp.ok((select count(*) from orcamento_desvios(:E, 2025, 2) where not justificado) = 1, 'desvio de fevereiro sem justificativa');
insert into orcamento_justificativas(empresa_id, ano, mes, plano_id, justificativa) values (:E, 2025, 2, :P, 'manutenção extra da extrusora');
select pg_temp.ok((select justificado from orcamento_desvios(:E, 2025, 2)), 'justificado');
select pg_temp.ok((select count(*) from orcamento_desvios(:E, 2025, 3)) = 0, 'março dentro da tolerância');

-- orçamento por centro de custo: responsável (perfil leitura) aprova ou devolve
reset role;
insert into centros_custo(id, empresa_id, nome, responsavel) values ('cc000108-0000-0000-0000-000000000000', :E, 'Extrusão', 'c0000000-0000-0000-0000-00000000000c');
insert into centros_custo(id, empresa_id, nome) values ('cc000108-0000-0000-0000-000000000001', :E, 'Sem dono');
insert into orcamento_rateio_cc(empresa_id, ano, plano_id, centro_custo_id, pct) values (:E, 2025, :P, 'cc000108-0000-0000-0000-000000000000', 50);
insert into orcamentos(empresa_id, cenario, ano, mes, plano_id, centro_custo_id, valor) values (:E, 'budget', 2025, 1, :P, 'cc000108-0000-0000-0000-000000000000', 300);
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select sum(valor) from orcamento_cc_valores(:E, 2025, 'budget', 'cc000108-0000-0000-0000-000000000000')) = 6300, 'direto 300 + 50% de 12.000');
select pg_temp.falha($$select orcamento_cc_enviar('e000000a-0000-0000-0000-000000000000', 2025, 'budget', 'cc000108-0000-0000-0000-000000000001')$$, 'centro sem responsável');
select orcamento_cc_enviar(:E, 2025, 'budget', 'cc000108-0000-0000-0000-000000000000');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from minhas_aprovacoes(:E) where tipo = 'orcamento_cc') = 1, 'aparece em Minhas aprovações');
select pg_temp.ok((select total from orcamento_cc_meus(:E, 2025)) = 6300, 'meus centros');
select pg_temp.falha($$select orcamento_cc_decidir('e000000a-0000-0000-0000-000000000000', 2025, 'budget', 'cc000108-0000-0000-0000-000000000000', false, 'curto')$$, 'devolver pede comentário');
select orcamento_cc_decidir(:E, 2025, 'budget', 'cc000108-0000-0000-0000-000000000000', false, 'faltou a manutenção da extrusora 2');
select pg_temp.ok((select situacao from orcamento_cc_aprovacoes) = 'devolvido', 'devolvido');
select pg_temp.falha($$select orcamento_cc_decidir('e000000a-0000-0000-0000-000000000000', 2025, 'budget', 'cc000108-0000-0000-0000-000000000000', true)$$, 'só decide o que está enviado');
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.falha($$select orcamento_cc_decidir('e000000a-0000-0000-0000-000000000000', 2025, 'budget', 'cc000108-0000-0000-0000-000000000000', true)$$, 'outro usuário não decide');
select pg_temp.ok((select count(*) from orcamento_cc_valores(:E, 2025, 'budget', 'cc000108-0000-0000-0000-000000000000')) = 0, 'compras não vê os valores de centro alheio');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select orcamento_cc_enviar(:E, 2025, 'budget', 'cc000108-0000-0000-0000-000000000000');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select orcamento_cc_decidir(:E, 2025, 'budget', 'cc000108-0000-0000-0000-000000000000', true);
select pg_temp.ok((select situacao from orcamento_cc_aprovacoes) = 'aprovado', 'aprovado');

-- fechar o mês rola o forecast sozinho (SQL 107)
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select fechamento_fechar(:E, '2025-04', '[]', null);
reset role;
select pg_temp.ok((select max(ref_mes) from forecast_versoes where ano = 2025 and motivo = 'fechamento') = 4, 'versão gerada ao fechar abril');
select pg_temp.ok(not exists (select 1 from orcamentos where cenario = 'forecast' and ano = 2025 and mes = 4), 'abril sem realizado fica zerado');

-- outra empresa
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from forecast_versoes) = 0, 'outra empresa não vê as versões');
select pg_temp.falha($$select forecast_rolar('e000000a-0000-0000-0000-000000000000', 2025, 3)$$, 'outra empresa não rola');

reset role;
delete from fechamento_eventos; delete from fechamento_meses; delete from notificacoes where tipo in ('orcamento', 'fechamento');
delete from orcamento_cc_aprovacoes; delete from orcamento_rateio_cc; delete from orcamento_justificativas;
delete from lancamentos where id::text like 'aa000108%';
delete from orcamentos where ano = 2025; delete from forecast_status where ano = 2025; delete from forecast_versoes; delete from orcamento_config;
delete from centros_custo where id::text like 'cc000108%';
\o
select 'ok 44 forecast contínuo';
