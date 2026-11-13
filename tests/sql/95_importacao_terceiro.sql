-- Importação por meio de terceiro (SQL 159): intermediário obrigatório, sem câmbio próprio, repasses ligados aos adiantamentos
-- do financeiro (um adiantamento serve a um processo só), valor informado a confirmar e travas de modalidade.
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
-- saldo de uma conta: entradas − saídas dos lançamentos pagos, com a transferência única contando nas duas pontas
grant execute on all functions in schema pg_temp to authenticated, anon;
\set E '''e000000a-0000-0000-0000-000000000000'''
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set BANCO '''c000000a-0000-0000-0000-000000000000'''
\set EXP '''ef940000-0000-0000-0000-000000000001'''
\set INT '''ef950000-0000-0000-0000-000000000001'''
\set OUT '''ef950000-0000-0000-0000-000000000002'''
\set PT '''1a950000-0000-0000-0000-000000000001'''
\set PT2 '''1a950000-0000-0000-0000-000000000002'''
\set L1 '''1c950000-0000-0000-0000-000000000001'''
\set C1 '''1d950000-0000-0000-0000-000000000001'''
\set C2 '''1d950000-0000-0000-0000-000000000002'''
\set C3 '''1d950000-0000-0000-0000-000000000003'''

insert into favorecidos(id, empresa_id, nome) values (:INT, :E, 'INTERMEDIARIO EXEMPLO RESINAS LTDA'), (:OUT, :E, 'OUTRO FORNECEDOR EXEMPLO');
insert into lancamentos(id, empresa_id, data, plano_id, descricao, favorecido_id, status, conta_id, valor, origem)
select :L1, :E, '2026-09-22', id, 'ADIANTAMENTO FORNECEDOR: INTERMEDIARIO EXEMPLO', :INT, 'Pago', :BANCO, 150000, 'teste:95' from plano_contas where empresa_id = :E and codigo = '2.01.90';
insert into creditos(id, empresa_id, favorecido_id, natureza, tipo, data, valor, descricao, lancamento_id) values
  (:C1, :E, :INT, 'fornecedor', 'adiantamento', '2026-09-22', 150000, 'Pagamento antecipado', :L1),
  (:C2, :E, :INT, 'fornecedor', 'adiantamento', '2026-11-13', 180000, 'Pagamento antecipado', null),
  (:C3, :E, :OUT, 'fornecedor', 'adiantamento', '2026-11-13', 5000, 'Pagamento antecipado', null);

-- ---------- processo por meio de terceiro ----------
select pg_temp.entrar(:CMP);
select pg_temp.falha($q$insert into imp_processos(empresa_id, favorecido_id, modalidade) values ('e000000a-0000-0000-0000-000000000000', 'ef940000-0000-0000-0000-000000000001', 'terceiro')$q$, 'terceiro exige o intermediário');
select pg_temp.falha($q$insert into imp_processos(empresa_id, favorecido_id, modalidade, intermediario_id) values ('e000000a-0000-0000-0000-000000000000', 'ef940000-0000-0000-0000-000000000001', 'terceiro', gen_random_uuid())$q$, 'intermediário de outra empresa');
select pg_temp.falha($q$insert into imp_processos(empresa_id, favorecido_id, modalidade) values ('e000000a-0000-0000-0000-000000000000', 'ef940000-0000-0000-0000-000000000001', 'consignada')$q$, 'modalidade desconhecida');
insert into imp_processos(id, empresa_id, favorecido_id, modalidade, intermediario_id, total_informado_brl, moeda, taxa_prevista, incoterm, proforma)
values (:PT, :E, :EXP, 'terceiro', :INT, 700000, 'USD', 5.6, 'CFR', 'PF-0001');
insert into imp_processos(id, empresa_id, favorecido_id, intermediario_id) values (:PT2, :E, :EXP, :INT);
select pg_temp.ok((select modalidade = 'direta' and intermediario_id is null from imp_processos where id = :PT2), 'importação direta não guarda intermediário');
insert into imp_itens(empresa_id, processo_id, descricao, ncm, quantidade, valor_unitario, ordem) values (:E, :PT, 'RESINA PEBDL', '39014000', 40000, 1.20, 1), (:E, :PT, 'RESINA PEBD', '39011030', 60000, 1.50, 2);

-- ---------- sem câmbio próprio ----------
select pg_temp.falha($q$insert into imp_cambios(empresa_id, processo_id, tipo, valor_moeda, vencimento) values ('e000000a-0000-0000-0000-000000000000', '1a950000-0000-0000-0000-000000000001', 'saldo', 1000, '2026-12-01')$q$, 'terceiro não tem câmbio próprio');
select pg_temp.falha($q$insert into imp_repasses(empresa_id, processo_id, valor) values ('e000000a-0000-0000-0000-000000000000', '1a950000-0000-0000-0000-000000000002', 100)$q$, 'importação direta não tem repasse');

-- ---------- repasses ----------
select pg_temp.ok((select jsonb_array_length(imp_adiantamentos_livres(:PT)) = 2), 'os dois adiantamentos do intermediário estão livres; o do outro fornecedor não aparece');
insert into imp_repasses(empresa_id, processo_id, credito_id, valor, valor_moeda) values (:E, :PT, :C1, 1, 30000);
select pg_temp.ok((select valor = 150000 and data = '2026-09-22' and lancamento_id = :L1 and confirmado and taxa = 5 from imp_repasses where credito_id = :C1), 'repasse copia data, valor e lançamento do adiantamento, confirma pelo lançamento pago e calcula a taxa');
insert into imp_repasses(empresa_id, processo_id, credito_id, valor) values (:E, :PT, :C2, 180000);
select pg_temp.ok((select not confirmado and lancamento_id is null from imp_repasses where credito_id = :C2), 'adiantamento sem lançamento pago fica a confirmar');
select pg_temp.falha($q$insert into imp_repasses(empresa_id, processo_id, credito_id, valor) values ('e000000a-0000-0000-0000-000000000000', '1a950000-0000-0000-0000-000000000001', '1d950000-0000-0000-0000-000000000001', 1)$q$, 'o mesmo adiantamento não entra duas vezes');
select pg_temp.falha($q$insert into imp_repasses(empresa_id, processo_id, credito_id, valor) values ('e000000a-0000-0000-0000-000000000000', '1a950000-0000-0000-0000-000000000001', '1d950000-0000-0000-0000-000000000003', 1)$q$, 'adiantamento de outro fornecedor');
insert into imp_repasses(empresa_id, processo_id, valor, confirmado, observacao) values (:E, :PT, 50000, true, 'data a confirmar');
select pg_temp.ok((select not confirmado and data is null from imp_repasses where processo_id = :PT and credito_id is null), 'valor informado sem adiantamento nunca nasce confirmado');
select pg_temp.falha($q$insert into imp_repasses(empresa_id, processo_id, valor) values ('e000000a-0000-0000-0000-000000000000', '1a950000-0000-0000-0000-000000000001', 0)$q$, 'repasse sem valor');
select pg_temp.ok((select jsonb_array_length(imp_adiantamentos_livres(:PT)) = 0), 'adiantamentos ligados saem da lista de livres');
select pg_temp.ok((select sum(valor) = 380000 and sum(valor) filter (where confirmado) = 150000 from imp_repasses where processo_id = :PT), 'total repassado e confirmado');

-- ---------- travas ----------
select pg_temp.falha($q$update imp_processos set modalidade = 'direta' where id = '1a950000-0000-0000-0000-000000000001'$q$, 'com repasse a modalidade não muda');
select pg_temp.falha($q$update imp_processos set intermediario_id = 'ef950000-0000-0000-0000-000000000002' where id = '1a950000-0000-0000-0000-000000000001'$q$, 'com repasse o intermediário não muda');
update imp_processos set total_informado_brl = 750000, observacao = 'total revisto' where id = :PT;
insert into imp_cambios(empresa_id, processo_id, tipo, valor_moeda, vencimento) values (:E, :PT2, 'saldo', 1000, '2026-12-01');
select pg_temp.falha($q$update imp_processos set modalidade = 'terceiro', intermediario_id = 'ef950000-0000-0000-0000-000000000001' where id = '1a950000-0000-0000-0000-000000000002'$q$, 'processo com câmbio programado não vira terceiro');
select pg_temp.ok((select (imp_custo(:PT) ->> 'fob_brl')::numeric = 772800.00), 'custo da mercadoria pela taxa prevista');
select pg_temp.entrar(:LEI);
select pg_temp.falha($q$insert into imp_repasses(empresa_id, processo_id, valor) values ('e000000a-0000-0000-0000-000000000000', '1a950000-0000-0000-0000-000000000001', 10)$q$, 'leitura não lança repasse');
select pg_temp.ok((select count(*) = 3 from imp_repasses where processo_id = :PT), 'leitura consulta os repasses');
select pg_temp.entrar(:CMP);
delete from imp_repasses where processo_id = :PT and credito_id is null;
delete from imp_processos where id = :PT2;
reset role;
select pg_temp.ok((select count(*) from auditoria where tabela = 'imp_repasses') >= 3, 'auditoria dos repasses');
