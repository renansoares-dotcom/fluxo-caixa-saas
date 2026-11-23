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
-- 194 — arquivo morto: caixas, conteúdo, prazo de guarda, retirada e descarte
\set E '''e000000a-0000-0000-0000-000000000000'''
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set PRD '''87000000-0000-0000-0000-0000000000aa'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
\set DIR '''c0d10000-0000-0000-0000-0000000000d1'''
\set RH '''c0a10000-0000-0000-0000-0000000000a1'''
insert into auth.users(id, email) values (:DIR, 'diretor.c0@exemplo.com'), (:RH, 'rh.c0@exemplo.com') on conflict do nothing;
insert into membros(empresa_id, user_id, papel) values (:E, :DIR, 'diretor') on conflict do nothing;
insert into membros(empresa_id, user_id, papel, areas) values (:E, :RH, 'compras', '{rh}') on conflict do nothing;
create temp table _g (k text primary key, id uuid, j jsonb); grant all on _g to authenticated;
create function pg_temp.t(n text) returns uuid language sql security definer as $$ select id from arq_tipos where empresa_id = 'e000000a-0000-0000-0000-000000000000' and nome = n $$;
create function pg_temp.g(k text) returns uuid language sql as $$ select id from _g where _g.k = $1 $$;
grant execute on function pg_temp.t(text), pg_temp.g(text) to authenticated;

-- ============================================================ parâmetros e tipos sugeridos
select pg_temp.entrar(:PRD::uuid);
select pg_temp.falha($$select public.arq_configurar('e000000a-0000-0000-0000-000000000000')$$, 'produção preparando o arquivo');
select pg_temp.ok((select count(*) = 0 from arq_tipos), 'produção não vê os tipos');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha($$select public.arq_config_salvar('e000000a-0000-0000-0000-000000000000', '{}')$$, 'financeiro mudando os parâmetros');
select pg_temp.ok(public.arq_configurar(:E::uuid) = 20, '20 tipos sugeridos');
select pg_temp.ok(public.arq_configurar(:E::uuid) = 0, 'preparar de novo não duplica');
select pg_temp.ok((select bool_and(not prazo_confirmado) and count(*) filter (where prazo_anos is null) = 3 from arq_tipos where empresa_id = :E::uuid), 'prazos sugeridos, nenhum confirmado; 3 permanentes');
select pg_temp.falha(format('select public.arq_tipo_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('id', pg_temp.t('Notas fiscais de entrada e saída'), 'prazo_anos', 5, 'prazo_confirmado', true)), 'financeiro confirmando prazo (só quem aprova o descarte)');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha($$select public.arq_config_salvar('e000000a-0000-0000-0000-000000000000', '{"papeis_descarte":["financeiro"]}')$$, 'descarte sem administrador nem diretor');
select pg_temp.falha($$select public.arq_config_salvar('e000000a-0000-0000-0000-000000000000', '{"descarte_suspenso":true}')$$, 'suspender sem motivo');
select public.arq_config_salvar(:E::uuid, jsonb_build_object('arquivistas', jsonb_build_array(:CMP::text), 'emprestimo_dias', 10));
select pg_temp.ok((select papeis_gestor = '{admin,financeiro,diretor}' and arquivistas = array[:CMP::uuid] and emprestimo_dias = 10 from arq_config where empresa_id = :E::uuid), 'padrões mantidos e compras nomeado para cuidar do arquivo');
select public.arq_tipo_salvar(:E::uuid, jsonb_build_object('id', pg_temp.t('Notas fiscais de entrada e saída'), 'prazo_anos', 5, 'prazo_confirmado', true, 'observacao', 'Confirmado pela contabilidade'));
select pg_temp.ok((select prazo_confirmado and confirmado_por = :ADM::uuid from arq_tipos where id = pg_temp.t('Notas fiscais de entrada e saída')), 'administrador confirmou o prazo');

-- ============================================================ sala, endereços e caixas
select pg_temp.entrar(:CMP::uuid);   -- nomeado: cuida do arquivo
insert into _g(k, id) select 'sala', public.arq_local_salvar(:E::uuid, '{"nome":"Sala do arquivo C0"}');
select pg_temp.ok(public.arq_end_gerar(:E::uuid, pg_temp.g('sala'), '{A,B}', 3, 0) = 6, '6 endereços');
select pg_temp.ok((select bool_and(etiqueta ~ '^S\d{7,}$') from arq_enderecos where local_id = pg_temp.g('sala')), 'etiqueta de prateleira do arquivo S…');
insert into _g(k, id) select 'ea', id from arq_enderecos where local_id = pg_temp.g('sala') and codigo = 'A-01';
select pg_temp.falha($$select public.arq_caixa_salvar('e000000a-0000-0000-0000-000000000000', '{"area":"fiscal"}')$$, 'caixa sem título');
select pg_temp.falha(format('select public.arq_caixa_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('area', 'fiscal', 'titulo', 'NF 2019',
  'itens', jsonb_build_array(jsonb_build_object('tipo_id', pg_temp.t('Notas fiscais de entrada e saída'), 'inicio', '2019-12-31', 'fim', '2019-01-01')))), 'período invertido');
insert into _g(k, id) select 'cx1', public.arq_caixa_salvar(:E::uuid, jsonb_build_object('area', 'fiscal', 'titulo', 'Notas de entrada 2019', 'endereco_id', pg_temp.g('ea'),
  'itens', jsonb_build_array(jsonb_build_object('tipo_id', pg_temp.t('Notas fiscais de entrada e saída'), 'descricao', 'Jan a dez', 'inicio', '2019-01-01', 'fim', '2019-12-31'))));
insert into _g(k, id) select 'cx2', public.arq_caixa_salvar(:E::uuid, jsonb_build_object('area', 'fiscal', 'titulo', 'Notas e livros 2019',
  'itens', jsonb_build_array(jsonb_build_object('tipo_id', pg_temp.t('Notas fiscais de entrada e saída'), 'inicio', '2019-01-01', 'fim', '2019-12-31'),
                             jsonb_build_object('tipo_id', pg_temp.t('Livros e apurações fiscais'), 'inicio', '2019-01-01', 'fim', '2019-12-31'))));
insert into _g(k, id) select 'cx3', public.arq_caixa_salvar(:E::uuid, jsonb_build_object('area', 'rh', 'titulo', 'Rescisões 2018',
  'itens', jsonb_build_array(jsonb_build_object('tipo_id', pg_temp.t('Rescisões'), 'inicio', '2018-01-01', 'fim', '2018-12-31'))));
insert into _g(k, id) select 'cx4', public.arq_caixa_salvar(:E::uuid, jsonb_build_object('area', 'rh', 'titulo', 'Fichas de registro',
  'itens', jsonb_build_array(jsonb_build_object('tipo_id', pg_temp.t('Registro de empregados (livro ou fichas)'), 'inicio', '2010-01-01', 'fim', '2015-12-31'))));
reset role;
select pg_temp.ok((select numero = 1 and descartar_em = '2025-01-01' and periodo_inicio = '2019-01-01' and not prazo_pendente and etiqueta ~ '^C\d{7,}$' from arq_caixas where id = pg_temp.g('cx1')),
  'caixa 1: nota de 2019 + 5 anos = descarte a partir de 01/01/2025, etiqueta C…');
select pg_temp.ok((select numero = 2 and prazo_pendente from arq_caixas where id = pg_temp.g('cx2')), 'caixa 2: livros com prazo ainda não confirmado');
select pg_temp.ok((select permanente and descartar_em is null from arq_caixas where id = pg_temp.g('cx4')), 'fichas de registro: guarda permanente');

-- ============================================================ quem vê o quê; nada de escrita direta
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$update arq_caixas set titulo = 'x'$$, 'alterar caixa direto na tabela');
select pg_temp.falha($$insert into arq_itens(caixa_id, empresa_id, tipo_id, inicio, fim) select id, empresa_id, (select id from arq_tipos limit 1), current_date, current_date from arq_caixas limit 1$$, 'inserir conteúdo direto');
select pg_temp.falha($$select public._arq_recalc('{}')$$, 'chamar a função interna');
select pg_temp.ok((select count(*) = 4 from arq_caixas where empresa_id = :E::uuid), 'quem cuida do arquivo vê as 4 caixas, inclusive as do RH');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok((select count(*) = 2 from arq_caixas where empresa_id = :E::uuid) and (select count(*) = 2 from arq_itens i join arq_caixas c on c.id = i.caixa_id where c.numero = 2)
  and (select count(*) = 0 from arq_itens i where i.caixa_id = pg_temp.g('cx3')), 'financeiro (perfil que cuida do arquivo, sem o RH) não vê as caixas do RH nem o conteúdo delas');
select pg_temp.falha(format('select public.arq_caixa_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('area', 'rh', 'titulo', 'Folha 2020')), 'financeiro criando caixa do RH');
select pg_temp.falha(format('select public.arq_caixa_mover(%L, %L::uuid[], null)', 'e000000a-0000-0000-0000-000000000000', array[pg_temp.g('cx3')]), 'financeiro mexendo em caixa do RH');
select pg_temp.entrar(:RH::uuid);
select pg_temp.ok((select count(*) = 4 from arq_caixas where empresa_id = :E::uuid), 'quem é do RH (perfil compras, consulta) vê as 4');
select pg_temp.falha(format('select public.arq_caixa_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('area', 'rh', 'titulo', 'Folha 2020')), 'quem consulta não cadastra caixa');
select pg_temp.entrar(:PRD::uuid);
select pg_temp.ok((select count(*) = 0 from arq_caixas) and (select count(*) = 0 from arq_enderecos), 'produção não consulta o arquivo');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.ok((select count(*) = 0 from arq_caixas where empresa_id = :E::uuid), 'outra empresa não vê');
select pg_temp.falha(format('select public.arq_emp_pedir(%L, %L)', pg_temp.g('cx1'), 'Fiscalização da outra empresa'), 'outra empresa pedindo caixa');

-- ============================================================ retirada e devolução
select pg_temp.entrar(:LEI::uuid);
select pg_temp.falha(format('select public.arq_emp_pedir(%L, %L)', pg_temp.g('cx1'), 'Consulta de nota'), 'perfil de leitura não consulta o arquivo (padrão)');
select pg_temp.entrar(:RH::uuid);
select pg_temp.falha(format('select public.arq_emp_pedir(%L, %L)', pg_temp.g('cx1'), 'x'), 'pedido sem motivo');
insert into _g(k, id) select 'ped', public.arq_emp_pedir(pg_temp.g('cx1'), 'Fiscalização pediu as notas de 2019');
select pg_temp.falha(format('select public.arq_emp_pedir(%L, %L)', pg_temp.g('cx1'), 'De novo a mesma caixa'), 'pedido repetido');
select pg_temp.falha(format('select public.arq_emp_retirar(%L, %L, %L, null, null, %L)', pg_temp.g('cx1'), pg_temp.g('ped'), :RH, current_date + 5), 'quem pediu registrando a própria retirada');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.arq_emp_retirar(%L, %L, %L, null, null, %L)', pg_temp.g('cx1'), pg_temp.g('ped'), :RH, current_date - 1), 'devolução prevista no passado');
select public.arq_emp_retirar(pg_temp.g('cx1'), pg_temp.g('ped'), :RH::uuid, null, null, current_date + 5);
select pg_temp.ok((select situacao = 'emprestada' from arq_caixas where id = pg_temp.g('cx1')) and (select situacao = 'retirada' and para_id = :RH::uuid and retirado_por = :CMP::uuid from arq_emprestimos where id = pg_temp.g('ped')), 'caixa retirada pelo pedido');
select pg_temp.falha(format('select public.arq_emp_retirar(%L, null, null, %L, %L, %L)', pg_temp.g('cx1'), 'Fulano de Tal', 'Outra retirada', current_date + 2), 'retirar caixa que já está fora');

-- ============================================================ descarte: prazo, retenção, aprovação por outra pessoa, execução
select pg_temp.falha(format('select public.arq_descarte_propor(%L, %L::uuid[], null)', 'e000000a-0000-0000-0000-000000000000', array[pg_temp.g('cx1')]), 'descartar caixa retirada');
select public.arq_emp_devolver(pg_temp.g('ped'));
select pg_temp.ok((select situacao = 'arquivada' from arq_caixas where id = pg_temp.g('cx1')), 'devolvida');
select pg_temp.falha(format('select public.arq_descarte_propor(%L, %L::uuid[], null)', 'e000000a-0000-0000-0000-000000000000', array[pg_temp.g('cx2')]), 'descartar caixa com prazo não confirmado');
select pg_temp.falha(format('select public.arq_descarte_propor(%L, %L::uuid[], null)', 'e000000a-0000-0000-0000-000000000000', array[pg_temp.g('cx4')]), 'descartar guarda permanente');
select pg_temp.ok((select count(*) = 1 and bool_and(impede is null) from public.arq_descartaveis(:E::uuid) where caixa_id = pg_temp.g('cx1'))
  and (select impede like 'prazo%' from public.arq_descartaveis(:E::uuid) where caixa_id = pg_temp.g('cx2')), 'lista do que vence: caixa 1 pode, caixa 2 aguarda o prazo');
-- retenção
select public.arq_caixa_salvar(:E::uuid, jsonb_build_object('id', pg_temp.g('cx1'), 'area', 'fiscal', 'titulo', 'Notas de entrada 2019', 'endereco_id', pg_temp.g('ea'), 'reter', true, 'reter_motivo', 'Auditoria da recuperação judicial',
  'itens', jsonb_build_array(jsonb_build_object('tipo_id', pg_temp.t('Notas fiscais de entrada e saída'), 'descricao', 'Jan a dez', 'inicio', '2019-01-01', 'fim', '2019-12-31'))));
select pg_temp.falha(format('select public.arq_descarte_propor(%L, %L::uuid[], null)', 'e000000a-0000-0000-0000-000000000000', array[pg_temp.g('cx1')]), 'descartar caixa retida');
select public.arq_caixa_salvar(:E::uuid, jsonb_build_object('id', pg_temp.g('cx1'), 'area', 'fiscal', 'titulo', 'Notas de entrada 2019', 'endereco_id', pg_temp.g('ea'),
  'itens', jsonb_build_array(jsonb_build_object('tipo_id', pg_temp.t('Notas fiscais de entrada e saída'), 'descricao', 'Jan a dez', 'inicio', '2019-01-01', 'fim', '2019-12-31'))));
insert into _g(k, id) select 'd1', public.arq_descarte_propor(:E::uuid, array[pg_temp.g('cx1')], 'Notas vencidas');
select pg_temp.falha(format('select public.arq_caixa_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('id', pg_temp.g('cx1'), 'area', 'fiscal', 'titulo', 'Mudou')), 'alterar caixa numa proposta de descarte');
select pg_temp.falha(format('select public.arq_descarte_propor(%L, %L::uuid[], null)', 'e000000a-0000-0000-0000-000000000000', array[pg_temp.g('cx1')]), 'a mesma caixa em duas propostas');
select pg_temp.falha(format('select public.arq_descarte_executar(%L, current_date, %L, %L, null)', pg_temp.g('d1'), 'fragmentacao', 'Equipe'), 'executar sem aprovação');
select pg_temp.falha(format('select public.arq_descarte_decidir(%L, true, null)', pg_temp.g('d1')), 'compras aprovando o descarte');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha(format('select public.arq_descarte_decidir(%L, true, null)', pg_temp.g('d1')), 'financeiro aprovando o descarte (padrão: administrador e diretor)');
select pg_temp.entrar(:DIR::uuid);
select pg_temp.falha(format('select public.arq_descarte_decidir(%L, false, null)', pg_temp.g('d1')), 'recusar sem motivo');
select public.arq_descarte_decidir(pg_temp.g('d1'), true, null);
-- suspensão geral trava a execução
select pg_temp.entrar(:ADM::uuid);
select public.arq_config_salvar(:E::uuid, jsonb_build_object('arquivistas', jsonb_build_array(:CMP::text), 'descarte_suspenso', true, 'descarte_suspenso_motivo', 'Recuperação judicial em andamento'));
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.arq_descarte_executar(%L, current_date, %L, %L, null)', pg_temp.g('d1'), 'fragmentacao', 'Equipe do arquivo'), 'executar com o descarte suspenso');
select pg_temp.entrar(:ADM::uuid);
select public.arq_config_salvar(:E::uuid, jsonb_build_object('arquivistas', jsonb_build_array(:CMP::text)));
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.arq_descarte_executar(%L, current_date, %L, %L, null)', pg_temp.g('d1'), 'queimar', 'Equipe'), 'forma inválida');
select pg_temp.falha(format('select public.arq_descarte_executar(%L, current_date + 1, %L, %L, null)', pg_temp.g('d1'), 'fragmentacao', 'Equipe'), 'data futura');
select pg_temp.ok(public.arq_descarte_executar(pg_temp.g('d1'), current_date, 'fragmentacao', 'Equipe do arquivo', 'Ana') = 1, 'descarte executado');
select pg_temp.ok((select situacao = 'descartada' and endereco_id is null from arq_caixas where id = pg_temp.g('cx1'))
  and (select situacao = 'executado' and forma = 'fragmentacao' and decidido_por = :DIR::uuid from arq_descartes where id = pg_temp.g('d1')), 'caixa descartada e termo registrado');
select pg_temp.falha(format('select public.arq_emp_pedir(%L, %L)', pg_temp.g('cx1'), 'Preciso da caixa'), 'pedir caixa descartada');
select pg_temp.falha(format('select public.arq_caixa_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('id', pg_temp.g('cx1'), 'area', 'fiscal', 'titulo', 'Volta')), 'alterar caixa descartada');

-- quem propõe não aprova
select pg_temp.entrar(:ADM::uuid);
select public.arq_tipo_salvar(:E::uuid, jsonb_build_object('id', pg_temp.t('Livros e apurações fiscais'), 'prazo_anos', 5, 'prazo_confirmado', true));
insert into _g(k, id) select 'd2', public.arq_descarte_propor(:E::uuid, array[pg_temp.g('cx2')], null);
select pg_temp.falha(format('select public.arq_descarte_decidir(%L, true, null)', pg_temp.g('d2')), 'quem propôs aprovando');
select public.arq_descarte_cancelar(pg_temp.g('d2'), 'Fica para o próximo ano');

-- mudar o prazo desfaz a confirmação; mudar só o nome não
select public.arq_tipo_salvar(:E::uuid, jsonb_build_object('id', pg_temp.t('Livros e apurações fiscais'), 'nome', 'Livros e apurações fiscais', 'prazo_anos', 5, 'observacao', 'ok'));
select pg_temp.ok((select prazo_confirmado from arq_tipos where id = pg_temp.t('Livros e apurações fiscais')), 'mesmo prazo: continua confirmado');
select pg_temp.entrar(:FIN::uuid);
select public.arq_tipo_salvar(:E::uuid, jsonb_build_object('id', pg_temp.t('Livros e apurações fiscais'), 'prazo_anos', 6));
reset role;
select pg_temp.ok((select not prazo_confirmado and prazo_anos = 6 from arq_tipos where id = pg_temp.t('Livros e apurações fiscais'))
  and (select prazo_pendente and descartar_em = '2026-01-01' from arq_caixas where id = pg_temp.g('cx2')), 'prazo mudou: volta a ser sugestão e a caixa recalcula');
delete from membros where user_id in (:DIR::uuid, :RH::uuid); delete from auth.users where id in (:DIR::uuid, :RH::uuid);
\o
\echo c0_arquivo_morto ok
