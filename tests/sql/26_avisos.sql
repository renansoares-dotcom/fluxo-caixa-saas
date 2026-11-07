-- Avisos (SQL 090): catálogo, preferências só da própria pessoa, aviso de teste, avisos novos (prorrogação do Portal,
-- resposta do cliente na arte, borderô, OS de emergência como urgente) e quem fez a ação não é avisado.
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
grant execute on all functions in schema pg_temp to authenticated, anon;

select pg_temp.ok((select count(*) from notif_tipos) >= 9, 'catálogo dos tipos');
select pg_temp.ok((select urgente from notif_tipos where codigo = 'os_urgente'), 'máquina parada é urgente');

-- preferências: cada um só as suas
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into notif_preferencias(empresa_id, tipo, push, email) values ('e000000a-0000-0000-0000-000000000000', 'chat', false, false);
insert into notif_horarios(empresa_id, inicio, fim) values ('e000000a-0000-0000-0000-000000000000', '21:00', '06:30');
select pg_temp.falha($q$insert into notif_preferencias(user_id, empresa_id, tipo) values ('d0000000-0000-0000-0000-00000000000d', 'e000000a-0000-0000-0000-000000000000', 'arte')$q$, 'não grava a preferência de outra pessoa');
select pg_temp.falha($q$insert into notif_preferencias(empresa_id, tipo) values ('e000000b-0000-0000-0000-000000000000', 'arte')$q$, 'não grava em empresa de que não participa');
select notif_teste('e000000a-0000-0000-0000-000000000000');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'teste' and user_id = 'a0000000-0000-0000-0000-00000000000a') = 1, 'aviso de teste para si');
reset role;
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select count(*) from notif_preferencias) = 0, 'não vê as preferências dos outros');
select pg_temp.falha($q$select notif_teste('e000000b-0000-0000-0000-000000000000')$q$, 'teste só na própria empresa');
reset role;

-- OS de emergência: urgente, para admin/diretor/produção, e não para quem abriu
insert into man_equipamentos(id, empresa_id, codigo, nome) values ('ec000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'EXT-01', 'Extrusora 1');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into man_ordens(empresa_id, numero, equipamento_id, prioridade, descricao, maquina_parou)
values ('e000000a-0000-0000-0000-000000000000', 0, 'ec000000-0000-0000-0000-000000000001', 'emergencia', 'Rosca travada', true);
reset role;
select pg_temp.ok((select count(*) from notificacoes where tipo = 'os_urgente' and urgente and user_id = 'a0000000-0000-0000-0000-00000000000a') = 1, 'OS de emergência avisa o admin como urgente');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'os_urgente' and user_id = 'd0000000-0000-0000-0000-00000000000d') = 0, 'quem abriu não é avisado (e financeiro não recebe)');

-- prorrogação pedida pelo cliente no Portal → financeiro e admin
insert into auth.users(id, email) values ('ee100000-0000-0000-0000-000000000001', 'cliente.aviso@exemplo.com');
insert into favorecidos(id, empresa_id, nome) values ('ef100000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'CLIENTE AVISO');
insert into lancamentos(id, empresa_id, data, plano_id, conta_id, valor, descricao, favorecido_id)
select 'ab100000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', current_date + 5, plano_id, conta_id, 1000, 'Título aviso', 'ef100000-0000-0000-0000-000000000001'
  from lancamentos where empresa_id = 'e000000a-0000-0000-0000-000000000000' limit 1;
select set_config('request.jwt.claim.sub', 'ee100000-0000-0000-0000-000000000001', false), set_config('request.jwt.claims', '{"sub":"ee100000-0000-0000-0000-000000000001","role":"authenticated"}', false);
insert into portal_prorrogacoes(empresa_id, favorecido_id, lancamento_id, vencimento_atual, nova_data, valor, documento, motivo, solicitado_por)
values ('e000000a-0000-0000-0000-000000000000', 'ef100000-0000-0000-0000-000000000001', 'ab100000-0000-0000-0000-000000000001', current_date + 5, current_date + 20, 1000, 'NF 123', 'Fluxo apertado', 'ee100000-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'prorrogacao_nova' and user_id in ('a0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000d')) = 2, 'prorrogação avisa admin e financeiro');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'prorrogacao_nova' and user_id = 'c0000000-0000-0000-0000-00000000000c') = 0, 'leitura não recebe a prorrogação');

-- resposta do cliente na arte (comentário do portal) → admin/diretor e quem criou a arte
insert into pre_projetos(id, empresa_id, favorecido_id, nome, criado_por) values ('e3100000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'ef100000-0000-0000-0000-000000000001', 'Arte aviso', 'financeiro.a@exemplo.com');
select set_config('pre.funcao', 'on', false);
insert into pre_versoes(id, empresa_id, projeto_id, caminho, nome, hash, origem) values ('e4100000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'e3100000-0000-0000-0000-000000000001', 'x', 'a.pdf', repeat('a', 64), 'cliente');
insert into pre_comentarios(empresa_id, versao_id, texto, origem, autor) values ('e000000a-0000-0000-0000-000000000000', 'e4100000-0000-0000-0000-000000000001', 'Trocar a cor', 'cliente', 'cliente.aviso@exemplo.com');
select set_config('pre.funcao', 'off', false);
select pg_temp.ok((select count(*) from notificacoes where tipo = 'arte_comentario' and user_id = 'd0000000-0000-0000-0000-00000000000d') = 1, 'quem criou a arte recebe o comentário do cliente');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'arte_arquivo' and user_id = 'a0000000-0000-0000-0000-00000000000a') = 1, 'admin recebe o arquivo do cliente');
insert into pre_comentarios(empresa_id, versao_id, texto, interno) values ('e000000a-0000-0000-0000-000000000000', 'e4100000-0000-0000-0000-000000000001', 'nota da equipe', true);
select pg_temp.ok((select count(*) from notificacoes where tipo = 'arte_comentario' and empresa_id = 'e000000a-0000-0000-0000-000000000000') = 2, 'comentário da equipe não gera aviso');
\o
select 'avisos ok';
