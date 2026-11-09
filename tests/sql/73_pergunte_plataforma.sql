-- Pergunte à plataforma (SQL 137): catálogo fechado, consulta agregada com RLS, filtros só da lista, avaliação, uso e permissão.
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
insert into favorecidos(id, empresa_id, tipo, nome) values ('73000000-0000-0000-0000-0000000000f1', :E, 'CLIENTES', 'CLIENTE IA 73'), ('73000000-0000-0000-0000-0000000000f2', :E, 'FORNECEDORES', 'FORNECEDOR IA 73');
insert into lancamentos(empresa_id, data, plano_id, valor, descricao, favorecido_id, status) values
  (:E, '2031-01-10', 'f000000a-0000-0000-0000-000000000000', 1000, 'IA73 combustivel', '73000000-0000-0000-0000-0000000000f2', 'Pago'),
  (:E, '2031-01-20', 'f000000a-0000-0000-0000-000000000000', 500, 'IA73 combustivel', '73000000-0000-0000-0000-0000000000f2', 'Em aberto'),
  (:E, '2031-02-05', 'f000000a-0000-0000-0000-000000000000', 250, 'IA73 pneu', '73000000-0000-0000-0000-0000000000f1', 'Pago');
insert into nfe_notas(empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, dest_nome, dest_uf, v_nf, cfops) values
  (:E, 'IA73A', 97301, '2031-03-01', 'saida', true, 'autorizada', 'CLIENTE IA 73', 'PE', 3000, '{5101}'),
  (:E, 'IA73B', 97302, '2031-03-02', 'saida', true, 'autorizada', 'CLIENTE IA 73', 'PE', 2000, '{5101}'),
  (:E, 'IA73C', 97303, '2031-03-03', 'saida', true, 'autorizada', 'OUTRO IA 73', 'PB', 1000, '{6101}'),
  (:E, 'IA73D', 97304, '2031-03-04', 'saida', true, 'cancelada', 'CLIENTE IA 73', 'PE', 9000, '{5101}');

select pg_temp.ok((select count(*) >= 5 from jsonb_object_keys(public.ia_catalogo())), 'fontes');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');   -- financeiro
-- lançamentos por mês, só os do teste (pelo texto)
create temp table r1 as select public.ia_consultar(:E, 'lancamentos', 'valor', 'mes', '{"texto":"IA73"}', '2031-01-01', '2031-12-31') j;
select pg_temp.ok((select j -> 'linhas' = '[["2031-01", 1500], ["2031-02", 250]]'::jsonb and (j ->> 'total')::numeric = 1750 and j ->> 'link' = '#/lancamentos' from r1), 'por mês, em ordem de tempo');
select pg_temp.ok((select (public.ia_consultar(:E, 'lancamentos', 'valor', null, '{"texto":"IA73","status":"Pago"}', null, null) -> 'linhas' -> 0 ->> 1)::numeric = 1250), 'só pagos');
select pg_temp.ok((select public.ia_consultar(:E, 'lancamentos', 'quantidade', 'favorecido', '{"texto":"IA73"}', null, null) -> 'linhas' -> 0 = '["FORNECEDOR IA 73", 2]'::jsonb), 'maior primeiro');
-- notas: faturamento por cliente, canceladas fora, filtro de CFOP e UF
create temp table r2 as select public.ia_consultar(:E, 'notas', 'valor', 'cliente', '{"tipo":"saida"}', '2031-03-01', '2031-03-31') j;
select pg_temp.ok((select j -> 'linhas' = '[["CLIENTE IA 73", 5000], ["OUTRO IA 73", 1000]]'::jsonb and (j ->> 'total')::numeric = 6000 from r2), 'faturamento por cliente sem a cancelada');
select pg_temp.ok((select (public.ia_consultar(:E, 'notas', 'valor', null, '{"cfop":"6"}', '2031-03-01', '2031-03-31') ->> 'total')::numeric = 1000), 'cfop interestadual');
select pg_temp.ok((select (public.ia_consultar(:E, 'notas', 'ticket', null, '{"uf":"pe"}', '2031-03-01', '2031-03-31') -> 'linhas' -> 0 ->> 1)::numeric = 2500), 'ticket médio PE');
select pg_temp.ok((select jsonb_array_length(public.ia_consultar(:E, 'notas', 'valor', 'cliente', '{}', '2031-03-01', '2031-03-31', 'menor', 1) -> 'linhas') = 1
                     and public.ia_consultar(:E, 'notas', 'valor', 'cliente', '{}', '2031-03-01', '2031-03-31', 'menor', 1) -> 'linhas' -> 0 ->> 0 = 'OUTRO IA 73'), 'menor e limite');
-- o catálogo é fechado: fonte, medida, agrupamento e filtro fora da lista são recusados; injeção não passa
select pg_temp.falha($$select public.ia_consultar('e000000a-0000-0000-0000-000000000000', 'auth.users', 'valor')$$, 'fonte fora');
select pg_temp.falha($$select public.ia_consultar('e000000a-0000-0000-0000-000000000000', 'notas', 'sum(1)')$$, 'medida fora');
select pg_temp.falha($$select public.ia_consultar('e000000a-0000-0000-0000-000000000000', 'notas', 'valor', 'dest_doc')$$, 'agrupamento fora');
select pg_temp.falha($$select public.ia_consultar('e000000a-0000-0000-0000-000000000000', 'notas', 'valor', null, '{"xml":"x"}')$$, 'filtro fora');
select pg_temp.ok((select (public.ia_consultar(:E, 'notas', 'quantidade', null, '{"cliente":"x''; drop table nfe_notas; --"}', null, null) ->> 'total')::numeric = 0), 'aspas viram literal');
-- a consulta roda com as permissões de quem pergunta: outra empresa não
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select public.ia_consultar('e000000a-0000-0000-0000-000000000000', 'notas', 'valor')$$, 'outra empresa');
-- permissão: desligado não pode; ligado, só os perfis escolhidos; configuração só do admin
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select not public.ia_pode(:E)), 'desligado');
select pg_temp.falha($$insert into ia_config(empresa_id, ativo) values ('e000000a-0000-0000-0000-000000000000', true)$$, 'financeiro não configura');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into ia_config(empresa_id, ativo, papeis) values (:E, true, array['admin', 'financeiro']);
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select public.ia_pode(:E)), 'financeiro pode');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select not public.ia_pode(:E)), 'leitura não está nos perfis');
reset role;
-- histórico: a pessoa vê as suas e avalia; o admin vê o uso
insert into ia_perguntas(id, empresa_id, user_id, pergunta, resposta, tokens_entrada, tokens_saida, ms) values
  ('73000000-0000-0000-0000-0000000000a1', :E, 'd0000000-0000-0000-0000-00000000000d', 'quanto faturamos em março?', 'R$ 6.000,00', 1200, 300, 2100),
  ('73000000-0000-0000-0000-0000000000a2', :E, 'a0000000-0000-0000-0000-00000000000a', 'e em fevereiro?', 'R$ 0,00', 800, 100, 1500);
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select count(*) = 1 from ia_perguntas where empresa_id = :E), 'vê só as suas');
select public.ia_avaliar('73000000-0000-0000-0000-0000000000a1', 1::smallint, 'ótimo');
select pg_temp.falha($$select public.ia_avaliar('73000000-0000-0000-0000-0000000000a2', 1::smallint)$$, 'não avalia a dos outros');
select pg_temp.falha($$select public.ia_uso('e000000a-0000-0000-0000-000000000000', current_date - 1)$$, 'uso só admin');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select (u ->> 'perguntas')::int = 2 and (u ->> 'positivas')::int = 1 and (u ->> 'tokens_entrada')::int = 2000 from (select public.ia_uso(:E, current_date - 1) u) x), 'uso');
reset role;
select public._ia_limpar();
\o
select 'ok 73 pergunte à plataforma';
