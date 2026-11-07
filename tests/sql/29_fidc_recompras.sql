-- Recompra de títulos FIDC (SQL 093): só título cedido; cria recompra + encargos + título reaberto; não duplica; vincula
-- registro manual antigo (caso Mastercola); pendências do relatório do fundo e das saídas 2.07.11; cancelar; permissões.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'admin.a@exemplo.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- dados: conta e fundo Negocial, planos 2.07.11 e 2.07.08, cliente e o título cedido (receita paga na conta do fundo)
insert into contas(id, empresa_id, nome) values ('c100000a-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'NEGOCIAL'), ('c100000a-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', 'VEXPENSES');
insert into fidc_fundos(empresa_id, nome, conta_id) values ('e000000a-0000-0000-0000-000000000000', 'Negocial', 'c100000a-0000-0000-0000-000000000001');
insert into plano_contas(id, empresa_id, codigo, nome, tipo, natureza, nivel) values
  ('f100000a-0000-0000-0000-000000000711', 'e000000a-0000-0000-0000-000000000000', '2.07.11', 'RECOMPRA/DEVOLUÇÃO DE TÍTULOS NEGOCIADOS', 'S', 'D', 2),
  ('f100000a-0000-0000-0000-000000000708', 'e000000a-0000-0000-0000-000000000000', '2.07.08', 'JUROS DE FOMENTO FUNDOS', 'S', 'D', 2);
insert into favorecidos(id, empresa_id, nome) values ('ef200000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'MASTERCOLA EXEMPLO');
insert into lancamentos(id, empresa_id, data, plano_id, descricao, favorecido_id, status, conta_id, valor) values
  ('ab200000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', '2026-04-09', 'f0000a01-0000-0000-0000-000000000000', '1-34724/1', 'ef200000-0000-0000-0000-000000000001', 'Pago', 'c100000a-0000-0000-0000-000000000001', 3186.08),
  ('ab200000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', '2026-04-09', 'f0000a01-0000-0000-0000-000000000000', '1-34724/2', 'ef200000-0000-0000-0000-000000000001', 'Pago', 'c100000a-0000-0000-0000-000000000001', 3186.08),
  ('ab200000-0000-0000-0000-000000000003', 'e000000a-0000-0000-0000-000000000000', '2026-04-09', 'f0000a01-0000-0000-0000-000000000000', 'VENDA BALCÃO', 'ef200000-0000-0000-0000-000000000001', 'Pago', 'c000000a-0000-0000-0000-000000000000', 500),
  -- registro manual antigo: a saída da recompra (2.07.11) e o recebimento direto do cliente
  ('ab200000-0000-0000-0000-000000000004', 'e000000a-0000-0000-0000-000000000000', '2026-05-20', 'f100000a-0000-0000-0000-000000000711', 'DOCTO REC 34724/2 NEGOCIAL FIDC', null, 'Pago', 'c100000a-0000-0000-0000-000000000001', 3256.17),
  ('ab200000-0000-0000-0000-000000000005', 'e000000a-0000-0000-0000-000000000000', '2026-07-13', 'f0000a01-0000-0000-0000-000000000000', '1-34724/2 — pago na VExpenses', 'ef200000-0000-0000-0000-000000000001', 'Pago', 'c100000a-0000-0000-0000-000000000002', 3186.08);

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) from fidc_cedidos_busca('e000000a-0000-0000-0000-000000000000', '34724')) = 2, 'busca acha os dois títulos cedidos');
select pg_temp.ok((select count(*) from fidc_cedidos_busca('e000000a-0000-0000-0000-000000000000', 'BALCÃO')) = 0, 'recebimento fora do fundo não é título cedido');
select pg_temp.ok((select count(*) from fidc_recompras_pendentes('e000000a-0000-0000-0000-000000000000') where origem = 'manual' and sugestao_id = 'ab200000-0000-0000-0000-000000000002') = 1, 'saída 2.07.11 manual sugere o título 34724/2');
select pg_temp.falha($q$select fidc_recompra_registrar('ab200000-0000-0000-0000-000000000003', '2026-05-20', 500, null, null)$q$, 'não recompra o que não foi cedido');

-- nova recompra: 3.256,17 pela Negocial → 3.186,08 em 2.07.11 + 70,09 de encargos + título reaberto em aberto
select fidc_recompra_registrar('ab200000-0000-0000-0000-000000000001', '2026-05-20', 3256.17, null, '2026-06-30', 'Cliente não pagou o fundo');
select pg_temp.ok((select valor_recompra = 3256.17 and encargos = 70.09 and fundo = 'Negocial' and not vinculada from fidc_recompras where lancamento_id = 'ab200000-0000-0000-0000-000000000001'), 'recompra com encargos');
select pg_temp.ok((select l.valor = 3186.08 and l.conta_id = 'c100000a-0000-0000-0000-000000000001' and p.codigo = '2.07.11' from fidc_recompras r join lancamentos l on l.id = r.lanc_recompra_id join plano_contas p on p.id = l.plano_id where r.numero = 1), 'saída da recompra na conta do fundo em 2.07.11');
select pg_temp.ok((select l.valor = 70.09 and p.codigo = '2.07.08' from fidc_recompras r join lancamentos l on l.id = r.lanc_encargos_id join plano_contas p on p.id = l.plano_id where r.numero = 1), 'encargos em 2.07.08');
select pg_temp.ok((select l.status = 'Em aberto' and l.conta_id is null and l.valor = 3186.08 and l.data = '2026-06-30' and l.favorecido_id = 'ef200000-0000-0000-0000-000000000001' from fidc_recompras r join lancamentos l on l.id = r.lanc_reaberto_id where r.numero = 1), 'título de volta na carteira, em aberto');
select pg_temp.falha($q$select fidc_recompra_registrar('ab200000-0000-0000-0000-000000000001', '2026-05-21', 3186.08, null, null)$q$, 'não registra duas vezes');
select pg_temp.ok((select reaberto_status = 'Em aberto' and reaberto_venc = '2026-06-30' from fidc_recompras_lista('e000000a-0000-0000-0000-000000000000') where numero = 1), 'lista com o título em aberto');

-- recebimento do título reaberto em outra conta
reset role;
update lancamentos set status = 'Pago', conta_id = 'c100000a-0000-0000-0000-000000000002', data = '2026-07-10' where id = (select lanc_reaberto_id from fidc_recompras where numero = 1);
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select reaberto_status = 'Pago' and recebido_em = '2026-07-10' and recebido_conta = 'VEXPENSES' from fidc_recompras_lista('e000000a-0000-0000-0000-000000000000') where numero = 1), 'recebido em outra conta');
select pg_temp.falha($q$select fidc_recompra_cancelar((select id from fidc_recompras where numero = 1), 'erro')$q$, 'não cancela com o título reaberto já recebido');

-- vincular o registro manual antigo (caso Mastercola): não cria lançamento
select fidc_recompra_registrar('ab200000-0000-0000-0000-000000000002', '2026-05-20', 3256.17, null, null, null, 'ab200000-0000-0000-0000-000000000004', 'ab200000-0000-0000-0000-000000000005');
select pg_temp.ok((select vinculada and encargos = 70.09 and lanc_encargos_id is null and lanc_reaberto_id = 'ab200000-0000-0000-0000-000000000005' from fidc_recompras where numero = 2), 'recompra antiga vinculada');
select pg_temp.ok((select count(*) from lancamentos where origem = 'fidc:recompra:2' or origem like 'fidc:recompra:2:%') = 0, 'vincular não cria lançamento');
select pg_temp.ok((select count(*) from fidc_recompras_pendentes('e000000a-0000-0000-0000-000000000000') where id = 'ab200000-0000-0000-0000-000000000004') = 0, 'a saída vinculada sai das pendências');

-- cancelar uma recompra nova ainda em aberto apaga os lançamentos criados
insert into lancamentos(id, empresa_id, data, plano_id, descricao, favorecido_id, status, conta_id, valor) values
  ('ab200000-0000-0000-0000-000000000006', 'e000000a-0000-0000-0000-000000000000', '2026-08-01', 'f0000a01-0000-0000-0000-000000000000', '1-35000/1', 'ef200000-0000-0000-0000-000000000001', 'Pago', 'c100000a-0000-0000-0000-000000000001', 1000);
select fidc_recompra_registrar('ab200000-0000-0000-0000-000000000006', '2026-09-01', 1000, 'c000000a-0000-0000-0000-000000000000', null);
select pg_temp.ok((select encargos = 0 and lanc_encargos_id is null and conta_id = 'c000000a-0000-0000-0000-000000000000' from fidc_recompras where numero = 3), 'sem encargos; saída pelo banco');
select pg_temp.falha($q$select fidc_recompra_cancelar((select id from fidc_recompras where numero = 3), '')$q$, 'cancelar exige motivo');
select fidc_recompra_cancelar((select id from fidc_recompras where numero = 3), 'lançada por engano');
select pg_temp.ok((select count(*) from lancamentos where origem like 'fidc:recompra:3%') = 0, 'cancelar apaga os lançamentos criados');
select pg_temp.ok((select count(*) from fidc_cedidos_busca('e000000a-0000-0000-0000-000000000000', '35000')) = 1, 'título volta a poder ser recomprado');
reset role;

-- leitura não registra; outra empresa não vê
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($q$select fidc_recompra_registrar('ab200000-0000-0000-0000-000000000006', '2026-09-01', 1000, null, null)$q$, 'leitura não registra');
reset role;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from fidc_recompras_lista('e000000a-0000-0000-0000-000000000000')) = 0, 'outra empresa não vê');
select pg_temp.ok((select count(*) from fidc_recompras) = 0, 'outra empresa não lê a tabela');
reset role;
\o
select 'fidc recompras ok';
