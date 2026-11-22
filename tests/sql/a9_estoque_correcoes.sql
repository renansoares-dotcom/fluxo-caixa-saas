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
-- 177 — correções da avaliação do estoque: recálculo entre empresas, guarda do lançamento direto, lote, estorno, inventário, requisição, nota cancelada, auditoria
\set B '''e000000b-0000-0000-0000-000000000000'''
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
select public._est_configurar(:E::uuid);
select public._est_configurar(:B::uuid);
update est_locais set papeis = null, permite_negativo = false where empresa_id in (:E::uuid, :B::uuid) and codigo in ('MP', 'UC', 'ACA');
delete from est_fechamentos where empresa_id in (:E::uuid, :B::uuid);
update est_inv_config set aprovar_propria = false where empresa_id = :E::uuid;
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade, controla_lote) values
  ('a9000000-0000-0000-0000-0000000000a1', :E, 'A9-RES', 'RESINA A9', 'uso_consumo', 'KG', false),
  ('a9000000-0000-0000-0000-0000000000a2', :E, 'A9-MAS', 'MASTER A9', 'uso_consumo', 'KG', false),
  ('a9000000-0000-0000-0000-0000000000a3', :E, 'A9-TON', 'TONER A9', 'uso_consumo', 'UN', false),
  ('a9000000-0000-0000-0000-0000000000b1', :B, 'A9-B', 'RESINA DA OUTRA EMPRESA', 'uso_consumo', 'KG', false);
insert into est_lotes(id, empresa_id, produto_id, codigo) values ('a9000000-0000-0000-0000-0000000000f1', :E, 'a9000000-0000-0000-0000-0000000000a2', 'A9-LOTE-MAS');
create temp view a9 as select
  (select id from est_locais where empresa_id = :E::uuid and codigo = 'MP') mp, (select id from est_locais where empresa_id = :E::uuid and codigo = 'UC') uc,
  (select id from est_locais where empresa_id = :B::uuid and codigo = 'MP') mpb,
  (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'COMPRA') compra, (select id from est_tipos_movimento where empresa_id = :B::uuid and codigo = 'COMPRA') comprab,
  (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'PERDA') perda, (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'AJ+') ajm,
  (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'SI') si, (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'TRF') trf;
grant select on a9 to authenticated;
create temp table _g (k text primary key, id uuid); grant all on _g to authenticated;

-- tipos sensíveis nascem restritos
select pg_temp.ok((select bool_and(papeis_manual = '{financeiro,diretor}') from est_tipos_movimento where empresa_id = :E::uuid and codigo in ('SI', 'AJ+', 'AJ-')), 'saldo inicial e ajustes: só financeiro, diretor (e admin)');
select pg_temp.ok((select papeis_manual is null from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'COMPRA'), 'os demais tipos seguem livres');

-- 1. recálculo: empresa A não mexe no produto da empresa B
select pg_temp.entrar(:ADB::uuid);
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario) select :B::uuid, current_date, 'a9000000-0000-0000-0000-0000000000b1', mpb, comprab, 500, 8 from a9;
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha($$select public.est_recalcular('e000000a-0000-0000-0000-000000000000', 'a9000000-0000-0000-0000-0000000000b1')$$, 'recalcular produto de outra empresa');
reset role;
select pg_temp.ok((select quantidade = 500 from est_saldos where produto_id = 'a9000000-0000-0000-0000-0000000000b1') and (select quantidade = 500 and custo_medio = 8 from est_custos where produto_id = 'a9000000-0000-0000-0000-0000000000b1'), 'saldo e custo da outra empresa intactos');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.ok(public.est_recalcular(:B::uuid, 'a9000000-0000-0000-0000-0000000000b1') = 1, 'a própria empresa recalcula');
reset role;
select pg_temp.ok((select quantidade = 500 and valor = 4000 from est_saldos where produto_id = 'a9000000-0000-0000-0000-0000000000b1'), 'recálculo confere');

-- 2. guarda do lançamento direto
select pg_temp.entrar(:CMP::uuid);
with x as (insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, criado_por, custo_medio_apos)
  select :E::uuid, current_date, 'a9000000-0000-0000-0000-0000000000a1', mp, compra, 100, 10, :ADM::uuid, 999 from a9 returning id)
insert into _g select 'c1', id from x;
select pg_temp.ok((select criado_por = :CMP::uuid and custo_medio_apos = 10 from est_movimentos where id = (select id from _g where k = 'c1')), 'autor verdadeiro e custo calculado pelo motor, não os enviados');
with x as (insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario)
  select :E::uuid, current_date, 'a9000000-0000-0000-0000-0000000000a1', mp, perda, -10, 1 from a9 returning id)
insert into _g select 's1', id from x;
select pg_temp.ok((select custo_unitario = 10 and valor = -100 from est_movimentos where id = (select id from _g where k = 's1')), 'saída ignora o custo enviado e sai ao custo médio');
select pg_temp.falha($$insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select 'e000000a-0000-0000-0000-000000000000', current_date, 'a9000000-0000-0000-0000-0000000000a1', mp, ajm, 50 from a9$$, 'compras não lança ajuste de inventário');
select pg_temp.falha($$insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario) select 'e000000a-0000-0000-0000-000000000000', current_date, 'a9000000-0000-0000-0000-0000000000a1', mp, si, 50, 1 from a9$$, 'compras não lança saldo inicial');
select pg_temp.falha(format($$insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, estorno_de) select 'e000000a-0000-0000-0000-000000000000', current_date, 'a9000000-0000-0000-0000-0000000000a1', mp, compra, -100, %L from a9$$, (select id from _g where k = 'c1')), 'estorno forjado por lançamento direto');
select pg_temp.falha($$insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, transferencia_id) select 'e000000a-0000-0000-0000-000000000000', current_date, 'a9000000-0000-0000-0000-0000000000a1', mp, perda, -1, gen_random_uuid() from a9$$, 'perna de transferência forjada');
select pg_temp.falha($$insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select 'e000000a-0000-0000-0000-000000000000', current_date, 'a9000000-0000-0000-0000-0000000000a1', mp, trf, 5 from a9$$, 'tipo transferência por lançamento direto');
-- 3. lote de outro produto
select pg_temp.falha($$insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario) select 'e000000a-0000-0000-0000-000000000000', current_date, 'a9000000-0000-0000-0000-0000000000a1', mp, 'a9000000-0000-0000-0000-0000000000f1', compra, 5, 10 from a9$$, 'lote de outro produto');
insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario) select :E::uuid, current_date, 'a9000000-0000-0000-0000-0000000000a2', mp, 'a9000000-0000-0000-0000-0000000000f1', compra, 20, 15 from a9;
-- o financeiro lança o ajuste; o parâmetro libera as compras
select pg_temp.entrar(:FIN::uuid);
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select :E::uuid, current_date, 'a9000000-0000-0000-0000-0000000000a1', mp, ajm, 10 from a9;
select pg_temp.entrar(:ADM::uuid);
update est_tipos_movimento set papeis_manual = '{financeiro,diretor,compras}' where id = (select ajm from a9);
select pg_temp.ok((select count(*) = 1 from auditoria where tabela = 'est_tipos_movimento' and registro_id = (select ajm::text from a9) and 'papeis_manual' = any(campos)), 'mudança de parâmetro fica na trilha de auditoria');
select pg_temp.entrar(:CMP::uuid);
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select :E::uuid, current_date, 'a9000000-0000-0000-0000-0000000000a1', mp, ajm, 1 from a9;
reset role;
select pg_temp.ok((select quantidade = 101 from est_saldos where produto_id = 'a9000000-0000-0000-0000-0000000000a1' and local_id = (select mp from a9)), 'saldo 100 - 10 + 10 + 1');

-- 4. estorno: transferência inteira, uma vez só
select pg_temp.entrar(:CMP::uuid);
insert into _g select 't1', public.est_transferir(:E::uuid, current_date, 'a9000000-0000-0000-0000-0000000000a1', (select mp from a9), (select uc from a9), 30);
select pg_temp.ok((select quantidade = 71 from est_saldos where produto_id = 'a9000000-0000-0000-0000-0000000000a1' and local_id = (select mp from a9)) and (select quantidade = 30 from est_saldos where produto_id = 'a9000000-0000-0000-0000-0000000000a1' and local_id = (select uc from a9)), 'transferiu 30');
select public.est_estornar((select id from est_movimentos where transferencia_id = (select id from _g where k = 't1') and quantidade < 0), current_date, 'local errado');
select pg_temp.ok((select quantidade = 101 from est_saldos where produto_id = 'a9000000-0000-0000-0000-0000000000a1' and local_id = (select mp from a9)) and (select quantidade = 0 from est_saldos where produto_id = 'a9000000-0000-0000-0000-0000000000a1' and local_id = (select uc from a9)), 'estornar uma perna desfaz a transferência inteira');
select pg_temp.ok((select count(*) = 2 from est_movimentos where estorno_de in (select id from est_movimentos where transferencia_id = (select id from _g where k = 't1'))), 'dois estornos, um por perna');
select pg_temp.falha(format('select public.est_estornar(%L)', (select id from est_movimentos where transferencia_id = (select id from _g where k = 't1') and quantidade > 0 and estorno_de is null)), 'a outra perna já foi estornada junto');
select public.est_estornar((select id from _g where k = 's1'));
select pg_temp.falha(format('select public.est_estornar(%L)', (select id from _g where k = 's1')), 'estorno em dobro');
reset role;
select pg_temp.falha(format($$insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, estorno_de) select 'e000000a-0000-0000-0000-000000000000', current_date, 'a9000000-0000-0000-0000-0000000000a1', mp, perda, 10, %L from a9$$, (select id from _g where k = 's1')), 'índice único: segundo estorno do mesmo movimento, mesmo pela plataforma');

-- 5. inventário: item sem lote não duplica; quem contou não aprova
select pg_temp.entrar(:FIN::uuid);
insert into _g select 'inv', public.est_inv_gerar(:E::uuid, (select mp from a9), null, array['a9000000-0000-0000-0000-0000000000a1']::uuid[]);
select public.est_inv_incluir((select id from _g where k = 'inv'), 'a9000000-0000-0000-0000-0000000000a1');
select public.est_inv_incluir((select id from _g where k = 'inv'), 'a9000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((select count(*) = 1 from est_inv_itens where contagem_id = (select id from _g where k = 'inv') and produto_id = 'a9000000-0000-0000-0000-0000000000a1'), 'item sem lote incluído duas vezes continua um só');
select pg_temp.falha(format($$select public.est_inv_incluir(%L, 'a9000000-0000-0000-0000-0000000000a1', 'a9000000-0000-0000-0000-0000000000f1')$$, (select id from _g where k = 'inv')), 'lote de outro produto no inventário');
select public.est_inv_contar(i.id, 60) from est_inv_itens i where contagem_id = (select id from _g where k = 'inv');
select public.est_inv_contar(i.id, 60, 'saco rasgado, material varrido') from est_inv_itens i where contagem_id = (select id from _g where k = 'inv') and situacao = 'recontar';
select public.est_inv_enviar((select id from _g where k = 'inv'));
select pg_temp.falha(format('select public.est_inv_aprovar(%L, true)', (select id from _g where k = 'inv')), 'quem contou não aprova a própria contagem');
select pg_temp.entrar(:ADM::uuid);
insert into est_inv_config(empresa_id, aprovar_propria) values (:E::uuid, true) on conflict (empresa_id) do update set aprovar_propria = true;
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok(public.est_inv_aprovar((select id from _g where k = 'inv'), true) = 1, 'com o parâmetro ligado, aprova e ajusta');
reset role;
select pg_temp.ok((select quantidade = 60 from est_saldos where produto_id = 'a9000000-0000-0000-0000-0000000000a1' and local_id = (select mp from a9)), 'saldo ajustado para o contado');
update est_inv_config set aprovar_propria = false where empresa_id = :E::uuid;

-- 6. requisição: quem pediu não aprova
select pg_temp.entrar(:ADM::uuid);
select public.alm_config_salvar(:E::uuid, null, '{admin,diretor,compras}', '{}', '{admin,diretor}', '{}', false, true, null);
select public.alm_controlar(:E::uuid, 'a9000000-0000-0000-0000-0000000000a3', true);
select pg_temp.entrar(:CMP::uuid);
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario) select :E::uuid, current_date, 'a9000000-0000-0000-0000-0000000000a3', uc, compra, 5, 300 from a9;
select pg_temp.entrar(:ADM::uuid);
create temp table _r as select public.alm_requisitar(:E::uuid, '[{"produto_id":"a9000000-0000-0000-0000-0000000000a3","quantidade":1}]'::jsonb, 'Toner da diretoria') j;
select pg_temp.ok((select j->>'situacao' = 'aprovacao' from _r), 'item controlado pede aprovação');
select pg_temp.falha(format('select public.alm_decidir(%L, true)', (select j->>'id' from _r)), 'quem pediu não aprova a própria requisição');
select public.alm_config_salvar(:E::uuid, null, '{admin,diretor,compras}', '{}', '{admin,diretor}', '{}', false, true, null, true);
select public.alm_decidir((select (j->>'id')::uuid from _r), true);
select pg_temp.ok((select situacao = 'aberta' from alm_requisicoes where id = (select (j->>'id')::uuid from _r)), 'com o parâmetro ligado, aprova');
select pg_temp.ok((select count(*) >= 1 from auditoria where tabela = 'alm_config' and empresa_id = :E::uuid), 'parâmetros do almoxarifado auditados');
select public.alm_config_salvar(:E::uuid, null, '{admin,diretor,compras}', '{}', '{admin,diretor}', '{}', false, true, null);
select pg_temp.ok((select not aprovar_proprio from alm_config where empresa_id = :E::uuid), 'sem informar, a exceção fica desligada');

-- 7. nota cancelada: o estoque não barra; o que não estorna vira pendência
reset role;
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao) values ('a9000000-0000-0000-0000-0000000000c1', :E, 'A9NOTA1', 9901, current_date, 'entrada', false, 'autorizada');
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, nota_id) select :E::uuid, current_date, 'a9000000-0000-0000-0000-0000000000a2', uc, compra, 40, 15, 'a9000000-0000-0000-0000-0000000000c1' from a9;
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select :E::uuid, current_date, 'a9000000-0000-0000-0000-0000000000a2', uc, perda, -40 from a9;
update nfe_notas set situacao = 'cancelada' where id = 'a9000000-0000-0000-0000-0000000000c1';
select pg_temp.ok((select situacao = 'cancelada' from nfe_notas where id = 'a9000000-0000-0000-0000-0000000000c1'), 'a nota foi cancelada mesmo sem saldo para estornar');
select pg_temp.ok((select count(*) = 1 from est_pendencias where nota_id = 'a9000000-0000-0000-0000-0000000000c1' and motivo = 'erro' and status = 'aberta' and mensagem like '%1 movimento(s)%'), 'o estorno que não coube virou pendência');

-- outra empresa
select pg_temp.entrar(:ADB::uuid);
select pg_temp.falha(format('select public.est_estornar(%L)', (select id from _g where k = 'c1')), 'outra empresa não estorna');
\o
\echo a9_estoque_correcoes ok
