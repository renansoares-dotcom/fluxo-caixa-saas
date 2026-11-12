-- Emissão de NF-e (SQL 156): parâmetros só pelo administrador, quem emite, naturezas de partida, rascunho pela tela,
-- retorno da SEFAZ só pela função de serviço, travas depois do envio.
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

select pg_temp.entrar(:FIN);
select pg_temp.falha($q$insert into nfe_config(empresa_id) values ('e000000a-0000-0000-0000-000000000000')$q$, 'financeiro não grava os parâmetros da emissão');
select pg_temp.ok(nfe_pode(:E), 'financeiro emite por padrão');
select pg_temp.entrar(:LEI);
select pg_temp.ok(not nfe_pode(:E), 'leitura não emite');
select pg_temp.falha($q$select nfe_naturezas_padrao('e000000a-0000-0000-0000-000000000000')$q$, 'leitura não cria naturezas');
select pg_temp.entrar(:ADM);
select pg_temp.ok(nfe_pode(:E), 'administrador emite');
insert into nfe_config(empresa_id, ambiente, papeis) values (:E, 'homologacao', '{compras}');
select pg_temp.entrar(:FIN);
select pg_temp.ok(not nfe_pode(:E), 'papel tirado dos parâmetros deixa de emitir');
select pg_temp.entrar(:ADM);
update nfe_config set papeis = '{financeiro}' where empresa_id = :E;

select pg_temp.entrar(:FIN);
select pg_temp.ok(nfe_naturezas_padrao(:E) = 6 and nfe_naturezas_padrao(:E) = 0, 'naturezas de partida criadas uma vez só');
select id as "NAT" from nfe_naturezas where empresa_id = :E and nome = 'Venda de produção' \gset
update nfe_naturezas set icms_aliquota_interna = 20.5, ipi_aliquota = 15 where id = :'NAT';

-- rascunho pela tela: ambiente vem dos parâmetros e os campos da SEFAZ não são aceitos
insert into nfe_emissoes(id, empresa_id, ambiente, natureza_id, natureza_operacao, destinatario, itens, valor_total, numero, chave, protocolo)
values ('ee000000-0000-0000-0000-000000000001', :E, 'producao', :'NAT', 'VENDA', '{"nome":"Cliente Exemplo"}', '[{"descricao":"Filme"}]', 100, '999', repeat('1', 44), 'P1');
select pg_temp.ok((select ambiente = 'homologacao' and numero is null and chave is null and protocolo is null and status = 'rascunho' from nfe_emissoes where id = 'ee000000-0000-0000-0000-000000000001'), 'rascunho nasce no ambiente da empresa, sem dados da SEFAZ');
select pg_temp.falha($q$insert into nfe_emissoes(empresa_id, status) values ('e000000a-0000-0000-0000-000000000000', 'autorizada')$q$, 'a tela só cria rascunho');
select pg_temp.falha($q$update nfe_emissoes set status = 'autorizada' where id = 'ee000000-0000-0000-0000-000000000001'$q$, 'a tela não autoriza a nota');
select pg_temp.falha($q$select nfe_registrar('ee000000-0000-0000-0000-000000000001', '{"status":"autorizada"}')$q$, 'a tela não chama a função de serviço');
update nfe_emissoes set valor_total = 250, chave = repeat('2', 44) where id = 'ee000000-0000-0000-0000-000000000001';
select pg_temp.ok((select valor_total = 250 and chave is null from nfe_emissoes where id = 'ee000000-0000-0000-0000-000000000001'), 'edita o rascunho, sem mexer na chave');
select pg_temp.entrar(:LEI);
select pg_temp.ok((select count(*) = 1 from nfe_emissoes where empresa_id = :E), 'leitura consulta as notas');
update nfe_emissoes set valor_total = 1 where id = 'ee000000-0000-0000-0000-000000000001';
select pg_temp.ok((select valor_total = 250 from nfe_emissoes where id = 'ee000000-0000-0000-0000-000000000001'), 'leitura não altera');

-- retorno da SEFAZ pela função de serviço
reset role;
select nfe_registrar('ee000000-0000-0000-0000-000000000001', '{"status":"enviando"}');
select nfe_registrar('ee000000-0000-0000-0000-000000000001', '{"status":"erro","status_sefaz":"539","mensagem_sefaz":"Duplicidade","erros":["539 - Duplicidade"]}');
select pg_temp.ok((select status = 'erro' and erros = '["539 - Duplicidade"]'::jsonb and enviada_em is not null from nfe_emissoes where id = 'ee000000-0000-0000-0000-000000000001'), 'rejeição gravada com o motivo');
select pg_temp.entrar(:FIN);
update nfe_emissoes set valor_total = 300 where id = 'ee000000-0000-0000-0000-000000000001';
select pg_temp.ok((select valor_total = 300 and status = 'erro' and erros <> '[]'::jsonb from nfe_emissoes where id = 'ee000000-0000-0000-0000-000000000001'), 'nota rejeitada pode ser corrigida');
delete from nfe_emissoes where id = 'ee000000-0000-0000-0000-000000000001';
select pg_temp.ok((select count(*) = 1 from nfe_emissoes where id = 'ee000000-0000-0000-0000-000000000001'), 'nota já enviada não é excluída');
reset role;
select nfe_registrar('ee000000-0000-0000-0000-000000000001', jsonb_build_object('status', 'autorizada', 'numero', '1201', 'serie', '1', 'chave', repeat('3', 44), 'protocolo', '135260000000001', 'xml', '<nfeProc/>'));
select pg_temp.ok((select status = 'autorizada' and numero = '1201' and chave = repeat('3', 44) and erros = '[]'::jsonb and autorizada_em is not null and xml = '<nfeProc/>' from nfe_emissoes where id = 'ee000000-0000-0000-0000-000000000001'), 'autorização gravada e erros limpos');
select pg_temp.entrar(:FIN);
update nfe_emissoes set valor_total = 1 where id = 'ee000000-0000-0000-0000-000000000001';
select pg_temp.ok((select valor_total = 300 from nfe_emissoes where id = 'ee000000-0000-0000-0000-000000000001'), 'nota autorizada não é mais alterada pela tela');
reset role;
select nfe_registrar('ee000000-0000-0000-0000-000000000001', '{"carta":{"seq":1,"texto":"Correção do endereço de entrega"}}');
select nfe_registrar('ee000000-0000-0000-0000-000000000001', '{"status":"cancelada","cancel_justificativa":"Pedido cancelado pelo cliente"}');
select pg_temp.ok((select status = 'cancelada' and cancelada_em is not null and jsonb_array_length(cartas) = 1 and numero = '1201' from nfe_emissoes where id = 'ee000000-0000-0000-0000-000000000001'), 'carta de correção e cancelamento registrados');
select pg_temp.falha($q$select nfe_registrar(gen_random_uuid(), '{"status":"erro"}')$q$, 'nota inexistente');
select pg_temp.ok((select count(*) from auditoria where tabela = 'nfe_emissoes') > 0, 'auditoria gravada');
