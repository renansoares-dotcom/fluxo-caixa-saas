-- Portal do colaborador e SST (SQL 145): perfil colaborador fora do restante, portal só com os dados dele, documentos e ciência,
-- arquivos privados por pasta, vencimento pelo tipo, situação, obrigatoriedade por cargo e aviso diário.
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
insert into auth.users(id, email) values ('81000000-0000-0000-0000-0000000000a1', 'colab81@t.com'), ('81000000-0000-0000-0000-0000000000a2', 'outro81@t.com');
insert into membros(empresa_id, user_id, papel) values (:E, '81000000-0000-0000-0000-0000000000a1', 'colaborador'), (:E, '81000000-0000-0000-0000-0000000000a2', 'colaborador');
insert into rh_colaboradores(id, empresa_id, nome, cargo, setor, vinculo, situacao, admissao, salario, user_id) values
  ('81000000-0000-0000-0000-0000000000c1', :E, 'COLAB 81', 'OPERADOR DE EMPILHADEIRA', 'Expedição', 'clt', 'ativo', '2024-01-10', 2500, '81000000-0000-0000-0000-0000000000a1'),
  ('81000000-0000-0000-0000-0000000000c2', :E, 'OUTRO 81', 'AUXILIAR', 'Produção', 'clt', 'ativo', '2025-01-10', 2000, '81000000-0000-0000-0000-0000000000a2');
insert into rh_sst_tipos(id, empresa_id, nome, categoria, validade_meses, antecedencia_dias, todos) values ('81000000-0000-0000-0000-0000000000b1', :E, 'ASO periódico 81', 'aso', 12, 30, true);
insert into rh_sst_tipos(id, empresa_id, nome, categoria, validade_meses, antecedencia_dias, cargos) values ('81000000-0000-0000-0000-0000000000b2', :E, 'NR-11 81', 'nr', 24, 60, array['EMPILHADEIRA']);
insert into rh_sst_tipos(id, empresa_id, nome, categoria, validade_meses) values ('81000000-0000-0000-0000-0000000000b3', :E, 'Brigada 81', 'treinamento', null);
insert into rh_sst_registros(empresa_id, colaborador_id, tipo_id, realizado_em, resultado) values (:E, '81000000-0000-0000-0000-0000000000c1', '81000000-0000-0000-0000-0000000000b1', '2025-11-20', 'apto'),
  (:E, '81000000-0000-0000-0000-0000000000c2', '81000000-0000-0000-0000-0000000000b1', '2025-10-01', 'apto'), (:E, '81000000-0000-0000-0000-0000000000c2', '81000000-0000-0000-0000-0000000000b3', '2026-01-01', 'concluido');
select pg_temp.ok((select vence_em = '2026-11-20' from rh_sst_registros where colaborador_id = '81000000-0000-0000-0000-0000000000c1'), 'vencimento pela validade');
select pg_temp.ok((select vence_em is null from rh_sst_registros where tipo_id = '81000000-0000-0000-0000-0000000000b3'), 'sem validade não vence');
insert into rh_documentos(id, empresa_id, colaborador_id, tipo, competencia, titulo, path) values
  ('81000000-0000-0000-0000-0000000000d1', :E, '81000000-0000-0000-0000-0000000000c1', 'holerite', '2026-10-01', 'Holerite 10/2026', 'e000000a-0000-0000-0000-000000000000/81000000-0000-0000-0000-0000000000c1/h.pdf'),
  ('81000000-0000-0000-0000-0000000000d2', :E, '81000000-0000-0000-0000-0000000000c2', 'holerite', '2026-10-01', 'Holerite 10/2026', 'e000000a-0000-0000-0000-000000000000/81000000-0000-0000-0000-0000000000c2/h.pdf');
select pg_temp.falha($$insert into rh_documentos(empresa_id, colaborador_id, titulo, path) values ('e000000a-0000-0000-0000-000000000000', '81000000-0000-0000-0000-0000000000c1', 'x', 'e000000a-0000-0000-0000-000000000000/81000000-0000-0000-0000-0000000000c2/x.pdf')$$, 'pasta de outro colaborador');
insert into storage.objects(bucket_id, name) values ('rh-docs', 'e000000a-0000-0000-0000-000000000000/81000000-0000-0000-0000-0000000000c1/h.pdf'), ('rh-docs', 'e000000a-0000-0000-0000-000000000000/81000000-0000-0000-0000-0000000000c2/h.pdf');

-- situação (RH) em 08/11/2026
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select x ->> 'situacao' = 'a_vencer' and (x ->> 'dias')::int = 12 from jsonb_array_elements(public.rh_sst_situacao(:E, '2026-11-08')) x where x ->> 'nome' = 'COLAB 81' and x ->> 'tipo' = 'ASO periódico 81'), 'ASO a vencer');
select pg_temp.ok((select x ->> 'situacao' = 'pendente' from jsonb_array_elements(public.rh_sst_situacao(:E, '2026-11-08')) x where x ->> 'nome' = 'COLAB 81' and x ->> 'tipo' = 'NR-11 81'), 'NR-11 obrigatória pelo cargo e pendente');
select pg_temp.ok((select x ->> 'situacao' = 'vencido' from jsonb_array_elements(public.rh_sst_situacao(:E, '2026-11-08')) x where x ->> 'nome' = 'OUTRO 81' and x ->> 'tipo' = 'ASO periódico 81'), 'ASO vencido');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.rh_sst_situacao(:E, '2026-11-08')) x where x ->> 'nome' = 'OUTRO 81' and x ->> 'tipo' = 'NR-11 81'), 'NR-11 não se aplica a auxiliar');

-- portal: só o dele
select pg_temp.entrar('81000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(not public.is_membro(:E), 'colaborador não é membro pleno');
select pg_temp.ok((select count(*) from lancamentos where empresa_id = :E) = 0, 'não vê lançamentos');
select pg_temp.ok((select count(*) from rh_colaboradores) = 0, 'não lê o cadastro do RH');
select pg_temp.ok((public.portal_meus_dados(:E) -> 'colaborador' ->> 'nome') = 'COLAB 81', 'portal com o próprio nome');
select pg_temp.ok(jsonb_array_length(public.portal_meus_dados(:E) -> 'documentos') = 1, 'só o próprio holerite');
select pg_temp.ok(jsonb_array_length(public.portal_meus_dados(:E) -> 'sst') = 2, 'ASO e NR-11 dele');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'rh-docs') = 1, 'só o próprio arquivo');
select public.portal_doc_visto('81000000-0000-0000-0000-0000000000d1');
select pg_temp.falha($$select public.portal_doc_visto('81000000-0000-0000-0000-0000000000d2')$$, 'ciência no documento de outro');
select pg_temp.falha($$insert into storage.objects(bucket_id, name) values ('rh-docs', 'e000000a-0000-0000-0000-000000000000/81000000-0000-0000-0000-0000000000c1/x.pdf')$$, 'colaborador não envia');
reset role;
select pg_temp.ok((select visto_em is not null from rh_documentos where id = '81000000-0000-0000-0000-0000000000d1'), 'ciência gravada');
update rh_documentos set publicado = false where id = '81000000-0000-0000-0000-0000000000d1';
select pg_temp.entrar('81000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(jsonb_array_length(public.portal_meus_dados(:E) -> 'documentos') = 0 and (select count(*) from storage.objects where bucket_id = 'rh-docs') = 0, 'não publicado some');
reset role;
insert into rh_portal_config(empresa_id, ativo) values (:E, false);
select pg_temp.entrar('81000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((public.portal_meus_dados(:E) ->> 'ativo')::boolean = false, 'portal desligado');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) from public.rh_usuarios_portal(:E)) = 2, 'usuários do portal para ligar');
-- aviso diário (segunda 09/11/2026), como o cron: sem usuário
reset role;
select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '{}', false);
update rh_portal_config set ativo = true where empresa_id = :E;
select pg_temp.ok(public._rh_sst_avisar(:E, '2026-11-09') = 1, 'avisou');
select pg_temp.ok(public._rh_sst_avisar(:E, '2026-11-09') = 0, 'uma vez por dia');
select pg_temp.ok(public._rh_sst_avisar(:E, '2026-11-14') = 0, 'sábado não');
select pg_temp.ok((select count(*) >= 1 from notificacoes where tipo = 'rh_sst' and user_id = 'a0000000-0000-0000-0000-00000000000a'), 'admin avisado');
select pg_temp.ok((select count(*) >= 1 from notificacoes where tipo = 'rh_sst' and user_id = '81000000-0000-0000-0000-0000000000a1'), 'colaborador avisado do dele');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');   -- financeiro sem RH
select pg_temp.falha($$select public.rh_sst_situacao('e000000a-0000-0000-0000-000000000000')$$, 'sem RH');
reset role;
\o
select 'ok 81 portal e SST';
