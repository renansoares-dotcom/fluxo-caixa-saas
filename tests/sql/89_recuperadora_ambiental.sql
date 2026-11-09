-- Recuperadora parte 3 (SQL 153): balanço de massa (estoques, compra, desconto, aparas, consumo, perda não explicada), destinação de
-- resíduos com título a pagar, licenças com aviso uma vez por etapa, créditos fiscais por vigência (CBS/IBS do coletor incentivado,
-- PIS/COFINS de pessoa jurídica), alertas da Central de Decisões, relatório de reciclado e permissões.
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
\set E '''e000000a-0000-0000-0000-000000000000'''
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
update rec_config set plano_residuos_id = '87000000-0000-0000-0000-0000000000f1', balanco_tolerancia_pct = 2 where empresa_id = :E;

-- balanço de novembro (dados dos testes 87 e 88)
-- compra: b1 800 kg (PP-C, sem desconto) + b3 120 kg pesados / 117,6 pagos ; aparas 29 kg ; consumido 129 kg ; produzido 110 ; perdas apontadas 19
select pg_temp.ok((public.rec_balanco(:E, '2026-11-01') -> 'material' ->> 'pesado')::numeric = 920 and (public.rec_balanco(:E, '2026-11-01') -> 'material' ->> 'desconto')::numeric = 2.4, 'pesado e desconto');
select pg_temp.ok((public.rec_balanco(:E, '2026-11-01') -> 'processo' ->> 'perda')::numeric = 19 and (public.rec_balanco(:E, '2026-11-01') -> 'processo' ->> 'nao_explicada')::numeric = 0, 'perda explicada pelas etapas');
select pg_temp.ok((public.rec_balanco(:E, '2026-11-01') -> 'grao' ->> 'estoque_final')::numeric = (select sum(saldo_kg) from rec_lotes where empresa_id = :E and tipo = 'grao'), 'estoque de grão bate com os lotes');
select pg_temp.ok((public.rec_balanco(:E, '2026-11-01') -> 'material' ->> 'estoque_final')::numeric = (select sum(saldo_kg) from rec_lotes where empresa_id = :E and tipo <> 'grao' and situacao <> 'cancelado'), 'estoque de material bate com os lotes');
select pg_temp.ok((public.rec_balanco(:E, '2026-11-01') -> 'grao' -> 'saidas' ->> 'producao')::numeric = 100, 'saídas do grão');

-- resíduos: com valor e conta gera título; sem CDF aparece no balanço
insert into favorecidos(id, empresa_id, tipo, nome, documento) values ('89000000-0000-0000-0000-0000000000b1', :E, 'FORNECEDORES', 'ATERRO 89 LTDA', '22.333.444/0001-55');
insert into rec_residuos(empresa_id, data, tipo, kg, destinador_id, destinacao, mtr_numero, valor) values (:E, '2026-11-09', 'rejeito', 12, '89000000-0000-0000-0000-0000000000b1', 'aterro', '123456', 180);
select pg_temp.ok((select count(*) from lancamentos where empresa_id = :E and documento = 'MTR 123456' and valor = 180 and status = 'Em aberto') = 1, 'título da destinação');
select pg_temp.ok((public.rec_balanco(:E, '2026-11-01') -> 'residuos' ->> 'sem_cdf')::numeric = 12, 'sem CDF');
update rec_residuos set cdf_numero = 'CDF-9', cdf_data = '2026-11-20' where empresa_id = :E;
select pg_temp.ok((public.rec_balanco(:E, '2026-11-01') -> 'residuos' ->> 'sem_cdf')::numeric = 0, 'com CDF');

-- fiscal: sem parâmetro = zero; carregando a LC 214 e informando PIS/COFINS
select pg_temp.ok((public.rec_fiscal(:E, '2026-11-01', '2026-11-30') -> 'total' ->> 'sem_parametro')::int = 2, 'sem parâmetro');
select pg_temp.ok(public.rec_fiscal_carregar_lc214(:E) = 6, 'percentuais da LC 214 carregados');
insert into rec_fiscal_param(empresa_id, vigencia, cbs_presumido_pct, ibs_presumido_pct, pis_cofins_pct, fonte) values (:E, '2026-01-01', 0, 0, 9.25, 'Lei 10.833/2003 e Tema 304 do STF (teste)');
-- b1 = sucateiro PJ (800,00) → PIS/COFINS 74,00 ; b3 = catador coletor incentivado (258,72) → em 2026 sem CBS/IBS
select pg_temp.ok((public.rec_fiscal(:E, '2026-11-01', '2026-11-30') -> 'total' ->> 'pis_cofins')::numeric = 74 and (public.rec_fiscal(:E, '2026-11-01', '2026-11-30') -> 'total' ->> 'cbs')::numeric = 0, 'PIS/COFINS da PJ');
-- simula 2029: o mesmo ticket do catador em 2029 teria CBS 7% e IBS 1,3%
reset role;
update rec_tickets set data_hora = '2029-03-10 10:00-03' where chave_importacao = 'b3';
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((public.rec_fiscal(:E, '2029-01-01', '2029-12-31') -> 'total' ->> 'cbs')::numeric = round(258.72 * 0.07, 2) and (public.rec_fiscal(:E, '2029-01-01', '2029-12-31') -> 'total' ->> 'ibs')::numeric = round(258.72 * 0.013, 2), 'CBS e IBS presumidos do coletor');
reset role;
update rec_tickets set data_hora = '2026-11-08 11:00-03' where chave_importacao = 'b3';

-- licenças e alertas
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into rec_licencas(id, empresa_id, tipo, numero, orgao, validade) values
  ('89000000-0000-0000-0000-0000000000c1', :E, 'Licença de Operação', 'LO 89/2024', 'CPRH', current_date + 20),
  ('89000000-0000-0000-0000-0000000000c2', :E, 'CTF/IBAMA', null, 'IBAMA', current_date - 1),
  ('89000000-0000-0000-0000-0000000000c3', :E, 'Outorga de água', null, 'APAC', current_date + 300);
select pg_temp.ok((select count(*) from jsonb_array_elements(public.rec_alertas(:E)) x where x ->> 'k' = 'licenca') = 2, 'duas licenças no alerta');
reset role;
select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false);
select pg_temp.ok(public._rec_licencas_avisar(:E, current_date) = 2, 'avisa a vencer e vencida');
select pg_temp.ok(public._rec_licencas_avisar(:E, current_date) = 0, 'não repete');
select pg_temp.ok((select count(*) from notificacoes where empresa_id = :E and tipo = 'rec_licenca') >= 2, 'avisos gravados');

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok(jsonb_array_length(public.rec_reciclado(:E, '2026-11-01', '2026-11-30') -> 'origem') >= 2, 'reciclado por origem');
-- produção não cadastra licença; outra empresa não vê
select pg_temp.entrar('87000000-0000-0000-0000-0000000000aa');
select pg_temp.falha($$insert into rec_licencas(empresa_id, tipo) values ('e000000a-0000-0000-0000-000000000000', 'X')$$, 'produção não cadastra licença');
select pg_temp.ok((select count(*) from rec_licencas) = 3, 'produção vê');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from rec_licencas) = 0 and (select count(*) from rec_residuos) = 0 and jsonb_array_length(public.rec_alertas('e000000a-0000-0000-0000-000000000000')) = 0, 'isolamento');
select pg_temp.falha($$select public.rec_balanco('e000000a-0000-0000-0000-000000000000', '2026-11-01')$$, 'balanço de outra empresa');
reset role;
\o
select 'ok 89 recuperadora ambiental e fiscal';
