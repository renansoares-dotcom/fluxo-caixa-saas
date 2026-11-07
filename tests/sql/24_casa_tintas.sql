-- Casa de Tintas (SQL 088): versão aprovada (única, imutável, anterior obsoleta), ordem só de versão aprovada, pesagem com
-- tolerância e saída do estoque, corrigir proporção, medição fora → ajuste, aprovação vira lote da tinta pronta no estoque com
-- o custo real, entrega e retorno da sobra, sobra como ingrediente, estorno, cancelamento, sem estoque (custo médio) e acesso.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'teste@exemplo.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;
create or replace function pg_temp.saldo(p_prod uuid, p_local text) returns numeric language sql as $$
  select coalesce(sum(s.quantidade), 0) from est_saldos s join est_locais l on l.id = s.local_id where s.produto_id = p_prod and l.codigo = p_local $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- empresa B (estoque implantado): insumos com saldo no INS (base 10/kg, pigmento 40/kg, solvente 6/kg)
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade) values
  ('da000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'TB-AZ', 'TINTA BASE AZUL', 'tinta_solvente', 'KG'),
  ('da000000-0000-0000-0000-000000000002', 'e000000b-0000-0000-0000-000000000000', 'PG-AZ', 'PIGMENTO AZUL 15:3', 'tinta_solvente', 'KG'),
  ('da000000-0000-0000-0000-000000000003', 'e000000b-0000-0000-0000-000000000000', 'SV-01', 'SOLVENTE ACETATO', 'tinta_solvente', 'KG');
update produtos set local_padrao_id = (select id from est_locais where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'INS'), controla_lote = false
 where id in ('da000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000002', 'da000000-0000-0000-0000-000000000003');
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario)
select 'e000000b-0000-0000-0000-000000000000', current_date, x.p::uuid, (select id from est_locais where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'INS'),
       (select id from est_tipos_movimento where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'COMPRA'), x.q, x.c
  from (values ('da000000-0000-0000-0000-000000000001', 200, 10), ('da000000-0000-0000-0000-000000000002', 50, 40), ('da000000-0000-0000-0000-000000000003', 100, 6)) x(p, q, c);

select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((tin_configurar('e000000b-0000-0000-0000-000000000000') ->> 'sistemas')::int = 4, 'sistemas de partida');
select pg_temp.ok((select local_tinta_id is not null and local_maquina_id = (select id from est_locais where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'PROC-IMP')
                   from tin_parametros where empresa_id = 'e000000b-0000-0000-0000-000000000000'), 'locais: casa de tintas e em processo da impressão');
insert into tin_cores(id, empresa_id, codigo, nome, padrao, referencia) values ('db000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'az286', 'AZUL 286', 'pantone', 'Pantone 286 C');
select pg_temp.ok((select codigo from tin_cores where id = 'db000000-0000-0000-0000-000000000001') = 'AZ286', 'código em maiúscula');
insert into tin_receitas(id, empresa_id, cor_id, codigo, nome) values ('dc000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'db000000-0000-0000-0000-000000000001', 'R-AZ286', 'Azul 286 superfície PE');
insert into tin_versoes(id, empresa_id, receita_id, base_kg, viscosidade_alvo, viscosidade_tol, delta_e_max) values ('dd000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'dc000000-0000-0000-0000-000000000001', 100, 22, 2, 1.5);
insert into tin_itens(empresa_id, versao_id, seq, produto_id, quantidade, funcao) values
  ('e000000b-0000-0000-0000-000000000000', 'dd000000-0000-0000-0000-000000000001', 1, 'da000000-0000-0000-0000-000000000001', 60, 'base'),
  ('e000000b-0000-0000-0000-000000000000', 'dd000000-0000-0000-0000-000000000001', 2, 'da000000-0000-0000-0000-000000000002', 25, 'pigmento'),
  ('e000000b-0000-0000-0000-000000000000', 'dd000000-0000-0000-0000-000000000001', 3, 'da000000-0000-0000-0000-000000000003', 15, 'solvente');
select pg_temp.falha($q$insert into tin_ordens(empresa_id, versao_id, quantidade) values ('e000000b-0000-0000-0000-000000000000', 'dd000000-0000-0000-0000-000000000001', 20)$q$, 'ordem só de versão aprovada');
select pg_temp.falha($q$update tin_versoes set situacao = 'aprovada' where id = 'dd000000-0000-0000-0000-000000000001'$q$, 'aprovar só pela função');
select tin_aprovar_versao('dd000000-0000-0000-0000-000000000001');
select pg_temp.falha($q$update tin_itens set quantidade = 61 where versao_id = 'dd000000-0000-0000-0000-000000000001' and seq = 1$q$, 'item de versão aprovada não muda');
select pg_temp.falha($q$update tin_versoes set viscosidade_alvo = 25 where id = 'dd000000-0000-0000-0000-000000000001'$q$, 'versão aprovada não muda');

-- nova versão: cópia em rascunho; aprovada, a anterior fica obsoleta (uma aprovada por receita)
select pg_temp.ok(tin_nova_versao('dd000000-0000-0000-0000-000000000001', 'Teste de outro pigmento') is not null, 'nova versão');
select pg_temp.ok((select count(*) from tin_itens i join tin_versoes v on v.id = i.versao_id where v.receita_id = 'dc000000-0000-0000-0000-000000000001' and v.numero = 2) = 3, 'nova versão copia os itens');
select pg_temp.falha($q$select tin_nova_versao('dd000000-0000-0000-0000-000000000001', null)$q$, 'uma versão em rascunho por vez');
delete from tin_versoes where receita_id = 'dc000000-0000-0000-0000-000000000001' and numero = 2;

-- ordem de 20 kg: previsto 12 / 5 / 3
insert into tin_ordens(id, empresa_id, versao_id, quantidade, observacao) values ('de000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'dd000000-0000-0000-0000-000000000001', 20, 'Teste');
select pg_temp.ok((select numero >= 1 and cor_id = 'db000000-0000-0000-0000-000000000001' from tin_ordens where id = 'de000000-0000-0000-0000-000000000001'), 'numeração e cor da ordem');
select pg_temp.ok((tin_pesar('de000000-0000-0000-0000-000000000001', (select id from tin_itens where versao_id = 'dd000000-0000-0000-0000-000000000001' and seq = 1), null, 12.1) ->> 'fora')::boolean = false, 'base 12,1 kg (0,8%) dentro');
select pg_temp.ok(pg_temp.saldo('da000000-0000-0000-0000-000000000001', 'INS') = 187.9, 'base saiu do estoque');
select pg_temp.falha($q$select tin_pesar('de000000-0000-0000-0000-000000000001', (select id from tin_itens where versao_id = 'dd000000-0000-0000-0000-000000000001' and seq = 2), null, 5.3)$q$, 'pigmento 6% acima exige justificativa');
-- corrigir proporção pelo pigmento: 20 × 5,3/5 = 21,2 kg → base prevista 12,72, pigmento 5,3, solvente 3,18
select pg_temp.ok(tin_reescalar('de000000-0000-0000-0000-000000000001', 21.2) = 21.2, 'proporção corrigida');
select pg_temp.ok((tin_pesar('de000000-0000-0000-0000-000000000001', (select id from tin_itens where versao_id = 'dd000000-0000-0000-0000-000000000001' and seq = 2), null, 5.3) ->> 'desvio_pct')::numeric = 0, 'pigmento no previsto depois da correção');
select tin_pesar('de000000-0000-0000-0000-000000000001', (select id from tin_itens where versao_id = 'dd000000-0000-0000-0000-000000000001' and seq = 1), null, 0.62);
select pg_temp.falha($q$select tin_aprovar_ordem('de000000-0000-0000-0000-000000000001', null)$q$, 'falta pesar o solvente');
select tin_pesar('de000000-0000-0000-0000-000000000001', (select id from tin_itens where versao_id = 'dd000000-0000-0000-0000-000000000001' and seq = 3), null, 3.18, null, null, true);
select pg_temp.falha($q$select tin_aprovar_ordem('de000000-0000-0000-0000-000000000001', null)$q$, 'sem medição não aprova');

-- medição fora (viscosidade 26 s) → em ajuste; ajuste de solvente; medição dentro
insert into tin_medicoes(empresa_id, ordem_id, viscosidade, delta_e) values ('e000000b-0000-0000-0000-000000000000', 'de000000-0000-0000-0000-000000000001', 26, 0.9);
select pg_temp.ok((select situacao from tin_ordens where id = 'de000000-0000-0000-0000-000000000001') = 'em_ajuste', 'medição fora: em ajuste');
select pg_temp.falha($q$select tin_pesar('de000000-0000-0000-0000-000000000001', null, 'da000000-0000-0000-0000-000000000003', 0.5)$q$, 'ajuste exige motivo');
select tin_pesar('de000000-0000-0000-0000-000000000001', null, 'da000000-0000-0000-0000-000000000003', 0.5, null, 'Viscosidade alta: +0,5 kg de solvente');
insert into tin_medicoes(empresa_id, ordem_id, viscosidade, delta_e) values ('e000000b-0000-0000-0000-000000000000', 'de000000-0000-0000-0000-000000000001', 22.5, 0.8);
select pg_temp.falha($q$update tin_ordens set situacao = 'aprovada' where id = 'de000000-0000-0000-0000-000000000001'$q$, 'aprovar só pela função');

-- aprovar: lote T…, tinta pronta no local TIN pelo custo real (12,72×10 + 5,3×40 + 3,68×6 = 361,28 / 21,7 kg)
select pg_temp.ok((tin_aprovar_ordem('de000000-0000-0000-0000-000000000001', null) ->> 'lote') like 'T%', 'tinta aprovada com lote');
select pg_temp.ok((select quantidade_real = 21.7 and custo_total = 361.28 and lote_id is not null and validade = current_date + 30 from tin_ordens where id = 'de000000-0000-0000-0000-000000000001'), 'quantidade real, custo e validade');
select pg_temp.ok(pg_temp.saldo((select produto_id from tin_cores where id = 'db000000-0000-0000-0000-000000000001'), 'TIN') = 21.7, 'tinta pronta no estoque da casa de tintas');
select pg_temp.ok((select round(custo_medio, 4) from est_custos where produto_id = (select produto_id from tin_cores where id = 'db000000-0000-0000-0000-000000000001')) = round(361.28 / 21.7, 4), 'custo da tinta pronta = custo real');
select pg_temp.falha($q$select tin_estornar_pesagem((select id from tin_pesagens where ordem_id = 'de000000-0000-0000-0000-000000000001' limit 1), null)$q$, 'ordem aprovada não estorna pesagem');

-- entrega à máquina e retorno da sobra
select tin_movimentar('de000000-0000-0000-0000-000000000001', 'entrega', 15);
select pg_temp.ok(pg_temp.saldo((select produto_id from tin_cores where id = 'db000000-0000-0000-0000-000000000001'), 'PROC-IMP') = 15, 'entregue no em processo da impressão');
select pg_temp.falha($q$select tin_movimentar('de000000-0000-0000-0000-000000000001', 'entrega', 10)$q$, 'não entrega mais que o lote');
select tin_movimentar('de000000-0000-0000-0000-000000000001', 'retorno', 4);
select pg_temp.falha($q$select tin_movimentar('de000000-0000-0000-0000-000000000001', 'retorno', 20)$q$, 'retorno maior que o entregue');
select pg_temp.ok((select entregue_kg = 15 and retorno_kg = 4 and situacao = 'entregue' from tin_ordens where id = 'de000000-0000-0000-0000-000000000001'), 'entregue 15, voltou 4');
select pg_temp.ok(pg_temp.saldo((select produto_id from tin_cores where id = 'db000000-0000-0000-0000-000000000001'), 'TIN') = 10.7, 'sobra de volta na casa de tintas');

-- segunda ordem aproveita a sobra (sai do lote da casa de tintas); estorno devolve; cancelar só sem pesagem
insert into tin_ordens(id, empresa_id, versao_id, quantidade) values ('de000000-0000-0000-0000-000000000002', 'e000000b-0000-0000-0000-000000000000', 'dd000000-0000-0000-0000-000000000001', 10);
select tin_pesar('de000000-0000-0000-0000-000000000002', null, (select produto_id from tin_cores where id = 'db000000-0000-0000-0000-000000000001'), 2, null, 'Aproveitar a sobra da ordem anterior');
select pg_temp.ok(pg_temp.saldo((select produto_id from tin_cores where id = 'db000000-0000-0000-0000-000000000001'), 'TIN') = 8.7, 'sobra usada como ingrediente');
select pg_temp.falha($q$update tin_ordens set situacao = 'cancelada' where id = 'de000000-0000-0000-0000-000000000002'$q$, 'não cancela com pesagem');
select tin_estornar_pesagem((select id from tin_pesagens where ordem_id = 'de000000-0000-0000-0000-000000000002'), 'Teste');
select pg_temp.ok(pg_temp.saldo((select produto_id from tin_cores where id = 'db000000-0000-0000-0000-000000000001'), 'TIN') = 10.7, 'estorno devolveu a sobra');
update tin_ordens set situacao = 'cancelada' where id = 'de000000-0000-0000-0000-000000000002';
select pg_temp.falha($q$update tin_ordens set custo_total = 1 where id = 'de000000-0000-0000-0000-000000000001'$q$, 'custo não se edita');
reset role;

-- empresa A (estoque não implantado): pesagem não movimenta e custa pelo custo médio; leitura não cadastra
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select tin_configurar('e000000a-0000-0000-0000-000000000000');
insert into tin_cores(id, empresa_id, codigo, nome) values ('db000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', 'BR01', 'BRANCO');
insert into tin_receitas(id, empresa_id, cor_id, codigo, nome) values ('dc000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', 'db000000-0000-0000-0000-0000000000a1', 'R-BR01', 'Branco');
insert into tin_versoes(id, empresa_id, receita_id) values ('dd000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', 'dc000000-0000-0000-0000-0000000000a1');
insert into tin_itens(empresa_id, versao_id, produto_id, quantidade) values ('e000000a-0000-0000-0000-000000000000', 'dd000000-0000-0000-0000-0000000000a1', 'aa000000-0000-0000-0000-000000000001', 100);
select tin_aprovar_versao('dd000000-0000-0000-0000-0000000000a1');
insert into tin_ordens(id, empresa_id, versao_id, quantidade) values ('de000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', 'dd000000-0000-0000-0000-0000000000a1', 10);
select pg_temp.ok((tin_pesar('de000000-0000-0000-0000-0000000000a1', (select id from tin_itens where versao_id = 'dd000000-0000-0000-0000-0000000000a1'), null, 10) ->> 'estoque')::boolean = false, 'sem estoque: não movimenta');
select pg_temp.ok((select custo > 0 and movimento_id is null from tin_pesagens where ordem_id = 'de000000-0000-0000-0000-0000000000a1'), 'custo pelo custo médio');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($q$insert into tin_cores(empresa_id, codigo, nome) values ('e000000a-0000-0000-0000-000000000000', 'X', 'X')$q$, 'leitura não cadastra cor');
select pg_temp.falha($q$select tin_aprovar_versao('dd000000-0000-0000-0000-0000000000a1')$q$, 'leitura não aprova');
select pg_temp.ok((select count(*) from tin_ordens where empresa_id = 'e000000b-0000-0000-0000-000000000000') = 0, 'outra empresa não vê');
reset role;
