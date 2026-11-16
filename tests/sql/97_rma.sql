-- RMA da recuperação judicial (SQL 162): ativação por empresa, lista padrão, pacote do mês, arquivos, envio, reabertura e travas.
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
\set E '''e000000a-0000-0000-0000-000000000000'''
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set M '''2026-10-01'''

-- ---------- ativação e permissões ----------
select pg_temp.entrar(:FIN);
select pg_temp.falha($q$insert into rma_config(empresa_id, ativo) values ('e000000a-0000-0000-0000-000000000000', true)$q$, 'só o administrador ativa');
select pg_temp.falha($q$select rma_abrir_mes('e000000a-0000-0000-0000-000000000000', '2026-10-01')$q$, 'sem ativar não abre mês');
select pg_temp.falha($q$select rma_documentos_padrao('e000000a-0000-0000-0000-000000000000')$q$, 'só o administrador cria a lista');
select pg_temp.entrar(:ADM);
insert into rma_config(empresa_id, ativo, sigla, mes_inicio, dia_entrega) values (:E, false, 'EXEMPLO', '2026-04-01', 15);
select pg_temp.falha($q$select rma_abrir_mes('e000000a-0000-0000-0000-000000000000', '2026-10-01')$q$, 'desligado não abre mês');
update rma_config set ativo = true where empresa_id = :E;
select pg_temp.ok(rma_documentos_padrao(:E) = 14, 'lista padrão com os 14 documentos pedidos');
select pg_temp.ok(rma_documentos_padrao(:E) = 0, 'lista padrão não duplica');
select pg_temp.falha($q$update rma_documentos set formatos = array['doc'] where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = '01'$q$, 'formato fora de pdf e xlsx');
select pg_temp.entrar(:CMP);
select pg_temp.ok(not rma_pode(:E) and (select ativo from rma_config where empresa_id = :E), 'compras não opera, mas enxerga que o módulo está ligado');
select pg_temp.ok((select count(*) = 0 from rma_documentos where empresa_id = :E), 'compras não vê os documentos');
select pg_temp.entrar(:LEI);
select pg_temp.ok(not rma_pode(:E) and (select count(*) = 14 from rma_documentos where empresa_id = :E), 'leitura consulta');

-- ---------- pacote do mês ----------
select pg_temp.entrar(:FIN);
select pg_temp.falha($q$select rma_abrir_mes('e000000a-0000-0000-0000-000000000000', '2026-03-01')$q$, 'antes do primeiro mês');
select pg_temp.falha($q$select rma_abrir_mes('e000000a-0000-0000-0000-000000000000', (date_trunc('month', current_date) + interval '1 month')::date)$q$, 'mês futuro');
select pg_temp.ok(rma_abrir_mes(:E, '2026-10-17') = 14, 'abre o mês com uma entrega por documento');
select pg_temp.ok((select prazo = '2026-11-15' and status = 'aberto' from rma_meses where empresa_id = :E and mes = :M), 'prazo no dia configurado do mês seguinte');
select pg_temp.ok(rma_abrir_mes(:E, :M) = 0, 'abrir de novo não duplica');
select id as "E04" from rma_entregas e where e.empresa_id = :E and e.mes = :M and e.documento_id = (select id from rma_documentos where empresa_id = :E and codigo = '04') \gset
select pg_temp.falha(format($q$update rma_entregas set status = 'pronto' where id = %L$q$, :'E04'), 'pronto exige arquivo');
insert into rma_arquivos(empresa_id, entrega_id, nome, caminho, origem) values (:E, :'E04', 'EXEMPLO_RMA_2026-10_04_Fluxo_de_Caixa.pdf', 'e000000a-0000-0000-0000-000000000000/2026-10/x.pdf', 'gerado');
select pg_temp.ok((select status = 'pronto' from rma_entregas where id = :'E04'), 'arquivo incluído deixa a entrega pronta');
delete from rma_arquivos where entrega_id = :'E04';
select pg_temp.ok((select status = 'pendente' from rma_entregas where id = :'E04'), 'sem arquivo volta a pendente');
select pg_temp.falha(format($q$update rma_entregas set status = 'nao_aplica' where id = %L$q$, :'E04'), 'não se aplica exige justificativa');
select pg_temp.falha($q$select rma_enviar('e000000a-0000-0000-0000-000000000000', '2026-10-01')$q$, 'envio com pendência');

-- ---------- envio, trava e reabertura ----------
insert into rma_arquivos(empresa_id, entrega_id, nome, caminho) select :E, e.id, 'arquivo.pdf', 'e000000a-0000-0000-0000-000000000000/2026-10/' || e.id || '.pdf' from rma_entregas e join rma_documentos d on d.id = e.documento_id where e.empresa_id = :E and e.mes = :M and d.codigo not in ('03', '14');
update rma_entregas set status = 'nao_aplica', justificativa = 'Sem balanço encerrado no mês.' where empresa_id = :E and mes = :M and documento_id = (select id from rma_documentos where empresa_id = :E and codigo = '03');
update rma_documentos set obrigatorio = false where empresa_id = :E and codigo = '14';
select rma_enviar(:E, :M, 'PROT-2026-10', 'Mês sem ocorrências relevantes.');
select pg_temp.ok((select status = 'enviado' and protocolo = 'PROT-2026-10' and enviado_por = 'd0000000-0000-0000-0000-00000000000d' from rma_meses where empresa_id = :E and mes = :M), 'envio registrado com protocolo (não obrigatório pendente não impede)');
select pg_temp.falha(format($q$update rma_entregas set observacao = 'x' where id = %L$q$, :'E04'), 'mês enviado trava as entregas');
select pg_temp.falha(format($q$insert into rma_arquivos(empresa_id, entrega_id, nome, caminho) values ('e000000a-0000-0000-0000-000000000000', %L, 'a', 'b')$q$, :'E04'), 'mês enviado trava os arquivos');
select pg_temp.falha($q$select rma_enviar('e000000a-0000-0000-0000-000000000000', '2026-10-01')$q$, 'não envia duas vezes');
select pg_temp.falha($q$select rma_reabrir('e000000a-0000-0000-0000-000000000000', '2026-10-01', ' ')$q$, 'reabrir exige motivo');
select pg_temp.entrar(:LEI);
select pg_temp.falha($q$select rma_reabrir('e000000a-0000-0000-0000-000000000000', '2026-10-01', 'teste')$q$, 'leitura não reabre');
select pg_temp.entrar(:FIN);
select rma_reabrir(:E, :M, 'Substituir o extrato do banco.');
select pg_temp.ok((select status = 'aberto' and comentario like '%Reaberto em%Substituir o extrato%' from rma_meses where empresa_id = :E and mes = :M), 'reabertura registrada no comentário');
update rma_entregas set observacao = 'ok' where id = :'E04';
reset role;
select pg_temp.ok((select count(*) >= 1 from notificacoes where tipo = 'rma' and user_id = 'a0000000-0000-0000-0000-00000000000a'), 'envio avisa a equipe');
select pg_temp.ok((select count(*) from auditoria where tabela = 'rma_entregas') > 0, 'auditoria gravada');

-- ---------- RMA automático (SQL 163) ----------
select pg_temp.ok((select auto_extrato and auto_relatorios and contas_fora = '{}' from rma_config where empresa_id = :E), 'automático ligado por padrão');
select pg_temp.ok((select fonte = 'extrato_conta' and tela = 'fechamento' from rma_documentos where empresa_id = :E and codigo = '06'), 'extratos passam a sair do fechamento do banco');
select pg_temp.ok((select fonte = 'anexo' from rma_documentos where empresa_id = :E and codigo = '05'), 'lista padrão traz o 05 (conciliações)');
select pg_temp.entrar(:FIN);
select id as "E06" from rma_entregas e where e.empresa_id = :E and e.mes = :M and e.documento_id = (select id from rma_documentos where empresa_id = :E and codigo = '06') \gset
insert into rma_arquivos(empresa_id, entrega_id, nome, caminho, origem, conta_id) values (:E, :'E06', 'EXEMPLO_RMA_2026-10_06_Extrato_BANCO.pdf', 'e000000a-0000-0000-0000-000000000000/2026-10/ext.pdf', 'gerado', 'c000000a-0000-0000-0000-000000000000');
select pg_temp.ok((select count(*) = 1 from rma_arquivos where entrega_id = :'E06' and conta_id is not null), 'arquivo do extrato ligado à conta');
select pg_temp.falha($q$update rma_documentos set fonte = 'outra' where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = '06'$q$, 'origem inválida');
reset role;

-- ---------- diário de comentários por documento (SQL 164) ----------
select pg_temp.entrar(:FIN);
insert into rma_comentarios(empresa_id, entrega_id, texto, por, por_nome) values (:E, :'E06', '  Extrato do Bradesco conferido com o banco.  ', 'a0000000-0000-0000-0000-00000000000a', 'outro nome');
insert into rma_comentarios(empresa_id, entrega_id, texto) values (:E, :'E06', 'Escritório pediu o extrato emitido pelo banco.');
select pg_temp.ok((select count(*) = 2 and bool_and(por = 'd0000000-0000-0000-0000-00000000000d') and min(texto) = 'Escritório pediu o extrato emitido pelo banco.' from rma_comentarios where entrega_id = :'E06'), 'vários comentários por documento; o autor é quem está logado');
select pg_temp.ok((select por_nome is not distinct from (select nome from membros where empresa_id = :E and user_id = 'd0000000-0000-0000-0000-00000000000d') from rma_comentarios where entrega_id = :'E06' limit 1), 'nome do autor vem do cadastro');
select pg_temp.falha(format($q$insert into rma_comentarios(empresa_id, entrega_id, texto) values ('e000000a-0000-0000-0000-000000000000', %L, '   ')$q$, :'E06'), 'comentário vazio');
update rma_comentarios set texto = 'x' where entrega_id = :'E06';
select pg_temp.ok((select count(*) = 0 from rma_comentarios where texto = 'x'), 'comentário não é editado');
select rma_enviar(:E, :M);
insert into rma_comentarios(empresa_id, entrega_id, texto) values (:E, :'E06', 'Devolvido para correção em 20/11.');
select pg_temp.ok((select count(*) = 3 from rma_comentarios where entrega_id = :'E06'), 'o diário continua aberto depois do envio do mês');
select pg_temp.entrar(:LEI);
select pg_temp.ok((select count(*) = 3 from rma_comentarios where entrega_id = :'E06'), 'leitura lê o diário');
select pg_temp.falha(format($q$insert into rma_comentarios(empresa_id, entrega_id, texto) values ('e000000a-0000-0000-0000-000000000000', %L, 'x')$q$, :'E06'), 'leitura não comenta');
select pg_temp.entrar(:ADM);
delete from rma_comentarios where entrega_id = :'E06' and texto like 'Devolvido%';
select pg_temp.ok((select count(*) = 2 from rma_comentarios where entrega_id = :'E06'), 'administrador apaga comentário');
reset role;
