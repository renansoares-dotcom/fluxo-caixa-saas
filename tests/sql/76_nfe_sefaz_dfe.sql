-- NF-e da SEFAZ (SQL 140): registro da distribuição (resumo, XML, cancelamento), NSU e intervalo de 1 hora, ciência,
-- manifestação, marcação pela importação, ignorar, resumo e permissões.
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
update empresas set cnpj = '11.222.333/0001-81', uf = 'PE' where id = :E;
select pg_temp.ok(public._uf_codigo('pe') = 26 and public._uf_codigo('SP') = 35 and public._uf_codigo('XX') is null, 'código da UF');
-- configuração: só admin
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$insert into dfe_config(empresa_id, ativo) values ('e000000a-0000-0000-0000-000000000000', true)$$, 'financeiro não liga');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into dfe_config(empresa_id, ativo, ambiente) values (:E, true, 'homologacao');
reset role;
select pg_temp.ok((select cnpj = '11222333000181' and cuf = 26 and ultimo_nsu = 0 from public.dfe_para_consultar() where empresa_id = :E), 'para consultar');
-- primeira consulta: um resumo, um XML completo e um cancelamento de outra nota; ainda há NSU
select public.dfe_registrar(:E, '{"cStat":"138","xMotivo":"Documento localizado","ultNSU":"3","maxNSU":"9","validade_certificado":"2027-05-01T00:00:00Z","docs":[
 {"nsu":"1","schema":"resNFe","xml":"<resNFe xmlns=\"http://www.portalfiscal.inf.br/nfe\" versao=\"1.01\"><chNFe>26261199888777000166550010000001111000001115</chNFe><CNPJ>99888777000166</CNPJ><xNome>RESINAS DO BRASIL</xNome><IE>1</IE><dhEmi>2026-11-05T10:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>87570.00</vNF><digVal>x</digVal><dhRecbto>x</dhRecbto><nProt>1</nProt><cSitNFe>1</cSitNFe></resNFe>"},
 {"nsu":"2","schema":"procNFe","xml":"<nfeProc xmlns=\"http://www.portalfiscal.inf.br/nfe\" versao=\"4.00\"><NFe><infNFe Id=\"NFe26261155444333000122550010000002221000002229\" versao=\"4.00\"><ide><dhEmi>2026-11-06T09:00:00-03:00</dhEmi></ide><emit><CNPJ>55444333000122</CNPJ><xNome>COLOR MASTER</xNome></emit><total><ICMSTot><vNF>8400.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>"},
 {"nsu":"3","schema":"resEvento","xml":"<resEvento xmlns=\"http://www.portalfiscal.inf.br/nfe\"><chNFe>26261177666555000144550010000003331000003330</chNFe><tpEvento>110111</tpEvento></resEvento>"}]}');
select pg_temp.ok((select count(*) = 2 from dfe_documentos where empresa_id = :E), '2 documentos');
select pg_temp.ok((select situacao = 'resumo' and emitente_nome = 'RESINAS DO BRASIL' and valor = 87570 and emissao = '2026-11-05' from dfe_documentos where chave like '26261199888%'), 'resumo lido');
select pg_temp.ok((select situacao = 'xml_disponivel' and emitente_doc = '55444333000122' and valor = 8400 and xml like '<nfeProc%' from dfe_documentos where chave = '26261155444333000122550010000002221000002229'), 'XML completo');
select pg_temp.ok((select ultimo_nsu = 3 and max_nsu = 9 and proxima_consulta <= now() and validade_certificado = '2027-05-01T00:00:00Z' from dfe_config where empresa_id = :E), 'ainda há NSU: consulta já');
select pg_temp.ok((select count(*) >= 1 from notificacoes where tipo = 'dfe_novas' and titulo like 'NF-e da SEFAZ: 2%'), 'avisou');
-- ciência automática do resumo
select pg_temp.ok((select count(*) = 1 from public.dfe_para_ciencia(:E)), 'um resumo para a ciência');
select public.dfe_manifestado(id, 'ciencia', '135', 'Evento registrado') from dfe_documentos where chave like '26261199888%';
select pg_temp.ok((select manifestacao = 'ciencia' from dfe_documentos where chave like '26261199888%') and (select count(*) = 0 from public.dfe_para_ciencia(:E)), 'ciência registrada');
-- segunda consulta: chega o XML do resumo; sem mais NSU → próxima em 1 hora
select public.dfe_registrar(:E, '{"cStat":"138","ultNSU":"9","maxNSU":"9","docs":[{"nsu":"9","schema":"procNFe","xml":"<nfeProc xmlns=\"http://www.portalfiscal.inf.br/nfe\"><NFe><infNFe Id=\"NFe26261199888777000166550010000001111000001115\"><ide><dhEmi>2026-11-05T10:00:00-03:00</dhEmi></ide><emit><CNPJ>99888777000166</CNPJ><xNome>RESINAS DO BRASIL</xNome></emit><total><ICMSTot><vNF>87570.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>"}]}');
select pg_temp.ok((select situacao = 'xml_disponivel' and manifestacao = 'ciencia' from dfe_documentos where chave like '26261199888%'), 'XML chegou depois da ciência');
select pg_temp.ok((select ultimo_nsu = 9 and proxima_consulta > now() + interval '50 minutes' from dfe_config where empresa_id = :E), 'em dia: 1 hora');
select pg_temp.ok((select count(*) = 0 from public.dfe_para_consultar() where empresa_id = :E), 'fora da fila até a próxima hora');
select pg_temp.ok((select count(*) = 1 from public.dfe_para_consultar(:E)), 'forçado pela empresa');
-- erro da SEFAZ fica registrado
select public.dfe_registrar(:E, '{"cStat":"656","xMotivo":"Consumo indevido"}');
select pg_temp.ok((select ultimo_erro = 'Consumo indevido' and ultimo_nsu = 9 from dfe_config where empresa_id = :E), 'erro registrado, NSU mantido');
-- manifestação recusada
select public.dfe_manifestado(id, 'confirmacao', '596', 'Rejeição: prazo') from dfe_documentos where chave = '26261155444333000122550010000002221000002229';
select pg_temp.ok((select manifestacao is null and manifestacao_erro like '596:%' from dfe_documentos where chave = '26261155444333000122550010000002221000002229'), 'rejeição registrada');
-- importar em Notas Fiscais marca o documento
insert into nfe_notas(empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao) values (:E, '26261199888777000166550010000001111000001115', 111, '2026-11-05', 'entrada', false, 'autorizada');
select pg_temp.ok((select situacao = 'importada' and nota_id is not null from dfe_documentos where chave like '26261199888%'), 'importada pela nota');
-- tela: resumo, ignorar; leitura não vê
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');   -- compras
select pg_temp.ok((select (public.dfe_resumo(:E) ->> 'xml')::int = 1 and (public.dfe_resumo(:E) ->> 'importadas')::int = 1), 'resumo');
select public.dfe_ignorar(id, true) from dfe_documentos where chave = '26261155444333000122550010000002221000002229';
select pg_temp.ok((select situacao = 'ignorada' from dfe_documentos where chave = '26261155444333000122550010000002221000002229'), 'ignorada');
select public.dfe_ignorar(id, false) from dfe_documentos where chave = '26261155444333000122550010000002221000002229';
select pg_temp.ok((select situacao = 'xml_disponivel' from dfe_documentos where chave = '26261155444333000122550010000002221000002229'), 'voltou');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) = 0 from dfe_documentos) and public.dfe_resumo(:E) is null, 'leitura não vê');
reset role;
\o
select 'ok 76 nf-e da sefaz';
