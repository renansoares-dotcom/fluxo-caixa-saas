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
-- 174 — padrão de relatórios: catálogo, histórico de emissões, variantes e parâmetros
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
create temp table _r (k text primary key, j jsonb, u uuid); grant all on _r to authenticated;

-- financeiro emite: nasce o código e o número 1
select pg_temp.entrar(:FIN::uuid);
insert into _r select 'e1', public.relp_emitir(:E::uuid, 'EST002', 'Kardex  por produto', 'estoque/kardex', 'pdf', 'relatorio', '[["Local","Todos"]]'::jsonb, '{"c":[]}'::jsonb);
select pg_temp.ok((select j->>'codigo' = 'EST002-R01' and (j->>'numero')::int = 1 and j->>'usuario' is not null from _r where k = 'e1'), 'primeira emissão: código R01 e número 1');
insert into _r select 'e2', public.relp_emitir(:E::uuid, 'est002', 'KARDEX POR PRODUTO', 'estoque/kardex', 'xlsx');
select pg_temp.ok((select j->>'codigo' = 'EST002-R01' and (j->>'numero')::int = 2 from _r where k = 'e2'), 'mesmo relatório (nome sem diferenciar maiúscula e espaços): mesmo código, número 2');
insert into _r select 'e3', public.relp_emitir(:E::uuid, 'EST002', 'Saldo por local', 'estoque/kardex');
select pg_temp.ok((select j->>'codigo' = 'EST002-R02' from _r where k = 'e3'), 'segundo relatório da tela: R02');
insert into _r select 'e4', public.relp_emitir(:E::uuid, null, 'Relatório avulso');
select pg_temp.ok((select j->>'codigo' = 'GER-R01' from _r where k = 'e4'), 'sem tela: GER');
select pg_temp.falha($$select public.relp_emitir('e000000a-0000-0000-0000-000000000000', 'X', 'ab')$$, 'nome curto');
select pg_temp.falha($$select public.relp_emitir('e000000a-0000-0000-0000-000000000000', 'X', 'Relatório', null, 'doc')$$, 'formato inválido');
select pg_temp.falha($$insert into relp_emissoes (empresa_id, numero, codigo, nome, tela) values ('e000000a-0000-0000-0000-000000000000', 99, 'X', 'x', 'X')$$, 'gravação direta bloqueada');
select pg_temp.ok((select count(*) = 4 from relp_emissoes), 'financeiro vê as suas 4 emissões');
select pg_temp.ok((select parametros = '[["Local","Todos"]]'::jsonb and filtros = '{"c":[]}'::jsonb and tipo = 'relatorio' from relp_emissoes where numero = 1), 'parâmetros e filtros gravados');

-- leitura emite e só vê a sua; administrador vê todas; outra empresa não vê nada
select pg_temp.entrar(:LEI::uuid);
insert into _r select 'e5', public.relp_emitir(:E::uuid, 'CMP002', 'Pedido de compra', 'compras/pedidos', 'pdf', 'documento');
select pg_temp.ok((select count(*) = 1 and min(numero) = 5 and min(tipo) = 'documento' from relp_emissoes), 'leitura vê só a sua emissão (nº 5)');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.ok((select count(*) = 5 from relp_emissoes), 'administrador vê as 5');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.ok((select count(*) = 0 from relp_emissoes), 'outra empresa não vê');
select pg_temp.falha($$select public.relp_emitir('e000000a-0000-0000-0000-000000000000', 'X', 'Relatório')$$, 'outra empresa não emite');
select pg_temp.ok((select count(*) = 4 from relp_catalogo), 'catálogo é comum (4 relatórios)');

-- variantes
select pg_temp.entrar(:FIN::uuid);
insert into _r (k, u) select 'v1', public.relp_variante_salvar(:E::uuid, null, 'EST002', 'estoque/kardex', 'Kardex mensal', '{"c":[{"k":"#kx-loc","v":""}]}'::jsonb, '[["Local","Todos"]]'::jsonb, false);
select pg_temp.falha($$select public.relp_variante_salvar('e000000a-0000-0000-0000-000000000000', null, 'EST002', 'estoque/kardex', 'kardex MENSAL', '{}'::jsonb)$$, 'nome repetido na mesma tela');
select pg_temp.falha($$select public.relp_variante_salvar('e000000a-0000-0000-0000-000000000000', null, 'EST002', 'estoque/kardex', 'Pública', '{}'::jsonb, '[]'::jsonb, true)$$, 'financeiro não publica (padrão: gerência)');
select pg_temp.falha($$select public.relp_variante_salvar('e000000a-0000-0000-0000-000000000000', null, 'EST002', 'estoque/kardex', 'x', '{}'::jsonb)$$, 'nome curto');
select pg_temp.falha($$select public.relp_variante_salvar('e000000a-0000-0000-0000-000000000000', null, 'EST002', 'estoque/kardex', 'Lista', '[]'::jsonb)$$, 'filtros têm de ser objeto');
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) = 0 from relp_variantes), 'variante particular não aparece para outro');
select pg_temp.falha(format('select public.relp_variante_excluir(%L)', (select u from _r where k = 'v1')), 'outro usuário não exclui');
select pg_temp.entrar(:ADM::uuid);
select public.relp_variante_salvar(:E::uuid, (select u from _r where k = 'v1'), 'EST002', 'estoque/kardex', 'Kardex mensal – todos', '{"c":[]}'::jsonb, '[]'::jsonb, true);
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) = 1 and min(nome) = 'Kardex mensal – todos' from relp_variantes), 'publicada pelo administrador: todos veem');

-- parâmetros
select pg_temp.falha($$select public.relp_config_salvar('e000000a-0000-0000-0000-000000000000', true, 12, 'todos', true)$$, 'leitura não muda parâmetros');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha($$select public.relp_config_salvar('e000000a-0000-0000-0000-000000000000', true, 0, 'todos', true)$$, 'meses fora da faixa');
select public.relp_config_salvar(:E::uuid, false, 12, 'todos', false);
select pg_temp.entrar(:FIN::uuid);
insert into _r select 'e6', public.relp_emitir(:E::uuid, 'EST002', 'Kardex por produto');
select pg_temp.ok((select j->>'numero' is null and j->>'codigo' = 'EST002-R01' and j->>'cnpj' is null from _r where k = 'e6'), 'registro desligado: sem número, com código; CNPJ fora do cabeçalho');
select public.relp_variante_salvar(:E::uuid, null, 'EST002', 'estoque/kardex', 'Minha pública', '{}'::jsonb, '[]'::jsonb, true);
select pg_temp.ok((select count(*) = 2 from relp_variantes where publica), 'com "todos", o financeiro publica');
select public.relp_variante_excluir((select id from relp_variantes where nome = 'Minha pública'));

-- limpeza: apaga o que passou do prazo da empresa
reset role;
update relp_emissoes set emitido_em = now() - interval '13 months' where numero in (1, 2);
select pg_temp.ok(public._relp_limpar() = 2, 'limpeza apagou as 2 emissões com mais de 12 meses');
select pg_temp.ok((select count(*) = 3 from relp_emissoes), 'ficaram 3');
\o
\echo a6_relatorios_padrao ok
