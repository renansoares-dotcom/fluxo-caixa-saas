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
-- Receita Federal — CBS (SQL 169): tabelas só de leitura para a empresa, DARF do RAD registrado pela função e confirmação do recolhimento
update rad_config set plano_darf_id = 'f000000a-0000-0000-0000-000000000000' where empresa_id = :E;
create temp table rr as select id, chave from rad_recolhimentos where empresa_id = :E and situacao = 'marcado' limit 1;
grant select on rr to authenticated;
select pg_temp.ok((select count(*) = 1 from rr), 'há uma nota marcada (teste a1)');
-- a função (service_role) registra uma recusa: nada muda além do código
select pg_temp.ok((public.rad_darf_registrar((select id from rr), 'd0000000-0000-0000-0000-00000000000d', '{"cdRetorno":"DFE_NAO_ENCONTRADO","mensagem":"Documento não encontrado"}'::jsonb) ->> 'ok')::boolean = false, 'recusa registrada');
select pg_temp.ok((select situacao = 'marcado' and darf_retorno = 'DFE_NAO_ENCONTRADO' and lancamento_id is null from rad_recolhimentos where id = (select id from rr)), 'recusa não muda a situação');
-- DARF gerado: grava os dados e cria o título a pagar na conta dos parâmetros
create temp table d1 as select public.rad_darf_registrar((select id from rr), 'd0000000-0000-0000-0000-00000000000d',
  '{"cdRetorno":"DARF_GERADO","opcaoPagamento":"PAGAMENTO_TOTAL","darf":{"chavePIX":"pix-123","codigoBarras":"8587000000151234","linkDarfPDF":"https://api.receitafederal.gov.br/darf/x"},"informacoesPagamento":{"dataMaximaPagamento":"2026-11-30","valorDarfPrincipal":88.5,"valorDarfTotal":88.5}}'::jsonb) r;
select pg_temp.ok((select situacao = 'darf_gerado' and darf_chave_pix = 'pix-123' and darf_valor_total = 88.5 and darf_data_maxima = '2026-11-30' and darf_gerado_por = 'd0000000-0000-0000-0000-00000000000d' and darf_mensagem is null from rad_recolhimentos where id = (select id from rr)), 'DARF gravado');
select pg_temp.ok((select l.valor = 88.5 and l.status = 'Em aberto' and l.data = '2026-11-30' and l.origem = 'rad' and l.plano_id = 'f000000a-0000-0000-0000-000000000000' from lancamentos l where l.id = (select (r ->> 'lancamento_id')::uuid from d1)), 'título do DARF criado');
-- gerar de novo (valor parcial) atualiza o mesmo título, sem criar outro
select public.rad_darf_registrar((select id from rr), 'd0000000-0000-0000-0000-00000000000d', '{"cdRetorno":"DARF_GERADO","opcaoPagamento":"PAGAMENTO_PARCIAL","darf":{"chavePIX":"pix-456","codigoBarras":"1","linkDarfPDF":"x"},"informacoesPagamento":{"dataMaximaPagamento":"2026-12-05","valorDarfPrincipal":50,"valorDarfTotal":50}}'::jsonb);
select pg_temp.ok((select count(*) = 1 and bool_and(valor = 50 and data = '2026-12-05') from lancamentos where empresa_id = :E and origem = 'rad'), 'título atualizado, não duplicado');
-- o líquido sugerido passa a usar o valor do DARF (4.000 − 50)
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select liquido_sugerido = 3950 and valor_cbs = 50 from public.rad_titulos(:E)), 'líquido sugerido pelo valor do DARF');
-- nota com DARF gerado não é desmarcada pela tela; ninguém da empresa grava nas tabelas da Receita nem chama as funções do serviço
select pg_temp.falha($$select public.rad_desmarcar((select id from rr))$$, 'desmarcar com DARF gerado');
select pg_temp.falha($$insert into rfb_cbs_solicitacoes(empresa_id, api) values ('e000000a-0000-0000-0000-000000000000', 'creditos')$$, 'usuário não grava solicitação');
select pg_temp.falha($$insert into rfb_cbs_creditos(empresa_id, chave, pa) values ('e000000a-0000-0000-0000-000000000000', 'x', '11/2026')$$, 'usuário não grava crédito');
select pg_temp.falha($$select public.rad_darf_registrar((select id from rr), auth.uid(), '{"cdRetorno":"DARF_GERADO"}'::jsonb)$$, 'usuário não registra DARF');
select pg_temp.ok(public.rfb_pode(:E), 'financeiro pode pedir consulta');
reset role;
-- a Receita confirma o recolhimento da chave: a nota passa a "recolhido"
insert into rfb_cbs_solicitacoes(id, empresa_id, api, tiquete, situacao) values ('a2000000-0000-0000-0000-000000000001', :E, 'recolhimentos', 'tq-1', 'CONCLUIDA');
insert into rfb_cbs_recolhimentos(empresa_id, numero_darf, sequencial, tipo, data_arrecadacao, pa, chave, principal, total, solicitacao_id)
  select :E, '07162611800000001', 1, 1, '2026-11-28', '11/2026', chave, 50, 50, 'a2000000-0000-0000-0000-000000000001' from rr;
insert into rfb_cbs_creditos(empresa_id, chave, pa, origem, documento, apurado, a_apropriar, apropriado, saldo_credor) select :E, chave, '11/2026', 0, 55, 90, 40, 50, 50 from rr;
select pg_temp.ok(public.rad_confirmar_recolhidos(:E) = 1, 'uma nota confirmada');
select pg_temp.ok((select situacao = 'recolhido' and recolhido_em = '2026-11-28' and numero_darf = '07162611800000001' from rad_recolhimentos where id = (select id from rr)), 'recolhido com data e DARF');
select pg_temp.ok(public.rad_confirmar_recolhidos(:E) = 0, 'confirmar de novo não muda nada');
-- leitura vê; outra empresa não vê
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) = 1 from rfb_cbs_creditos) and (select count(*) = 1 from rfb_cbs_recolhimentos) and not public.rfb_pode(:E), 'leitura vê e não pede consulta');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) = 0 from rfb_cbs_creditos) and (select count(*) = 0 from rfb_cbs_solicitacoes), 'isolamento entre empresas');
reset role;
