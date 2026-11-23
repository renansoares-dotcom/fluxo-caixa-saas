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
-- 196 — gestão de processos: mapa, etapas, POPs, aprovação, leitura e avisos
\set E '''e000000a-0000-0000-0000-000000000000'''
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
\set DIR '''c2000000-0000-0000-0000-0000000000d1'''
insert into auth.users(id, email) values (:DIR, 'diretor.c2@exemplo.com') on conflict do nothing;
insert into membros(empresa_id, user_id, papel) values (:E, :DIR, 'diretor') on conflict do nothing;
create temp table _g (k text primary key, id uuid, t text); grant all on _g to authenticated;
create function pg_temp.g(k text) returns uuid language sql as $$ select id from _g where _g.k = $1 $$;
grant execute on function pg_temp.g(text) to authenticated;

-- ============================================================ sugestão dos processos
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha(format('select public.proc_configurar(%L)', 'e000000a-0000-0000-0000-000000000000'), 'financeiro preparando o mapa');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.ok(public.proc_configurar(:E::uuid) = 11, '11 processos sugeridos');
select pg_temp.ok(public.proc_configurar(:E::uuid) = 0, 'sugestão idempotente');
select pg_temp.ok((select count(*) = 8 from proc_etapas e join proc_processos p on p.id = e.processo_id where p.empresa_id = :E::uuid and p.codigo = 'SUP-01'), 'SUP-01 com 8 etapas');
select pg_temp.ok((select bool_and(sugerido and dono_id is null) from proc_processos where empresa_id = :E::uuid), 'sugeridos e sem dono');
insert into _g(k, id) select 'sup1', id from proc_processos where empresa_id = :E::uuid and codigo = 'SUP-01';
insert into _g(k, id) select 'sup3', id from proc_processos where empresa_id = :E::uuid and codigo = 'SUP-03';
insert into _g(k, id) select 'fin1', id from proc_processos where empresa_id = :E::uuid and codigo = 'FIN-01';
insert into _g(k, id) select 'msup', id from proc_macros where empresa_id = :E::uuid and codigo = 'SUP';

-- ============================================================ quem vê e quem altera
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) = 11 from proc_processos where empresa_id = :E::uuid), 'leitura consulta o mapa');
select pg_temp.falha(format('select public.proc_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('macro_id', pg_temp.g('msup'), 'nome', 'Processo da leitura')), 'leitura criando processo');
select pg_temp.falha(format('select public.proc_pop_criar(%L, %L)', pg_temp.g('sup1'), 'POP da leitura'), 'leitura escrevendo POP');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.ok((select count(*) = 0 from proc_processos where empresa_id = :E::uuid) and (select count(*) = 0 from proc_etapas where empresa_id = :E::uuid), 'outra empresa não vê o mapa');
select pg_temp.falha(format('select public.proc_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('id', pg_temp.g('sup1'), 'macro_id', pg_temp.g('msup'), 'nome', 'Invadido')), 'outra empresa alterando');

-- ============================================================ dono, crítico e etapas
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha(format('select public.proc_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('id', pg_temp.g('sup1'), 'macro_id', pg_temp.g('msup'), 'nome', 'Compras', 'dono_id', 'c0000000-0000-0000-0000-00000000000c')), 'leitura como dono');
select pg_temp.falha(format('select public.proc_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('macro_id', pg_temp.g('msup'), 'nome', 'Teste decisão',
  'etapas', '[{"tipo":"inicio","responsavel":"A","o_que":"Começo"},{"tipo":"decisao","responsavel":"A","o_que":"Pode?"},{"tipo":"fim","responsavel":"A","o_que":"Fim"}]'::jsonb)), 'decisão sem o não');
select pg_temp.falha(format('select public.proc_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('macro_id', pg_temp.g('msup'), 'nome', 'Teste decisão',
  'etapas', '[{"tipo":"inicio","responsavel":"A","o_que":"Começo"},{"tipo":"decisao","responsavel":"A","o_que":"Pode?","nao":9},{"tipo":"fim","responsavel":"A","o_que":"Fim"}]'::jsonb)), 'decisão com destino fora');
select pg_temp.falha(format('select public.proc_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('macro_id', pg_temp.g('msup'), 'nome', 'Teste sem responsável',
  'etapas', '[{"tipo":"inicio","responsavel":"","o_que":"Começo"}]'::jsonb)), 'etapa sem responsável');
insert into _g(k, id) select 'novo', public.proc_salvar(:E::uuid, jsonb_build_object('macro_id', pg_temp.g('msup'), 'nome', 'Devolução ao fornecedor',
  'etapas', '[{"tipo":"inicio","responsavel":"Almoxarifado","o_que":"Produto a devolver"},{"tipo":"decisao","responsavel":"Compras","o_que":"Fornecedor aceitou?","sim":4,"nao":3},{"tipo":"atividade","responsavel":"Compras","o_que":"Negociar","ir":2},{"tipo":"fim","responsavel":"Fiscal","o_que":"NF de devolução"}]'::jsonb));
select pg_temp.ok((select codigo = 'SUP-05' from proc_processos where id = pg_temp.g('novo')), 'código automático no macroprocesso');
select pg_temp.ok((select count(*) = 4 and max(sim) = 4 and max(nao) = 3 and max(ir) = 2 from proc_etapas where processo_id = pg_temp.g('novo')), 'etapas gravadas com os destinos');
select public.proc_salvar(:E::uuid, jsonb_build_object('id', pg_temp.g('sup1'), 'macro_id', pg_temp.g('msup'), 'nome', 'Compras de materiais e serviços', 'dono_id', 'f0000000-0000-0000-0000-00000000000f', 'critico', true));
select pg_temp.ok((select dono_id = :CMP::uuid and critico and not sugerido from proc_processos where id = pg_temp.g('sup1')), 'dono e crítico definidos; deixa de ser sugerido');
select pg_temp.ok((select count(*) = 8 from proc_etapas where processo_id = pg_temp.g('sup1')), 'salvar sem etapas mantém as etapas');
-- o dono altera o próprio processo, mas não troca o dono nem o crítico
select pg_temp.entrar(:CMP::uuid);
select public.proc_salvar(:E::uuid, jsonb_build_object('id', pg_temp.g('sup1'), 'macro_id', pg_temp.g('msup'), 'nome', 'Compras de materiais e serviços', 'objetivo', 'Comprar bem', 'dono_id', 'd0000000-0000-0000-0000-00000000000d', 'critico', false));
select pg_temp.ok((select dono_id = :CMP::uuid and critico and objetivo = 'Comprar bem' from proc_processos where id = pg_temp.g('sup1')), 'dono altera o texto, não o dono nem o crítico');
select pg_temp.falha(format('select public.proc_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('id', pg_temp.g('fin1'), 'macro_id', pg_temp.g('msup'), 'nome', 'Outro')), 'compras alterando processo de que não é dono');

-- ============================================================ POP: elaborar, enviar, recusar, aprovar (dono + Diretoria)
select pg_temp.entrar(:FIN::uuid);
insert into _g(k, id) select 'pop1', public.proc_pop_criar(pg_temp.g('sup1'), 'Cotação de compras');
select pg_temp.ok((select codigo = 'POP-SUP-001' from proc_pops where id = pg_temp.g('pop1')), 'código do POP');
insert into _g(k, id) select 'v1', id from proc_versoes where pop_id = pg_temp.g('pop1');
select pg_temp.falha(format('select public.proc_versao_enviar(%L)', pg_temp.g('v1')), 'enviar sem procedimento');
select pg_temp.falha(format('select public.proc_versao_salvar(%L, %L::jsonb)', pg_temp.g('v1'), '{"etapas":[99]}'), 'etapa que não existe');
select public.proc_versao_salvar(pg_temp.g('v1'), '{"procedimento":"1. Abrir a cotação com três fornecedores. 2. Comparar preço e prazo.","etapas":[3,4,3],"publico":["compras","financeiro"]}');
select pg_temp.ok((select etapas = '{3,4}' from proc_versoes where id = pg_temp.g('v1')), 'etapas sem repetição');
select pg_temp.ok(public.proc_versao_enviar(pg_temp.g('v1')) = 'dono', 'vai para o dono');
select pg_temp.falha(format('select public.proc_versao_salvar(%L, %L::jsonb)', pg_temp.g('v1'), '{"procedimento":"mudou depois de enviar o texto"}'), 'alterar em aprovação');
select pg_temp.falha(format('select public.proc_versao_decidir(%L, true, null)', pg_temp.g('v1')), 'elaborador aprovando');
select pg_temp.entrar(:DIR::uuid);
select pg_temp.falha(format('select public.proc_versao_decidir(%L, true, null)', pg_temp.g('v1')), 'diretoria antes do dono');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.proc_versao_decidir(%L, false, %L)', pg_temp.g('v1'), ''), 'recusa sem motivo');
select pg_temp.ok(public.proc_versao_decidir(pg_temp.g('v1'), false, 'Falta o prazo da cotação') = 'recusado', 'dono recusa');
select pg_temp.ok((select situacao = 'rascunho' and recusa_motivo is not null from proc_versoes where id = pg_temp.g('v1')), 'recusado volta para rascunho');
reset role;
select pg_temp.ok((select count(*) = 1 from notificacoes where user_id = :FIN::uuid and tipo = 'processo' and titulo like 'POP recusado%'), 'elaborador avisado da recusa');
select pg_temp.entrar(:FIN::uuid);
select public.proc_versao_enviar(pg_temp.g('v1'));
select pg_temp.entrar(:CMP::uuid);
select pg_temp.ok(public.proc_versao_decidir(pg_temp.g('v1'), true, null) = 'diretoria', 'processo crítico: depois do dono, a Diretoria');
select pg_temp.falha(format('select public.proc_versao_decidir(%L, true, null)', pg_temp.g('v1')), 'dono aprovando a fase da Diretoria');
select pg_temp.entrar(:DIR::uuid);
select pg_temp.ok(public.proc_versao_decidir(pg_temp.g('v1'), true, null) = 'vigente', 'Diretoria aprova: em vigor');
select pg_temp.ok((select p.versao_vigente = 1 and p.revisar_em = (current_date + interval '12 months')::date and v.aprovado_por = :CMP::uuid and v.diretoria_por = :DIR::uuid
  from proc_pops p join proc_versoes v on v.pop_id = p.id where p.id = pg_temp.g('pop1')), 'versão vigente, revisão em 12 meses, aprovações registradas');
reset role;
select pg_temp.ok((select count(*) >= 1 from notificacoes where user_id = :CMP::uuid and tipo = 'processo' and titulo like 'POP em vigor%'), 'leitores avisados');

-- ============================================================ leitura
select pg_temp.entrar(:CMP::uuid);
select public.proc_ler(pg_temp.g('v1'));
select public.proc_ler(pg_temp.g('v1'));
select pg_temp.ok((select count(*) = 1 from proc_leituras where versao_id = pg_temp.g('v1')), 'leitura registrada uma vez');
select pg_temp.ok((select count(*) filter (where obrigatorio) = 2 and count(*) filter (where lido_em is not null) = 1 from public.proc_leitores(pg_temp.g('v1'))), 'quem precisa ler e quem leu');

-- ============================================================ revisão: nova versão, motivo, a anterior fica obsoleta
select pg_temp.entrar(:FIN::uuid);
insert into _g(k, id) select 'v2', public.proc_pop_revisar(pg_temp.g('pop1'));
select pg_temp.falha(format('select public.proc_pop_revisar(%L)', pg_temp.g('pop1')), 'duas revisões abertas');
select pg_temp.ok((select versao = 2 and procedimento like '1. Abrir%' and etapas = '{3,4}' from proc_versoes where id = pg_temp.g('v2')), 'revisão copia a vigente');
select pg_temp.falha(format('select public.proc_versao_enviar(%L)', pg_temp.g('v2')), 'revisão sem motivo');
select public.proc_versao_salvar(pg_temp.g('v2'), '{"procedimento":"1. Abrir a cotação com três fornecedores em até 2 dias úteis.","motivo":"Prazo da cotação","publico":["compras","financeiro"]}');
select public.proc_versao_enviar(pg_temp.g('v2'));
select pg_temp.entrar(:CMP::uuid);
select public.proc_versao_decidir(pg_temp.g('v2'), true, null);
select pg_temp.entrar(:DIR::uuid);
select public.proc_versao_decidir(pg_temp.g('v2'), true, null);
select pg_temp.ok((select situacao = 'obsoleta' from proc_versoes where id = pg_temp.g('v1')) and (select situacao = 'vigente' from proc_versoes where id = pg_temp.g('v2'))
  and (select versao_vigente = 2 from proc_pops where id = pg_temp.g('pop1')), 'v1 obsoleta, v2 em vigor');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.proc_ler(%L)', pg_temp.g('v1')), 'ler versão obsoleta');

-- ============================================================ o dono escreveu: aprova a Diretoria (sem fase 2)
insert into _g(k, id) select 'pop2', public.proc_pop_criar(pg_temp.g('sup1'), 'Emissão do pedido');
select pg_temp.ok((select codigo = 'POP-SUP-002' from proc_pops where id = pg_temp.g('pop2')), 'segundo POP do macroprocesso');
insert into _g(k, id) select 'p2v1', id from proc_versoes where pop_id = pg_temp.g('pop2');
select public.proc_versao_salvar(pg_temp.g('p2v1'), jsonb_build_object('procedimento', 'Emitir o pedido no sistema e enviar ao fornecedor por e-mail.', 'leitores', jsonb_build_array('d0000000-0000-0000-0000-00000000000d')));
select pg_temp.ok(public.proc_versao_enviar(pg_temp.g('p2v1')) = 'diretoria', 'dono elaborou: vai para a Diretoria');
select pg_temp.falha(format('select public.proc_versao_decidir(%L, true, null)', pg_temp.g('p2v1')), 'dono aprovando o próprio POP');
select pg_temp.entrar(:DIR::uuid);
select pg_temp.ok(public.proc_versao_decidir(pg_temp.g('p2v1'), true, null) = 'vigente', 'Diretoria aprova direto');
-- a exceção (autoaprovação) só com o parâmetro ligado
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha(format('select public.proc_config_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', '{"autoaprovacao":true}'), 'financeiro mudando parâmetros');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha(format('select public.proc_config_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', '{"papeis_gestor":["diretor"]}'), 'tirar o administrador de quem mantém');
select pg_temp.falha(format('select public.proc_config_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', '{"papeis_diretoria":["compras"]}'), 'compras como Diretoria');
select public.proc_config_salvar(:E::uuid, '{"autoaprovacao":true}');
select pg_temp.ok((select autoaprovacao and revisao_meses = 12 and criticos_diretoria from proc_config where empresa_id = :E::uuid), 'só a exceção muda, o resto fica');
select pg_temp.entrar(:CMP::uuid);
insert into _g(k, id) select 'pop3', public.proc_pop_criar(pg_temp.g('sup1'), 'Acompanhamento da entrega');
insert into _g(k, id) select 'p3v1', id from proc_versoes where pop_id = pg_temp.g('pop3');
select public.proc_versao_salvar(pg_temp.g('p3v1'), '{"procedimento":"Ligar para o fornecedor dois dias antes da data combinada.","publico":["compras"]}');
select pg_temp.ok(public.proc_versao_enviar(pg_temp.g('p3v1')) = 'dono', 'com a exceção ligada, o dono aprova o que escreveu');
select pg_temp.ok(public.proc_versao_decidir(pg_temp.g('p3v1'), true, null) = 'diretoria', 'crítico continua pedindo a Diretoria');
select pg_temp.entrar(:ADM::uuid);
select public.proc_config_salvar(:E::uuid, '{"autoaprovacao":false}');

-- ============================================================ excluir, obsoletar, rascunho
select pg_temp.falha(format('select public.proc_excluir(%L)', pg_temp.g('sup1')), 'excluir processo com POP');
select public.proc_excluir(pg_temp.g('sup3'));
select pg_temp.ok((select count(*) = 0 from proc_processos where id = pg_temp.g('sup3')), 'processo sem POP excluído');
select pg_temp.falha(format('select public.proc_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('id', pg_temp.g('sup1'), 'macro_id', pg_temp.g('msup'), 'nome', 'Compras', 'ativo', false)), 'desativar com POP em uso');
select pg_temp.entrar(:FIN::uuid);
insert into _g(k, id) select 'pop4', public.proc_pop_criar(pg_temp.g('fin1'), 'Rascunho descartável');
select public.proc_versao_descartar((select id from proc_versoes where pop_id = pg_temp.g('pop4')));
select pg_temp.ok((select count(*) = 0 from proc_pops where id = pg_temp.g('pop4')), 'POP só com rascunho some ao descartar');
select pg_temp.falha(format('select public.proc_pop_obsoletar(%L, %L)', pg_temp.g('pop2'), 'não vale mais'), 'financeiro obsoletando POP de que não é dono');
select pg_temp.entrar(:CMP::uuid);
select public.proc_pop_obsoletar(pg_temp.g('pop2'), 'Juntado ao POP-SUP-001');
select pg_temp.ok((select not ativo and versao_vigente is null from proc_pops where id = pg_temp.g('pop2')) and (select situacao = 'obsoleta' from proc_versoes where id = pg_temp.g('p2v1')), 'POP obsoleto');

-- ============================================================ avisos de revisão e de leitura
reset role;
update proc_pops set revisar_em = current_date + 5 where id = pg_temp.g('pop1');
update proc_versoes set vigente_desde = current_date - 10 where id = pg_temp.g('v2');
delete from notificacoes where tipo = 'processo';
select pg_temp.ok(public._proc_avisos() >= 2, 'avisos gerados');
select pg_temp.ok((select count(*) = 1 from notificacoes where user_id = :CMP::uuid and titulo like 'Revisão do POP-SUP-001 vence%'), 'dono avisado da revisão');
select pg_temp.ok((select count(*) = 1 from notificacoes where user_id = :FIN::uuid and titulo like 'Leitura pendente: POP-SUP-001 v2'), 'quem não leu é cobrado');
select pg_temp.ok(public._proc_avisos() = 0, 'não repete no mesmo dia');
\o
\echo c2_processos ok
