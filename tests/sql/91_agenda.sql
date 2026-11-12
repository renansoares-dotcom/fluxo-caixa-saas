-- Agenda única (SQL 155): compromissos próprios, visibilidade do privado, permissões, avisos, ocorrências (feito, adiar, cancelar,
-- reabrir) com e sem repetição, encerrar a repetição e parâmetros.
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

-- parâmetros: só administrador ou diretor
select pg_temp.entrar(:FIN);
select pg_temp.falha($q$insert into agenda_config(empresa_id) values ('e000000a-0000-0000-0000-000000000000')$q$, 'financeiro não grava os parâmetros da agenda');
select pg_temp.entrar(:ADM);
insert into agenda_config(empresa_id, semana_inicio, fontes_desligadas) values (:E, 1, '{ferias}');
select pg_temp.entrar(:LEI);
select pg_temp.ok((select semana_inicio = 1 from agenda_config where empresa_id = :E), 'toda a equipe lê os parâmetros');

-- qualquer pessoa da equipe cria o próprio compromisso (inclusive leitura)
insert into agenda_compromissos(id, empresa_id, titulo, data, hora, hora_fim) values ('ac000000-0000-0000-0000-000000000001', :E, '  Reunião de caixa ', '2026-11-16', '09:00', '10:00');
select pg_temp.ok((select titulo = 'Reunião de caixa' and dono = :LEI and responsavel = :LEI from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000001'), 'compromisso criado com dono e responsável');
select pg_temp.falha($q$insert into agenda_compromissos(empresa_id, titulo, data, dono) values ('e000000a-0000-0000-0000-000000000000', 'de outro', '2026-11-16', 'a0000000-0000-0000-0000-00000000000a')$q$, 'não cria compromisso em nome de outro dono');
select pg_temp.falha($q$insert into agenda_compromissos(empresa_id, titulo, data, responsavel) values ('e000000a-0000-0000-0000-000000000000', 'fora', '2026-11-16', gen_random_uuid())$q$, 'responsável precisa ser da empresa');
select pg_temp.falha($q$insert into agenda_compromissos(empresa_id, titulo, data, hora_fim) values ('e000000a-0000-0000-0000-000000000000', 'sem hora', '2026-11-16', '10:00')$q$, 'hora final exige hora inicial');

-- privado só aparece para quem participa
select pg_temp.entrar(:FIN);
insert into agenda_compromissos(id, empresa_id, titulo, data, privado, participantes) values ('ac000000-0000-0000-0000-000000000002', :E, 'Conversa reservada', '2026-11-17', true, array[:CMP, :CMP, :FIN]::uuid[]);
select pg_temp.ok((select participantes = array[:CMP]::uuid[] from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000002'), 'participantes sem repetição e sem o responsável');
select pg_temp.entrar(:LEI);
select pg_temp.ok((select count(*) from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000002') = 0, 'quem não participa não vê o privado');
select pg_temp.ok((select count(*) from agenda_compromissos where empresa_id = :E) = 1, 'vê os compromissos abertos à equipe');
select pg_temp.entrar(:CMP);
select pg_temp.ok((select count(*) from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000002') = 1, 'participante vê o privado');
reset role;
select pg_temp.ok((select count(*) from notificacoes where tipo = 'agenda' and user_id = :CMP and ref_id = 'ac000000-0000-0000-0000-000000000002') = 1, 'participante é avisado do compromisso');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'agenda' and user_id = :FIN) = 0, 'quem grava não avisa a si mesmo');

-- alterar: só quem participa ou o administrador
select pg_temp.entrar(:CMP);
update agenda_compromissos set titulo = 'tentativa' where id = 'ac000000-0000-0000-0000-000000000001';
select pg_temp.ok((select titulo = 'Reunião de caixa' from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000001'), 'quem não participa não altera');
select pg_temp.falha($q$select agenda_ocorrencia('ac000000-0000-0000-0000-000000000001', null, 'feito')$q$, 'quem não participa não resolve');
delete from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000002';
select pg_temp.ok((select count(*) from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000002') = 1, 'participante não exclui');

-- delegar: o dono passa o compromisso; o novo responsável é avisado e passa a poder resolver
select pg_temp.entrar(:LEI);
update agenda_compromissos set responsavel = :CMP where id = 'ac000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.ok((select count(*) from notificacoes where tipo = 'agenda' and user_id = :CMP and ref_id = 'ac000000-0000-0000-0000-000000000001' and titulo like 'Compromisso passado para você%') = 1, 'delegado é avisado');
select pg_temp.entrar(:CMP);
select agenda_ocorrencia('ac000000-0000-0000-0000-000000000001', null, 'movido', '2026-11-18', '14:00');
select pg_temp.ok((select data = '2026-11-18' and hora = '14:00' and hora_fim = '15:00' from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000001'), 'adiar leva a data e mantém a duração');
select agenda_ocorrencia('ac000000-0000-0000-0000-000000000001', null, 'feito');
select pg_temp.ok((select situacao = 'feito' and feito_por = :CMP and feito_em is not null from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000001'), 'feito carimba quem e quando');
select agenda_ocorrencia('ac000000-0000-0000-0000-000000000001', null, 'reaberto');
select pg_temp.ok((select situacao = 'aberto' and feito_em is null from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000001'), 'reabrir limpa o carimbo');
select pg_temp.falha($q$select agenda_ocorrencia('ac000000-0000-0000-0000-000000000001', null, 'movido')$q$, 'adiar exige a nova data');

-- repetição: a ação vale só para a ocorrência
select pg_temp.entrar(:FIN);
insert into agenda_compromissos(id, empresa_id, titulo, data, hora, repetir, dias_semana, repetir_ate) values ('ac000000-0000-0000-0000-000000000003', :E, 'Posição de caixa', '2026-11-02', '08:30', 'semanal', '{1}', '2026-12-28');
select agenda_ocorrencia('ac000000-0000-0000-0000-000000000003', '2026-11-09', 'feito');
select agenda_ocorrencia('ac000000-0000-0000-0000-000000000003', '2026-11-16', 'movido', '2026-11-17');
select agenda_ocorrencia('ac000000-0000-0000-0000-000000000003', '2026-11-16', 'movido', '2026-11-18', '10:00');
select pg_temp.ok((select count(*) = 2 from agenda_excecoes where compromisso_id = 'ac000000-0000-0000-0000-000000000003') and (select nova_data = '2026-11-18' and nova_hora = '10:00' from agenda_excecoes where compromisso_id = 'ac000000-0000-0000-0000-000000000003' and data = '2026-11-16')
  and (select situacao = 'aberto' and data = '2026-11-02' from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000003'), 'exceção por ocorrência, sem mexer na série');
select agenda_ocorrencia('ac000000-0000-0000-0000-000000000003', '2026-11-09', 'reaberto');
select pg_temp.ok((select count(*) = 1 from agenda_excecoes where compromisso_id = 'ac000000-0000-0000-0000-000000000003'), 'reabrir apaga a exceção');
select pg_temp.falha($q$select agenda_ocorrencia('ac000000-0000-0000-0000-000000000003', null, 'feito')$q$, 'série exige a data da ocorrência');
select pg_temp.falha($q$insert into agenda_excecoes(compromisso_id, empresa_id, data, acao) values ('ac000000-0000-0000-0000-000000000003', 'e000000a-0000-0000-0000-000000000000', '2026-11-23', 'feito')$q$, 'exceção só pela função');
select pg_temp.entrar(:LEI);
select pg_temp.falha($q$select agenda_encerrar_repeticao('ac000000-0000-0000-0000-000000000003', '2026-12-01')$q$, 'só dono, responsável ou admin encerra a série');
select pg_temp.ok((select count(*) = 1 from agenda_excecoes), 'a equipe vê as exceções dos compromissos que vê');
select pg_temp.entrar(:FIN);
select agenda_encerrar_repeticao('ac000000-0000-0000-0000-000000000003', '2026-11-16');
select pg_temp.ok((select repetir_ate = '2026-11-15' from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000003') and (select count(*) = 0 from agenda_excecoes), 'encerra a série a partir da data e limpa as exceções futuras');
select agenda_encerrar_repeticao('ac000000-0000-0000-0000-000000000003', '2026-11-02');
select pg_temp.ok((select situacao = 'cancelado' from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000003'), 'encerrar desde o início cancela o compromisso');

-- excluir: dono ou administrador
select pg_temp.entrar(:ADM);
delete from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000001';
select pg_temp.ok((select count(*) = 0 from agenda_compromissos where id = 'ac000000-0000-0000-0000-000000000001'), 'administrador exclui');
reset role;
select pg_temp.ok((select count(*) from auditoria where tabela = 'agenda_compromissos') > 0, 'auditoria gravada');
