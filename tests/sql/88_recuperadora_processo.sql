-- Recuperadora parte 2 (SQL 152): ordem de reprocesso consumindo lotes (saldo cai e volta), apontamento por etapa com perdas e horas,
-- custo do processo (energia, água, químicos, mão de obra, máquina), conclusão com o lote de grão bloqueado até o ensaio,
-- ensaio contra a especificação (reprova, concessão), saída para a OP com o limite de reciclado, rendimento por fornecedor e economia.
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
insert into prod_setores(id, empresa_id, nome, custo_hora) values ('88000000-0000-0000-0000-0000000000c1', :E, 'Recuperadora 88', 40);
insert into prod_maquinas(id, empresa_id, setor_id, codigo, nome, custo_hora) values ('88000000-0000-0000-0000-0000000000a1', :E, '88000000-0000-0000-0000-0000000000c1', 'AGL88', 'Aglutinador 88', 60),
  ('88000000-0000-0000-0000-0000000000a2', :E, '88000000-0000-0000-0000-0000000000c1', 'MOA88', 'Moinho 88', null);
insert into produtos(id, empresa_id, codigo, descricao) values ('88000000-0000-0000-0000-0000000000d1', :E, 'SACO88', 'Saco 88');
insert into prod_ordens(id, empresa_id, numero, quantidade, produto_id) values ('88000000-0000-0000-0000-0000000000d2', :E, 98801, 1000, '88000000-0000-0000-0000-0000000000d1');

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select public.rec_configurar_padrao(:E);
select pg_temp.ok((select count(*) from rec_etapas where empresa_id = :E) = 6, 'etapas padrão');
update rec_config set custo_kwh = 0.80, custo_m3_agua = 10, custo_hora_mo = 25, meta_rendimento_pct = 85 where empresa_id = :E;
insert into rec_materiais(id, empresa_id, codigo, nome, polimero) values ('88000000-0000-0000-0000-0000000000e9', :E, 'GR-PEBD', 'Grão PEBD reciclado', 'PEBD');
insert into rec_especificacoes(empresa_id, material_id, mfi_min, mfi_max, umidade_max) values (:E, '88000000-0000-0000-0000-0000000000e9', 0.5, 3.0, 0.3);
insert into rec_resina_virgem(empresa_id, polimero, vigencia, preco_kg) values (:E, 'PEBD', '2026-01-01', 9.50);
insert into rec_limites(empresa_id, produto_id, max_pct) values (:E, '88000000-0000-0000-0000-0000000000d1', 30);
-- lotes de entrada (os da parte 1: ticket b3 fechado = 117,6 kg de PEBD-T classe A do catador; e o lote de apara de 29 kg)
select pg_temp.ok((select count(*) from rec_lotes where empresa_id = :E and situacao = 'disponivel' and tipo in ('entrada', 'apara')) >= 3, 'lotes da parte 1');

-- ordem de reprocesso
insert into rec_ordens(id, empresa_id, data, material_saida_id, maquina_id, energia_kwh, agua_m3, quimicos_valor, mo_horas)
  values ('88000000-0000-0000-0000-000000000f01', :E, '2026-11-09', '88000000-0000-0000-0000-0000000000e9', '88000000-0000-0000-0000-0000000000a1', 100, 2, 15, 4);
select pg_temp.ok((select numero = 1 from rec_ordens where id = '88000000-0000-0000-0000-000000000f01'), 'número da ordem');
select public.rec_ordem_entrada('88000000-0000-0000-0000-000000000f01', id, 100) from rec_lotes where empresa_id = :E and codigo = 'LE3-1';
select pg_temp.ok((select saldo_kg = 17.6 and situacao = 'em_processo' from rec_lotes where empresa_id = :E and codigo = 'LE3-1'), 'saldo cai e lote em processo');
select pg_temp.falha($$select public.rec_ordem_entrada('88000000-0000-0000-0000-000000000f01', id, 50) from rec_lotes where codigo = 'LE3-1' and empresa_id = 'e000000a-0000-0000-0000-000000000000'$$, 'mais que o saldo');
select public.rec_ordem_entrada('88000000-0000-0000-0000-000000000f01', id, 29) from rec_lotes where empresa_id = :E and tipo = 'apara' and saldo_kg = 29;
-- tira e põe de novo (o saldo volta)
select public.rec_ordem_entrada_tirar(e.id) from rec_ordem_entradas e join rec_lotes l on l.id = e.lote_id where e.ordem_id = '88000000-0000-0000-0000-000000000f01' and l.tipo = 'apara';
select pg_temp.ok((select saldo_kg = 29 and situacao = 'disponivel' from rec_lotes where empresa_id = :E and tipo = 'apara' and peso_kg = 29), 'tirar devolve o saldo');
select public.rec_ordem_entrada('88000000-0000-0000-0000-000000000f01', id, 29) from rec_lotes where empresa_id = :E and tipo = 'apara' and saldo_kg = 29;
select pg_temp.ok((select situacao = 'consumido' from rec_lotes where empresa_id = :E and tipo = 'apara' and peso_kg = 29), 'apara toda consumida');
-- etapas: moagem (máquina sem custo-hora → setor 40) e aglutinação (60/h), horas pelo início e fim
insert into rec_ordem_etapas(empresa_id, ordem_id, etapa_id, maquina_id, inicio, fim, kg_entrada, kg_saida, perda_sujeira, perda_finos)
  select :E, '88000000-0000-0000-0000-000000000f01', id, '88000000-0000-0000-0000-0000000000a2', '2026-11-09 08:00-03', '2026-11-09 09:30-03', 129, 120, 7, 2 from rec_etapas where empresa_id = :E and codigo = 'MOA';
insert into rec_ordem_etapas(empresa_id, ordem_id, etapa_id, horas_maquina, kg_entrada, kg_saida, perda_umidade)
  select :E, '88000000-0000-0000-0000-000000000f01', id, 2, 120, 110, 10 from rec_etapas where empresa_id = :E and codigo = 'AGL';
select pg_temp.ok((select horas_maquina = 1.5 from rec_ordem_etapas where kg_entrada = 129), 'horas pelo início e fim');
-- custo do processo: 100 kWh × 0,80 + 2 m³ × 10 + 15 + 4 h × 25 + 1,5 h × 40 + 2 h × 60 = 80 + 20 + 15 + 100 + 60 + 120 = 395
select pg_temp.falha($$select public.rec_ordem_concluir('88000000-0000-0000-0000-000000000f01', 200)$$, 'saída maior que a entrada');
select pg_temp.ok((public.rec_ordem_concluir('88000000-0000-0000-0000-000000000f01', 110) ->> 'bloqueado')::boolean, 'grão bloqueado até o ensaio');
-- material: 100 kg do lote LE3-1 (258,72 por 117,6 kg) = 220,00 ; apara 29 kg × 0,50 = 14,50  → 234,50 + 395 = 629,50
select pg_temp.ok((select custo_material = 234.50 and custo_processo = 395 and custo_total = 629.50 and peso_entrada = 129 and peso_saida = 110 from rec_ordens where id = '88000000-0000-0000-0000-000000000f01'), 'custos da ordem');
select pg_temp.ok((select codigo = 'GR-261109-1' and situacao = 'bloqueado' and custo_total = 629.50 from rec_lotes where tipo = 'grao' and empresa_id = :E), 'lote de grão');
select pg_temp.ok((select situacao = 'disponivel' and saldo_kg = 17.6 from rec_lotes where empresa_id = :E and codigo = 'LE3-1'), 'sobra do lote volta a disponível');
update rec_ordens set mo_horas = 9 where id = '88000000-0000-0000-0000-000000000f01';
select pg_temp.ok((select mo_horas = 4 from rec_ordens where id = '88000000-0000-0000-0000-000000000f01'), 'concluída não muda');

-- ensaio: reprova pela umidade, depois concessão com justificativa
select pg_temp.ok(public.rec_ensaio_registrar(id, 1.2, 0.5, 0.92, null, 'natural') ->> 'resultado' = 'reprovado', 'umidade acima reprova') from rec_lotes where tipo = 'grao' and empresa_id = :E;
select pg_temp.falha($$select public.rec_lote_baixar(id, 10, 'producao') from rec_lotes where tipo = 'grao' and empresa_id = 'e000000a-0000-0000-0000-000000000000'$$, 'bloqueado não sai');
select pg_temp.ok(public.rec_ensaio_registrar(id, 1.2, 0.2, 0.92, null, 'natural') ->> 'resultado' = 'aprovado', 'aprovado libera') from rec_lotes where tipo = 'grao' and empresa_id = :E;
select pg_temp.ok((select situacao = 'disponivel' from rec_lotes where tipo = 'grao' and empresa_id = :E), 'liberado');

-- saída para a OP com limite de 30% (1000 kg → 300 kg)
select pg_temp.ok((public.rec_lote_baixar(id, 100, 'producao', '2026-11-09', '88000000-0000-0000-0000-0000000000d2') ->> 'aviso') is null, 'dentro do limite') from rec_lotes where tipo = 'grao' and empresa_id = :E;
select pg_temp.ok((select saldo_kg = 10 from rec_lotes where tipo = 'grao' and empresa_id = :E), 'saldo do grão');
select pg_temp.falha($$select public.rec_lote_baixar(id, 5, 'perda') from rec_lotes where tipo = 'grao' and empresa_id = 'e000000a-0000-0000-0000-000000000000'$$, 'perda sem motivo');

-- rendimento e custo
select pg_temp.ok((public.rec_rendimento(:E, '2026-11-01', '2026-11-30') -> 'total' ->> 'rendimento')::numeric = round(110 / 129.0, 4), 'rendimento total');
select pg_temp.ok((select (x ->> 'economia')::numeric = round((9.50 - round(629.50 / 110, 4)) * 110, 2) from jsonb_array_elements(public.rec_rendimento(:E, '2026-11-01', '2026-11-30') -> 'grao') x), 'economia contra a resina virgem');
select pg_temp.ok((select (x ->> 'grao')::numeric = round(100 * 110 / 129.0, 3) from jsonb_array_elements(public.rec_rendimento(:E, '2026-11-01', '2026-11-30') -> 'fornecedores') x where x ->> 'fornecedor' = 'JOÃO CATADOR 87'), 'grão atribuído ao fornecedor');

-- produção (operador) aponta mas não concede nem lança perda
select pg_temp.entrar('87000000-0000-0000-0000-0000000000aa');
insert into rec_ordens(id, empresa_id, material_saida_id) values ('88000000-0000-0000-0000-000000000f02', :E, '88000000-0000-0000-0000-0000000000e9');
select public.rec_ordem_entrada('88000000-0000-0000-0000-000000000f02', id, 5) from rec_lotes where empresa_id = :E and codigo = 'LE3-1';
select public.rec_ordem_cancelar('88000000-0000-0000-0000-000000000f02', 'teste de cancelamento');
select pg_temp.ok((select saldo_kg = 17.6 from rec_lotes where empresa_id = :E and codigo = 'LE3-1'), 'cancelar devolve');
select pg_temp.falha($$select public.rec_lote_baixar(id, 1, 'perda', current_date, null, null, 'caiu no chão') from rec_lotes where tipo = 'grao' and empresa_id = 'e000000a-0000-0000-0000-000000000000'$$, 'operador não lança perda');
select pg_temp.falha($$insert into rec_etapas(empresa_id, codigo, nome) values ('e000000a-0000-0000-0000-000000000000', 'X', 'X')$$, 'operador não cadastra etapa');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from rec_ordens) = 0 and (select count(*) from rec_ensaios) = 0, 'isolamento');
select pg_temp.falha($$select public.rec_rendimento('e000000a-0000-0000-0000-000000000000', '2026-11-01', '2026-11-30')$$, 'rendimento de outra empresa');
reset role;
\o
select 'ok 88 recuperadora processamento';
