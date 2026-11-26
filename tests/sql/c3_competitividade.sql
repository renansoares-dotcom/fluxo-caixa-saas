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
-- 197 — análise de competitividade de preço: parâmetros pré-carregados, acesso, margem separada, numeração e status
\set E '''e000000a-0000-0000-0000-000000000000'''
\set EB '''e000000b-0000-0000-0000-000000000000'''
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set VEN '''c3000000-0000-0000-0000-0000000000a1'''
insert into auth.users(id, email) values (:VEN::uuid, 'vendas.c3@exemplo.com') on conflict do nothing;
insert into membros(empresa_id, user_id, papel) values (:E, :VEN, 'vendas') on conflict do nothing;
create temp table _g (k text primary key, id uuid); grant all on _g to authenticated;
insert into favorecidos(id, empresa_id, tipo, nome) values ('c3000000-0000-0000-0000-0000000000f1', :E, 'CLIENTES', 'CLIENTE C3') on conflict do nothing;

-- ============================================================ pré-carga
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.comp_configurar(%L)', 'e000000a-0000-0000-0000-000000000000'), 'compras não usa a tela');
select pg_temp.entrar(:VEN::uuid);
select pg_temp.ok(public.comp_configurar(:E::uuid) = 31, '27 UFs + regra interestadual + 3 antecipações de PE');
select pg_temp.ok(public.comp_configurar(:E::uuid) = 0, 'pré-carga idempotente');
select pg_temp.ok((select aliquota = 20.5 from fisc_icms_interna where empresa_id = :E::uuid and uf = 'PE'), 'PE 20,5%');
select pg_temp.ok((select aliquota = 19 from fisc_icms_interna where empresa_id = :E::uuid and uf = 'SE'), 'SE 19%');
select pg_temp.ok((select pct = 8.34 from fisc_antecipacao where empresa_id = :E::uuid and aliq_inter = 12), 'antecipação N/NE 8,34%');
select pg_temp.ok((select bool_and(situacao = 'a_conferir') from fisc_icms_interna where empresa_id = :E::uuid), 'pré-carga fica a conferir');
select pg_temp.ok(not (public.comp_acesso(:E::uuid)->>'margem')::boolean, 'vendas não vê margem');
select pg_temp.falha(format('update fisc_icms_interna set aliquota = 1 where empresa_id = %L', 'e000000a-0000-0000-0000-000000000000') || ' returning 1/0', 'vendas não altera alíquota');
select pg_temp.ok((select aliquota from fisc_icms_interna where empresa_id = :E::uuid and uf = 'PE') = 20.5, 'alíquota intacta');

-- ============================================================ salvar
select pg_temp.ok((public.comp_salvar(:E::uuid, '{"cliente_nome":"Indústria Exemplo PE","cliente":{"uf":"PE","tipo":"industria"},"concorrente":{"uf":"SE","preco":17},"proposta":{"preco":20},"resultado":{"empate":18.81}}'::jsonb,
  '{"margem_pct":12}'::jsonb)->>'numero')::int = 1, 'análise nº 1');
insert into _g select 'a1', id from com_competitividade where empresa_id = :E::uuid and numero = 1;
select pg_temp.ok(not exists (select 1 from com_competitividade_margem), 'margem de quem não tem liberação é descartada');
select pg_temp.falha(format('select public.comp_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', '{"cliente_nome":"X","concorrente":{"preco":17},"proposta":{"preco":0}}'), 'sem preço');
select pg_temp.falha(format('select public.comp_status(%L, %L)', (select id from _g where k = 'a1'), 'perdida'), 'perdida sem motivo');
select public.comp_status((select id from _g where k = 'a1'), 'perdida', 'preço');
select pg_temp.ok((select status = 'perdida' and jsonb_array_length(historico) = 2 from com_competitividade where id = (select id from _g where k = 'a1')), 'status com histórico');
select pg_temp.falha(format('select public.comp_excluir(%L)', (select id from _g where k = 'a1')), 'responsável não exclui depois de fechada');

-- ============================================================ admin libera a margem para um usuário
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha(format('select public.comp_config_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', '{"papeis_usa":["vendas"]}'), 'admin não se tira da tela');
select public.comp_config_salvar(:E::uuid, jsonb_build_object('papeis_usa', '["admin","diretor","financeiro","vendas"]'::jsonb, 'papeis_margem', '["admin","diretor"]'::jsonb,
  'usuarios_margem', jsonb_build_array('c3000000-0000-0000-0000-0000000000a1'), 'margem_min_pct', 12));
select pg_temp.ok((select margem_min_pct = 12 from com_comp_config where empresa_id = :E::uuid), 'margem mínima salva');
select pg_temp.ok((select count(*) >= 5 from public.comp_pessoas(:E::uuid)), 'lista de pessoas');
select pg_temp.entrar(:VEN::uuid);
select pg_temp.ok((public.comp_acesso(:E::uuid)->>'margem')::boolean, 'vendedor liberado individualmente vê a margem');
select public.comp_salvar(:E::uuid, jsonb_build_object('id', (select id from _g where k = 'a1'), 'cliente_nome', 'Indústria Exemplo PE', 'concorrente', '{"preco":17}'::jsonb, 'proposta', '{"preco":19}'::jsonb),
  '{"margem_pct":9}'::jsonb);
select pg_temp.ok((select (dados->>'margem_pct')::numeric = 9 from com_competitividade_margem), 'margem gravada');
select pg_temp.falha(format('select public.comp_config_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', '{"papeis_usa":["admin"]}'), 'vendas não altera parâmetros');

-- ============================================================ outros perfis e outra empresa
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok((select count(*) = 1 from com_competitividade), 'financeiro consulta');
select pg_temp.ok((select count(*) = 0 from com_competitividade_margem), 'financeiro não lê a margem');
select pg_temp.falha(format('select public.comp_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000',
  jsonb_build_object('id', (select id from _g where k = 'a1'), 'cliente_nome', 'X', 'concorrente', '{"preco":17}'::jsonb, 'proposta', '{"preco":18}'::jsonb)), 'outro usuário não altera a análise');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.ok((select count(*) = 0 from com_competitividade), 'compras não vê as análises');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.ok((select count(*) = 0 from com_competitividade), 'outra empresa não vê');
select pg_temp.ok((select count(*) = 0 from fisc_icms_interna where empresa_id = :E::uuid), 'outra empresa não vê os parâmetros');
select pg_temp.ok(public.comp_configurar(:EB::uuid) = 31, 'cada empresa recebe a sua pré-carga');
select pg_temp.falha(format('select public.comp_salvar(%L, %L::jsonb)', 'e000000b-0000-0000-0000-000000000000',
  jsonb_build_object('cliente_nome', 'X', 'cliente_id', 'c3000000-0000-0000-0000-0000000000f1', 'concorrente', '{"preco":17}'::jsonb, 'proposta', '{"preco":18}'::jsonb)), 'cliente de outra empresa');
select pg_temp.entrar(:ADM::uuid);
select public.comp_excluir((select id from _g where k = 'a1'));
select pg_temp.ok(not exists (select 1 from com_competitividade where empresa_id = :E::uuid), 'admin exclui');
reset role;
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'execute')) = 7, 'anon continua com 7 funções');
-- base de cálculo
select pg_temp.entrar(:VEN::uuid);
select pg_temp.ok(public.comp_base(:E::uuid) ? 'reforma', 'base com a reforma');
select pg_temp.ok(public.comp_base(:E::uuid) ? 'fisc', 'vendedor liberado recebe PRODEPE/custo');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok(not (public.comp_base(:E::uuid) ? 'fisc'), 'sem liberação não recebe custo');
