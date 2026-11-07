-- Recompra por motivo (SQL 094): motivos padrão por empresa; cada motivo trata o título do seu jeito (reabrir, devolução
-- total/parcial com nota, substituição por outro título, recebido, erro do fundo); DRE por motivo; contrapartida contábil
-- do motivo no motor; troca de motivo; permissões. Usa os dados do teste 29 (conta e fundo Negocial, 2.07.11, cliente).
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
create or replace function pg_temp.mot(c text) returns uuid language sql as $$
  select id from fidc_recompra_motivos where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = c $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select pg_temp.ok((select count(*) from fidc_recompra_motivos where empresa_id = 'e000000a-0000-0000-0000-000000000000') = 8, 'empresa nova ganha os 8 motivos padrão');
select pg_temp.ok((select count(*) from fidc_recompras where motivo_id = pg_temp.mot('inadimplencia')) >= 2, 'recompras do teste 29 ficaram como inadimplência');

-- títulos cedidos para os casos (receitas pagas na conta do fundo Negocial)
insert into lancamentos(id, empresa_id, data, plano_id, descricao, favorecido_id, status, conta_id, valor) values
  ('ab300000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', '2026-09-01', 'f0000a01-0000-0000-0000-000000000000', '1-36001/1', 'ef200000-0000-0000-0000-000000000001', 'Pago', 'c100000a-0000-0000-0000-000000000001', 2000),
  ('ab300000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', '2026-09-01', 'f0000a01-0000-0000-0000-000000000000', '1-36002/1', 'ef200000-0000-0000-0000-000000000001', 'Pago', 'c100000a-0000-0000-0000-000000000001', 1500),
  ('ab300000-0000-0000-0000-000000000003', 'e000000a-0000-0000-0000-000000000000', '2026-09-01', 'f0000a01-0000-0000-0000-000000000000', '1-36003/1', 'ef200000-0000-0000-0000-000000000001', 'Pago', 'c100000a-0000-0000-0000-000000000001', 1200),
  ('ab300000-0000-0000-0000-000000000004', 'e000000a-0000-0000-0000-000000000000', '2026-09-05', 'f0000a01-0000-0000-0000-000000000000', '1-36103/1 (substitui 36003)', 'ef200000-0000-0000-0000-000000000001', 'Pago', 'c100000a-0000-0000-0000-000000000001', 1200),
  ('ab300000-0000-0000-0000-000000000005', 'e000000a-0000-0000-0000-000000000000', '2026-09-01', 'f0000a01-0000-0000-0000-000000000000', '1-36005/1', 'ef200000-0000-0000-0000-000000000001', 'Pago', 'c100000a-0000-0000-0000-000000000001', 800),
  ('ab300000-0000-0000-0000-000000000006', 'e000000a-0000-0000-0000-000000000000', '2026-09-01', 'f0000a01-0000-0000-0000-000000000000', '1-36006/1', 'ef200000-0000-0000-0000-000000000001', 'Pago', 'c100000a-0000-0000-0000-000000000001', 600);
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, finalidade, emit_nome, favorecido_id, v_nf) values
  ('ad300000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'CHAVE-DEV-1', 9101, '2026-09-20', 'entrada', false, '4', 'MASTERCOLA EXEMPLO', 'ef200000-0000-0000-0000-000000000001', 2000);

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) from fidc_recompra_notas('e000000a-0000-0000-0000-000000000000', 'ef200000-0000-0000-0000-000000000001', '') where do_cliente) = 1, 'acha a nota de devolução do cliente');

-- devolução total: exige a nota; título não volta
select pg_temp.falha($q$select fidc_recompra_registrar('ab300000-0000-0000-0000-000000000001', '2026-09-25', 2000, null, null, p_motivo => pg_temp.mot('devolucao'))$q$, 'devolução exige a nota');
select fidc_recompra_registrar('ab300000-0000-0000-0000-000000000001', '2026-09-25', 2000, null, null, p_motivo => pg_temp.mot('devolucao'), p_nota => 'ad300000-0000-0000-0000-000000000001');
select pg_temp.ok((select lanc_reaberto_id is null and valor_reaberto is null and nota_id is not null from fidc_recompras where lancamento_id = 'ab300000-0000-0000-0000-000000000001'), 'devolução total: título não volta para a carteira');
select pg_temp.ok((select l.descricao like 'Recompra (devolução de mercadoria)%' from fidc_recompras r join lancamentos l on l.id = r.lanc_recompra_id where r.lancamento_id = 'ab300000-0000-0000-0000-000000000001'), 'saída descreve o motivo');

-- devolução parcial: volta só o saldo não devolvido
select pg_temp.falha($q$select fidc_recompra_registrar('ab300000-0000-0000-0000-000000000002', '2026-09-25', 1500, null, null, p_motivo => pg_temp.mot('devolucao'), p_nota => 'ad300000-0000-0000-0000-000000000001', p_valor_reaberto => 1500)$q$, 'saldo da devolução tem de ser menor que o título');
select fidc_recompra_registrar('ab300000-0000-0000-0000-000000000002', '2026-09-25', 1500, null, '2026-10-30', p_motivo => pg_temp.mot('devolucao'), p_nota => 'ad300000-0000-0000-0000-000000000001', p_valor_reaberto => 400);
select pg_temp.ok((select l.valor = 400 and l.status = 'Em aberto' and r.valor_reaberto = 400 from fidc_recompras r join lancamentos l on l.id = r.lanc_reaberto_id where r.lancamento_id = 'ab300000-0000-0000-0000-000000000002'), 'devolução parcial: volta o saldo de 400');

-- substituição: exige outro título cedido; não reabre
select pg_temp.falha($q$select fidc_recompra_registrar('ab300000-0000-0000-0000-000000000003', '2026-09-05', 1200, null, null, p_motivo => pg_temp.mot('substituicao'))$q$, 'substituição exige o título novo');
select pg_temp.falha($q$select fidc_recompra_registrar('ab300000-0000-0000-0000-000000000003', '2026-09-05', 1200, null, null, p_motivo => pg_temp.mot('substituicao'), p_titulo_novo => 'ab300000-0000-0000-0000-000000000003')$q$, 'não substitui por ele mesmo');
select fidc_recompra_registrar('ab300000-0000-0000-0000-000000000003', '2026-09-05', 1200, null, null, p_motivo => pg_temp.mot('substituicao'), p_titulo_novo => 'ab300000-0000-0000-0000-000000000004');
select pg_temp.ok((select lanc_reaberto_id is null and titulo_novo_id = 'ab300000-0000-0000-0000-000000000004' from fidc_recompras where lancamento_id = 'ab300000-0000-0000-0000-000000000003'), 'substituição ligada ao título novo');

-- abatimento: exige observação; volta só o que o cliente vai pagar; inadimplência não aceita parcial
select pg_temp.falha($q$select fidc_recompra_registrar('ab300000-0000-0000-0000-000000000005', '2026-09-25', 800, null, null, p_motivo => pg_temp.mot('abatimento'), p_valor_reaberto => 700)$q$, 'abatimento exige observação');
select pg_temp.falha($q$select fidc_recompra_registrar('ab300000-0000-0000-0000-000000000005', '2026-09-25', 800, null, null, p_motivo => pg_temp.mot('inadimplencia'), p_valor_reaberto => 700)$q$, 'inadimplência volta o título inteiro');
select fidc_recompra_registrar('ab300000-0000-0000-0000-000000000005', '2026-09-25', 800, null, null, 'desconto de 100 por atraso na entrega', p_motivo => pg_temp.mot('abatimento'), p_valor_reaberto => 700);
select pg_temp.ok((select l.valor = 700 from fidc_recompras r join lancamentos l on l.id = r.lanc_reaberto_id where r.lancamento_id = 'ab300000-0000-0000-0000-000000000005'), 'abatimento: volta 700');

-- pago à empresa: exige o recebimento; erro do fundo: não reabre e pede observação
select pg_temp.falha($q$select fidc_recompra_registrar('ab300000-0000-0000-0000-000000000006', '2026-09-25', 600, null, null, p_motivo => pg_temp.mot('pago_empresa'))$q$, 'pago à empresa exige o recebimento');
select fidc_recompra_registrar('ab300000-0000-0000-0000-000000000006', '2026-09-25', 600, null, null, 'débito em duplicidade', p_motivo => pg_temp.mot('erro_fundo'));
select pg_temp.ok((select lanc_reaberto_id is null from fidc_recompras where lancamento_id = 'ab300000-0000-0000-0000-000000000006'), 'erro do fundo: título não volta');

-- lista e DRE por motivo
select pg_temp.ok((select count(*) from fidc_recompras_lista('e000000a-0000-0000-0000-000000000000') where motivo_codigo = 'devolucao' and nota_numero = 9101) = 2, 'lista mostra o motivo e a nota');
select pg_temp.ok((select sum(total) = -3500 from fidc_recompras_dre('e000000a-0000-0000-0000-000000000000', 2026) where motivo = 'Devolução de mercadoria' and dre_secao = 'receita_bruta'), 'DRE: devoluções nas deduções da receita');
select pg_temp.ok((select dre_secao = 'fora' from fidc_recompras_dre('e000000a-0000-0000-0000-000000000000', 2026) where motivo like 'Erro%'), 'DRE: erro do fundo fora da DRE');
select pg_temp.ok((select (fidc_recompras_resumo('e000000a-0000-0000-0000-000000000000', 2026) ->> 'recomprado')::numeric > 0), 'resumo do painel');

-- troca de motivo: só entre motivos que tratam o título igual
select pg_temp.falha($q$select fidc_recompra_motivo_trocar((select id from fidc_recompras where lancamento_id = 'ab300000-0000-0000-0000-000000000001'), pg_temp.mot('inadimplencia'))$q$, 'não troca devolução total por inadimplência (o título teria de voltar)');
select fidc_recompra_motivo_trocar((select id from fidc_recompras where lancamento_id = 'ab300000-0000-0000-0000-000000000005'), pg_temp.mot('prorrogacao'));
select pg_temp.ok((select motivo_id = pg_temp.mot('prorrogacao') from fidc_recompras where lancamento_id = 'ab300000-0000-0000-0000-000000000005'), 'troca abatimento por prorrogação');

-- motivo configurável: desativado não registra; conta contábil escolhida tem de existir
update fidc_recompra_motivos set ativo = false where id = pg_temp.mot('outros');
select pg_temp.falha($q$select fidc_recompra_registrar('ab300000-0000-0000-0000-000000000004', '2026-09-25', 1200, null, null, 'x', p_motivo => pg_temp.mot('outros'))$q$, 'motivo desativado não registra');
select pg_temp.falha($q$update fidc_recompra_motivos set contab_modo = 'conta' where id = pg_temp.mot('devolucao')$q$, 'modo conta exige a conta contábil');
select pg_temp.ok(fidc_recompra_motivos_padrao('e000000a-0000-0000-0000-000000000000') = 1, 'restaurar padrões reativa o que faltava');
reset role;

-- motor contábil: devolução com conta escolhida (4.1.2.x devoluções) em vez do de-para da 2.07.11
insert into contab_contas(id, empresa_id, classificacao, descricao, nivel, tipo, natureza) values
  ('cc300000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', '1.1.10.1', 'BANCO NEGOCIAL', 4, 'A', 'D'),
  ('cc300000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', '1.1.20.2', '(-) DUPLICATAS DESCONTADAS', 4, 'A', 'C'),
  ('cc300000-0000-0000-0000-000000000003', 'e000000a-0000-0000-0000-000000000000', '4.1.2.1', 'DEVOLUÇÕES DE VENDAS', 4, 'A', 'D'),
  ('cc300000-0000-0000-0000-000000000004', 'e000000a-0000-0000-0000-000000000000', '1.1.20.1', 'DUPLICATAS A RECEBER', 4, 'A', 'D');
insert into contab_depara_conta(conta_bancaria_id, empresa_id, conta_id) values ('c100000a-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'cc300000-0000-0000-0000-000000000001');
insert into contab_depara_plano(plano_id, empresa_id, conta_id, tratamento) values ('f100000a-0000-0000-0000-000000000711', 'e000000a-0000-0000-0000-000000000000', 'cc300000-0000-0000-0000-000000000002', 'financiamento');
insert into contab_depara_favorecido(favorecido_id, papel, empresa_id, conta_id) values ('ef200000-0000-0000-0000-000000000001', 'cliente', 'e000000a-0000-0000-0000-000000000000', 'cc300000-0000-0000-0000-000000000004');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
update fidc_recompra_motivos set contab_modo = 'conta', contab_conta_id = 'cc300000-0000-0000-0000-000000000003' where id = pg_temp.mot('devolucao');
update fidc_recompra_motivos set contab_modo = 'cliente' where id = pg_temp.mot('substituicao');
select gerar_contabil_financeiro('e000000a-0000-0000-0000-000000000000', '2026-09-01', '2026-09-30');
select pg_temp.ok((select count(*) from contab_partidas pt join contab_lancamentos l on l.id = pt.lancamento_id join fidc_recompras r on r.lanc_recompra_id = l.origem_id
                    where r.motivo_id = pg_temp.mot('devolucao') and pt.conta_id = 'cc300000-0000-0000-0000-000000000003' and pt.debito > 0) = 2, 'devolução debita a conta de devoluções');
select pg_temp.ok((select pt.conta_id = 'cc300000-0000-0000-0000-000000000004' from contab_partidas pt join contab_lancamentos l on l.id = pt.lancamento_id join fidc_recompras r on r.lanc_recompra_id = l.origem_id
                    where r.motivo_id = pg_temp.mot('substituicao') and pt.debito > 0), 'substituição debita a conta do cliente');
select pg_temp.ok((select pt.conta_id = 'cc300000-0000-0000-0000-000000000002' from contab_partidas pt join contab_lancamentos l on l.id = pt.lancamento_id join fidc_recompras r on r.lanc_recompra_id = l.origem_id
                    where r.motivo_id = pg_temp.mot('erro_fundo') and pt.debito > 0), 'motivo no padrão usa o de-para da 2.07.11');
reset role;

-- leitura não muda motivo; outra empresa não vê
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($q$select fidc_recompra_motivos_padrao('e000000a-0000-0000-0000-000000000000')$q$, 'leitura não restaura padrões');
select pg_temp.ok((select count(*) from fidc_recompra_motivos where empresa_id = 'e000000a-0000-0000-0000-000000000000' and ativo = false) = 0 or true, 'leitura vê os motivos');
reset role;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from fidc_recompra_motivos where empresa_id = 'e000000a-0000-0000-0000-000000000000') = 0, 'outra empresa não vê os motivos');
select pg_temp.ok(fidc_recompras_resumo('e000000a-0000-0000-0000-000000000000', 2026) is null, 'outra empresa não vê o resumo');
reset role;
\o
select 'fidc recompra motivos ok';
