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
-- Recuperadora: receita do grão e aditivos (SQL 165)
insert into produtos(id, empresa_id, codigo, descricao, tipo) values ('98000000-0000-0000-0000-0000000000a1', :E, 'MB-PRETO98', 'Masterbatch preto 98', 'aditivo'),
  ('98000000-0000-0000-0000-0000000000a2', :E, 'PEBD-V98', 'PEBD virgem 98', 'materia_prima'), ('98000000-0000-0000-0000-0000000000a3', :E, 'ANTIOX98', 'Antioxidante 98', 'aditivo');
-- estoque: 100 kg de master a 20,00 e 500 kg de virgem a 9,00 no local MP
insert into est_lotes(id, empresa_id, produto_id, codigo) values ('98000000-0000-0000-0000-0000000000c1', :E, '98000000-0000-0000-0000-0000000000a1', 'MB98-1'), ('98000000-0000-0000-0000-0000000000c2', :E, '98000000-0000-0000-0000-0000000000a1', 'MB98-2'),
  ('98000000-0000-0000-0000-0000000000c3', :E, '98000000-0000-0000-0000-0000000000a2', 'PV98-1');
update produtos set controla_lote = true where id in ('98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000a2', '98000000-0000-0000-0000-0000000000a3');
insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario)
  select :E, p.d::date, p.id, (select id from est_locais where empresa_id = :E and codigo = 'MP'), p.l, (select id from est_tipos_movimento where empresa_id = :E and codigo = 'SI'), p.q, p.c
    from (values ('98000000-0000-0000-0000-0000000000a1'::uuid, '98000000-0000-0000-0000-0000000000c1'::uuid, '2026-11-08', 10, 20.00), ('98000000-0000-0000-0000-0000000000a1'::uuid, '98000000-0000-0000-0000-0000000000c2'::uuid, '2026-11-10', 90, 20.00),
                 ('98000000-0000-0000-0000-0000000000a2'::uuid, '98000000-0000-0000-0000-0000000000c3'::uuid, '2026-11-10', 500, 9.00)) p(id, l, d, q, c);

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select not usar_aditivos and aditivo_baixar_estoque and aditivo_desvio_pct = 20 from rec_config where empresa_id = :E), 'nasce desligado');
-- receita: 2% de master e 10% de virgem sobre o reciclado; uma padrão por grão
insert into rec_receitas(id, empresa_id, material_id, nome, padrao) values ('98000000-0000-0000-0000-0000000000b1', :E, '88000000-0000-0000-0000-0000000000e9', 'Grão preto', true),
  ('98000000-0000-0000-0000-0000000000b2', :E, '88000000-0000-0000-0000-0000000000e9', 'Grão natural', false);
update rec_receitas set padrao = true where id = '98000000-0000-0000-0000-0000000000b2';
select pg_temp.ok((select count(*) = 1 from rec_receitas where material_id = '88000000-0000-0000-0000-0000000000e9' and padrao), 'uma receita padrão por grão');
update rec_receitas set padrao = true where id = '98000000-0000-0000-0000-0000000000b1';
insert into rec_receita_itens(empresa_id, receita_id, produto_id, tipo, dosagem_pct) values (:E, '98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-0000000000a1', 'pigmento', 2),
  (:E, '98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-0000000000a2', 'resina_virgem', 10);
select pg_temp.falha($$insert into rec_receita_itens(empresa_id, receita_id, produto_id, dosagem_pct) values ('e000000a-0000-0000-0000-000000000000', '98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-0000000000a3', 0)$$, 'dosagem zero');

-- ordem: 500 kg do lote LE2-1 (R$ 1,00/kg)
insert into rec_ordens(id, empresa_id, data, material_saida_id, quimicos_valor) values ('98000000-0000-0000-0000-000000000f01', :E, '2026-11-12', '88000000-0000-0000-0000-0000000000e9', 50);
select pg_temp.falha($$select public.rec_ordem_aplicar_receita('98000000-0000-0000-0000-000000000f01', '98000000-0000-0000-0000-0000000000b1')$$, 'receita antes dos lotes');
select public.rec_ordem_entrada('98000000-0000-0000-0000-000000000f01', id, 500) from rec_lotes where empresa_id = :E and codigo = 'LE2-1';
select pg_temp.ok(public.rec_ordem_aplicar_receita('98000000-0000-0000-0000-000000000f01', '98000000-0000-0000-0000-0000000000b1') = 2, 'receita aplicada: 2 itens');
select pg_temp.ok((select kg = 10 and kg_previsto = 10 from rec_ordem_aditivos where ordem_id = '98000000-0000-0000-0000-000000000f01' and tipo = 'pigmento'), '2% de 500 kg = 10 kg');
select pg_temp.ok((select kg = 50 from rec_ordem_aditivos where ordem_id = '98000000-0000-0000-0000-000000000f01' and tipo = 'resina_virgem'), '10% de 500 kg = 50 kg');
-- a dosagem varia: o operador usou 14 kg de master (40% acima do previsto) e tentou gravar custo pela tela
update rec_ordem_aditivos set kg = 14, custo = 999, custo_unitario = 999 where ordem_id = '98000000-0000-0000-0000-000000000f01' and tipo = 'pigmento';
select pg_temp.ok((select kg = 14 and kg_previsto = 10 and custo is null from rec_ordem_aditivos where ordem_id = '98000000-0000-0000-0000-000000000f01' and tipo = 'pigmento'), 'usado diferente do previsto; custo não vem da tela');
-- com o parâmetro desligado, a conclusão ignora os aditivos: 600 kg de saída para 500 de entrada falha
select pg_temp.falha($$select public.rec_ordem_concluir('98000000-0000-0000-0000-000000000f01', 540)$$, 'desligado: saída maior que a entrada');
update rec_config set usar_aditivos = true, aditivo_local_id = (select id from est_locais where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'MP') where empresa_id = :E;
-- item sem saldo no estoque barra a conclusão (e nada fica pela metade)
insert into rec_ordem_aditivos(empresa_id, ordem_id, produto_id, kg) values (:E, '98000000-0000-0000-0000-000000000f01', '98000000-0000-0000-0000-0000000000a3', 1);
select pg_temp.falha($$select public.rec_ordem_concluir('98000000-0000-0000-0000-000000000f01', 540)$$, 'aditivo sem saldo');
select pg_temp.ok((select situacao = 'aberta' from rec_ordens where id = '98000000-0000-0000-0000-000000000f01') and (select sum(quantidade) = 100 from est_saldos where produto_id = '98000000-0000-0000-0000-0000000000a1'), 'nada baixado na falha');
delete from rec_ordem_aditivos where produto_id = '98000000-0000-0000-0000-0000000000a3';
select pg_temp.falha($$select public.rec_ordem_concluir('98000000-0000-0000-0000-000000000f01', 600)$$, 'saída maior que reciclado + aditivos');
-- conclui com 540 kg: entrada 500 + 64 = 564; material 500,00; aditivos 14 × 20 + 50 × 9 = 730,00; processo 50,00; total 1.280,00
create temp table r98 as select public.rec_ordem_concluir('98000000-0000-0000-0000-000000000f01', 540) r;
select pg_temp.ok((select (r ->> 'entrada')::numeric = 564 and (r ->> 'aditivos')::numeric = 64 and (r ->> 'custo_aditivos')::numeric = 730 and (r ->> 'custo_total')::numeric = 1280
  and (r ->> 'rendimento')::numeric = round(540 / 564.0, 4) and (r ->> 'custo_kg')::numeric = round(1280 / 540.0, 4) from r98), 'conclusão: peso e custo com os aditivos');
select pg_temp.ok((select peso_entrada = 564 and peso_aditivos = 64 and custo_material = 500 and custo_aditivos = 730 and custo_processo = 50 and custo_total = 1280 from rec_ordens where id = '98000000-0000-0000-0000-000000000f01'), 'ordem gravada');
select pg_temp.ok((select custo_total = 1280 and peso_kg = 540 from rec_lotes where id = (select lote_saida_id from rec_ordens where id = '98000000-0000-0000-0000-000000000f01')), 'lote de grão com o custo total');
select pg_temp.ok((select quantidade = 76 from est_saldos where lote_id = '98000000-0000-0000-0000-0000000000c2') and (select quantidade = 10 from est_saldos where lote_id = '98000000-0000-0000-0000-0000000000c1') and (select quantidade = 450 from est_saldos where produto_id = '98000000-0000-0000-0000-0000000000a2'), 'baixa no Kardex, do lote que cobre a quantidade');
select pg_temp.ok((select count(*) = 2 and bool_and(est_movimento_id is not null and custo is not null) from rec_ordem_aditivos where ordem_id = '98000000-0000-0000-0000-000000000f01'), 'custo e movimento gravados');
select pg_temp.ok((select kg = 14 from rec_ordem_aditivos where ordem_id = '98000000-0000-0000-0000-000000000f01' and tipo = 'pigmento'), 'ordem concluída não aceita mudança nos aditivos');
-- rendimento e resumo
select pg_temp.ok((select (public.rec_rendimento(:E, '2026-11-12', '2026-11-12') -> 'total' ->> 'custo_aditivos')::numeric = 730), 'rendimento: custo dos aditivos');
select pg_temp.ok((select (g ->> 'custo_aditivos_kg')::numeric = round(730 / 540.0, 4) and (g ->> 'custo_kg')::numeric = round(1280 / 540.0, 4) from jsonb_array_elements(public.rec_rendimento(:E, '2026-11-12', '2026-11-12') -> 'grao') g), 'rendimento por grão');
create temp table a98 as select public.rec_aditivos_resumo(:E, '2026-11-12', '2026-11-12') a;
select pg_temp.ok((select (a -> 'total' ->> 'kg')::numeric = 64 and (a -> 'total' ->> 'custo')::numeric = 730 and (a -> 'total' ->> 'reciclado_pct')::numeric = round(100 * 500 / 564.0, 2) from a98), 'resumo: total e % de reciclado');
select pg_temp.ok((select jsonb_array_length(a -> 'desvios') = 1 and (a -> 'desvios' -> 0 ->> 'desvio_pct')::numeric = 40 from a98), 'resumo: master 40% acima do previsto');
-- sem baixar do estoque: usa o custo médio e não movimenta
update rec_config set aditivo_baixar_estoque = false where empresa_id = :E;
insert into rec_ordens(id, empresa_id, data, material_saida_id) values ('98000000-0000-0000-0000-000000000f02', :E, '2026-11-13', '88000000-0000-0000-0000-0000000000e9');
select public.rec_ordem_entrada('98000000-0000-0000-0000-000000000f02', id, 100) from rec_lotes where empresa_id = :E and codigo = 'LE2-1';
insert into rec_ordem_aditivos(empresa_id, ordem_id, produto_id, tipo, kg) values (:E, '98000000-0000-0000-0000-000000000f02', '98000000-0000-0000-0000-0000000000a1', 'pigmento', 2);
select pg_temp.ok((public.rec_ordem_concluir('98000000-0000-0000-0000-000000000f02', 95) ->> 'custo_aditivos')::numeric = 40, 'sem baixa: custo médio');
select pg_temp.ok((select sum(quantidade) = 86 from est_saldos where produto_id = '98000000-0000-0000-0000-0000000000a1'), 'sem baixa: estoque intacto');
update rec_config set usar_aditivos = false, aditivo_baixar_estoque = true where empresa_id = :E;
-- quem só lê não cadastra receita; quem aponta não cadastra, mas usa
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$insert into rec_receitas(empresa_id, material_id, nome) values ('e000000a-0000-0000-0000-000000000000', '88000000-0000-0000-0000-0000000000e9', 'X')$$, 'leitura não cadastra receita');
reset role;
