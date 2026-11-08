-- LGPD e revisão de acessos (SQL 100): termo com versão, inativos avisados e suspensos, reativação, revisão periódica,
-- Portal bloqueado, dados por titular e anonimização (também na Auditoria).
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
\set E '''e000000a-0000-0000-0000-000000000000'''

-- ---------- termo de uso
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok(lgpd_entrar(:E) is null, 'sem termo publicado, nada a aceitar');
select pg_temp.falha($$select lgpd_publicar_termo('e000000a-0000-0000-0000-000000000000', 'equipe', 'T', repeat('texto ', 20))$$, 'só o administrador publica');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok(lgpd_publicar_termo(:E, 'equipe', 'Termo de uso', repeat('Texto do termo. ', 10)) = 1, 'versão 1');
select pg_temp.ok(lgpd_entrar(:E) is null, 'quem publica já aceitou');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
create temp table t1 as select lgpd_entrar('e000000a-0000-0000-0000-000000000000') j;
select pg_temp.ok((select (j ->> 'versao')::int = 1 and not (j ->> 'anterior')::boolean from t1), 'financeiro precisa aceitar a v1');
select lgpd_aceitar((select (j ->> 'id')::uuid from t1), 'teste');
select pg_temp.ok(lgpd_entrar(:E) is null, 'aceito');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select lgpd_publicar_termo(:E, 'equipe', 'Termo de uso', repeat('Texto novo do termo. ', 10));
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select (j ->> 'versao')::int = 2 and (j ->> 'anterior')::boolean from (select lgpd_entrar('e000000a-0000-0000-0000-000000000000') j) z), 'nova versão pede novo aceite');
select pg_temp.falha($$select lgpd_aceitar((select id from lgpd_termos where empresa_id = 'e000000a-0000-0000-0000-000000000000' and publico = 'equipe' and versao = 1))$$, 'não aceita versão antiga');
reset role;
create temp table v2 as select id from lgpd_termos where empresa_id = :E and publico = 'equipe' and versao = 2;
grant select on v2 to authenticated;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select lgpd_aceitar((select id from v2), 'x')$$, 'quem não é da empresa não aceita');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select jsonb_array_length(j #> '{equipe,pessoas}') >= 4 and (select count(*) from jsonb_array_elements(j #> '{equipe,pessoas}') p where p ->> 'aceito_em' is not null) = 1
  from (select lgpd_termos_situacao('e000000a-0000-0000-0000-000000000000') j) z), 'situação: só o administrador aceitou a v2');
reset role;

-- (o agendamento roda sem usuário)
select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false);
-- ---------- inativos: compras (f) entrou há 55 dias = aviso; leitura (c) há 70 = suspenso; admin nunca
update membros set created_at = now() - interval '200 days' where empresa_id = :E;
insert into membros_acessos(empresa_id, user_id, ultimo_acesso) values
  (:E, 'f0000000-0000-0000-0000-00000000000f', now() - interval '55 days'),
  (:E, 'c0000000-0000-0000-0000-00000000000c', now() - interval '70 days'),
  (:E, 'a0000000-0000-0000-0000-00000000000a', now() - interval '300 days'),
  (:E, 'd0000000-0000-0000-0000-00000000000d', now())
  on conflict (empresa_id, user_id) do update set ultimo_acesso = excluded.ultimo_acesso, avisado_em = null;
delete from uso_eventos where empresa_id = :E;
insert into portal_usuarios(empresa_id, user_id, favorecido_id, email, criado_em)
  select :E, 'c0000000-0000-0000-0000-00000000000c', id, 'cliente.portal@exemplo.com', now() - interval '100 days' from favorecidos where empresa_id = :E limit 1;
select pg_temp.ok(public._lgpd_revisar_inativos() >= 3, 'revisão automática');
select pg_temp.ok(not exists (select 1 from membros where empresa_id = :E and user_id = 'c0000000-0000-0000-0000-00000000000c'), 'leitura suspenso');
select pg_temp.ok((select papel = 'leitura' and automatico from acessos_suspensos where user_id = 'c0000000-0000-0000-0000-00000000000c' and reativado_em is null), 'suspensão guarda o papel');
select pg_temp.ok(exists (select 1 from membros where empresa_id = :E and user_id = 'f0000000-0000-0000-0000-00000000000f'), 'compras ainda tem acesso');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'lgpd' and user_id = 'f0000000-0000-0000-0000-00000000000f') = 1, 'compras avisado');
select pg_temp.ok(exists (select 1 from membros where empresa_id = :E and user_id = 'a0000000-0000-0000-0000-00000000000a'), 'administrador nunca é suspenso (padrão)');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'lgpd' and user_id = 'a0000000-0000-0000-0000-00000000000a' and corpo like '%Portal%') = 1, 'administrador recebe o resumo');
select pg_temp.ok(not (select ativo from portal_usuarios where email = 'cliente.portal@exemplo.com'), 'Portal sem uso bloqueado');
select public._lgpd_revisar_inativos();
select pg_temp.ok((select count(*) from notificacoes where tipo = 'lgpd' and user_id = 'f0000000-0000-0000-0000-00000000000f') = 1, 'não avisa duas vezes');

-- ---------- tela: situação, suspender, reativar, revisão
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$select acessos_situacao('e000000a-0000-0000-0000-000000000000')$$, 'só administrador vê os acessos');
select pg_temp.ok((select count(*) from acessos_suspensos) = 0, 'financeiro não lê suspensos');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select (x ->> 'dias')::int between 54 and 56 and x ->> 'avisado_em' is not null from jsonb_array_elements(acessos_situacao(:E) -> 'membros') x where x ->> 'user_id' = 'f0000000-0000-0000-0000-00000000000f'), 'situação mostra dias e aviso');
select pg_temp.falha($$select acesso_suspender('e000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-00000000000a', 'teste')$$, 'não suspende a si mesmo');
select acesso_reativar((select id from acessos_suspensos where user_id = 'c0000000-0000-0000-0000-00000000000c' and reativado_em is null));
select pg_temp.ok((select papel::text from membros where empresa_id = :E and user_id = 'c0000000-0000-0000-0000-00000000000c') = 'leitura', 'reativado com o papel');
select acessos_revisar(:E, jsonb_build_array(
  jsonb_build_object('user_id', 'c0000000-0000-0000-0000-00000000000c', 'decisao', 'suspender', 'motivo', 'Saiu da empresa'),
  jsonb_build_object('user_id', 'd0000000-0000-0000-0000-00000000000d', 'decisao', 'manter'),
  jsonb_build_object('user_id', 'a0000000-0000-0000-0000-00000000000a', 'decisao', 'suspender')), 'revisão semestral');
select pg_temp.ok((select mantidos = 2 and suspensos = 1 from acessos_revisoes where empresa_id = :E order by revisado_em desc limit 1), 'revisão: 2 mantidos (o próprio admin sempre), 1 suspenso');
select pg_temp.ok((acessos_situacao(:E) ->> 'proxima_revisao')::date > current_date + 150, 'próxima revisão em 6 meses');
select acesso_reativar((select id from acessos_suspensos where user_id = 'c0000000-0000-0000-0000-00000000000c' and reativado_em is null));

-- ---------- titular: busca e anonimização
reset role;
insert into rh_colaboradores(id, empresa_id, nome, cpf, situacao) values ('c0360000-0000-0000-0000-000000000001', :E, 'JOANA TITULAR', '12345678909', 'ativo');
insert into favorecidos(id, empresa_id, tipo, nome, documento, tipo_pessoa, email, pix) values ('fa360000-0000-0000-0000-000000000001', :E, 'CLIENTES', 'JOANA TITULAR', '123.456.789-09', 'PF', 'joana@exemplo.com', 'joana@exemplo.com');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
update favorecidos set telefone = '81999990000' where id = 'fa360000-0000-0000-0000-000000000001';
select pg_temp.ok((select count(*) from jsonb_array_elements(lgpd_dados_titular(:E, '123.456.789-09')) x where x ->> 'origem' in ('favorecido', 'colaborador')) = 2, 'CPF encontra beneficiário e colaborador');
select pg_temp.ok(jsonb_array_length(lgpd_dados_titular(:E, 'joana@exemplo')) >= 1, 'busca por e-mail');
select pg_temp.falha($$select lgpd_dados_titular('e000000a-0000-0000-0000-000000000000', 'jo')$$, 'busca curta');
select pg_temp.falha($$select lgpd_anonimizar('e000000a-0000-0000-0000-000000000000', 'colaborador', 'c0360000-0000-0000-0000-000000000001')$$, 'colaborador ativo não é anonimizado');
insert into lgpd_solicitacoes(id, empresa_id, titular_nome, tipo) values ('5a360000-0000-0000-0000-000000000001', :E, 'JOANA TITULAR', 'anonimizacao');
select pg_temp.ok((select prazo = current_date + 15 from lgpd_solicitacoes where id = '5a360000-0000-0000-0000-000000000001'), 'prazo de 15 dias');
select pg_temp.ok(lgpd_anonimizar(:E, 'favorecido', 'fa360000-0000-0000-0000-000000000001', '5a360000-0000-0000-0000-000000000001') like 'TITULAR ANONIMIZADO%', 'anonimizado');
reset role;
select pg_temp.ok((select documento is null and email is null and pix is null and not ativo from favorecidos where id = 'fa360000-0000-0000-0000-000000000001'), 'dados apagados');
select pg_temp.ok(not exists (select 1 from auditoria where registro_id = 'fa360000-0000-0000-0000-000000000001' and (coalesce(antes, '{}')::text || coalesce(depois, '{}')::text) ~ '(JOANA|joana@|12345678909|81999990000)'), 'Auditoria sem os dados pessoais');
select pg_temp.ok((select jsonb_array_length(registros) = 1 from lgpd_solicitacoes where id = '5a360000-0000-0000-0000-000000000001'), 'solicitação registra o que foi anonimizado');
update rh_colaboradores set situacao = 'desligado' where id = 'c0360000-0000-0000-0000-000000000001';
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select lgpd_anonimizar(:E, 'colaborador', 'c0360000-0000-0000-0000-000000000001');
select pg_temp.ok(jsonb_array_length(lgpd_dados_titular(:E, '12345678909')) = 0, 'CPF não é mais encontrado');
update lgpd_solicitacoes set status = 'atendida', resposta = 'Dados anonimizados' where id = '5a360000-0000-0000-0000-000000000001';
reset role;
select pg_temp.ok((select atendida_em is not null from lgpd_solicitacoes where id = '5a360000-0000-0000-0000-000000000001'), 'atendida com data');

-- limpeza
delete from lgpd_solicitacoes; delete from rh_colaboradores where id = 'c0360000-0000-0000-0000-000000000001';
delete from portal_usuarios where email = 'cliente.portal@exemplo.com';
delete from lgpd_termos; delete from membros_acessos; delete from acessos_suspensos; delete from acessos_revisoes;
