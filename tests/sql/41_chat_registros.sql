-- Conversa ligada ao registro (SQL 105): os novos tipos abrem conversa só para quem vê o registro.
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

insert into favorecidos(id, empresa_id, nome, tipo, documento) values ('fa000105-0000-0000-0000-000000000000', 'e000000a-0000-0000-0000-000000000000', 'Cliente Fictício Ltda', 'CLIENTES', '11.111.111/0001-11');
insert into contratos(id, empresa_id, numero, objeto, parte_nome, inicio) values ('c0000105-0000-0000-0000-000000000000', 'e000000a-0000-0000-0000-000000000000', 901, 'Locação de empilhadeira', 'Locadora Exemplo', '2026-01-01');
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, emit_nome, v_nf) values ('a0000105-0000-0000-0000-000000000000', 'e000000a-0000-0000-0000-000000000000', repeat('1', 44), 4521, '2026-11-03', 'entrada', false, 'Fornecedor Exemplo', 1500);
insert into qual_rnc(id, empresa_id, numero, descricao, gravidade) values ('b0000105-0000-0000-0000-000000000000', 'e000000a-0000-0000-0000-000000000000', 77, 'Bobina com risco na impressão', 'media');

-- as informações do cartão
select pg_temp.ok((_chat_registro_info('favorecido', 'fa000105-0000-0000-0000-000000000000')).titulo = 'Beneficiário · Cliente Fictício Ltda', 'título do beneficiário');
select pg_temp.ok((_chat_registro_info('nfe_nota', 'a0000105-0000-0000-0000-000000000000')).titulo = 'NF-e nº 4521 · Fornecedor Exemplo', 'título da nota');
select pg_temp.ok((_chat_registro_info('qual_rnc', 'b0000105-0000-0000-0000-000000000000')).link like '#/qualidade/nao-conformidades?abrir=%', 'link da RNC abre a ficha');
select pg_temp.ok((_chat_registro_info('contrato', 'c0000105-0000-0000-0000-000000000000')).titulo like 'Contrato nº 901 · Locadora Exemplo', 'título do contrato');

-- administrador abre conversa de todos
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select chat_registro('contrato', 'c0000105-0000-0000-0000-000000000000') as r_ct \gset
select pg_temp.ok(chat_registro('contrato', 'c0000105-0000-0000-0000-000000000000') = :'r_ct', 'uma conversa por contrato');
select pg_temp.ok(chat_registro('qual_rnc', 'b0000105-0000-0000-0000-000000000000') is not null, 'admin abre a da RNC');

-- financeiro: vê a nota e o beneficiário, não o contrato (só administrador)
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok(chat_registro('nfe_nota', 'a0000105-0000-0000-0000-000000000000') is not null, 'financeiro abre a da nota');
select pg_temp.ok(chat_registro('favorecido', 'fa000105-0000-0000-0000-000000000000') is not null, 'financeiro abre a do beneficiário');
select pg_temp.falha($$select chat_registro('contrato', 'c0000105-0000-0000-0000-000000000000')$$, 'financeiro não entra na conversa do contrato');

-- compras (participante): vê a RNC, não a nota fiscal
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.ok(chat_registro('qual_rnc', 'b0000105-0000-0000-0000-000000000000') is not null, 'participante abre a da RNC');
select pg_temp.falha($$select chat_registro('nfe_nota', 'a0000105-0000-0000-0000-000000000000')$$, 'compras não entra na conversa da nota');

-- outra empresa não entra em nenhuma
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select chat_registro('qual_rnc', 'b0000105-0000-0000-0000-000000000000')$$, 'outra empresa não entra');
select pg_temp.falha($$select chat_registro('tipo_inventado', 'b0000105-0000-0000-0000-000000000000')$$, 'tipo desconhecido é recusado');

reset role;
delete from chat_conversas where registro_id in ('c0000105-0000-0000-0000-000000000000', 'b0000105-0000-0000-0000-000000000000', 'a0000105-0000-0000-0000-000000000000', 'fa000105-0000-0000-0000-000000000000');
delete from qual_rnc where id = 'b0000105-0000-0000-0000-000000000000';
delete from nfe_notas where id = 'a0000105-0000-0000-0000-000000000000';
delete from contratos where id = 'c0000105-0000-0000-0000-000000000000';
delete from favorecidos where id = 'fa000105-0000-0000-0000-000000000000';
\o
select 'ok 41 conversa ligada ao registro';
