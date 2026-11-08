-- IQF do fornecedor (SQL 134): qualidade, entrega e preço/nota, pesos, reponderação, classes, período e acesso.
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
insert into compras_parametros(empresa_id) values (:E) on conflict (empresa_id) do nothing;
update compras_parametros set iqf_peso_qualidade = 40, iqf_peso_entrega = 35, iqf_peso_preco = 25, iqf_meses = 12, iqf_meta = 80, iqf_faixa_a = 90,
  iqf_pontos_dia_atraso = 10, iqf_min_eventos = 3, conf_tol_entrega_dias = 2 where empresa_id = :E;
select pg_temp.falha($$update compras_parametros set iqf_peso_qualidade = 0, iqf_peso_entrega = 0, iqf_peso_preco = 0 where empresa_id = 'e000000a-0000-0000-0000-000000000000'$$, 'pesos zerados');
insert into favorecidos(id, empresa_id, tipo, nome) values
  ('70000000-0000-0000-0000-0000000000f1', :E, 'FORNECEDORES', 'FORN 70 BOM'), ('70000000-0000-0000-0000-0000000000f2', :E, 'FORNECEDORES', 'FORN 70 RUIM'),
  ('70000000-0000-0000-0000-0000000000f3', :E, 'FORNECEDORES', 'FORN 70 NOVO');
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade) values ('70000000-0000-0000-0000-0000000000d1', :E, 'IQF-70', 'RESINA IQF', 'materia_prima', 'KG');
set session_replication_role = replica;
-- qualidade: BOM 100, 100; RUIM 50, 0; uma antiga (fora dos 12 meses) não conta
insert into qual_inspecoes(empresa_id, numero, etapa, origem, produto_id, situacao, fornecedor_id, decidida_em) values
  (:E, 97001, 'recebimento', 'manual', '70000000-0000-0000-0000-0000000000d1', 'aprovada', '70000000-0000-0000-0000-0000000000f1', now() - interval '10 days'),
  (:E, 97002, 'recebimento', 'manual', '70000000-0000-0000-0000-0000000000d1', 'aprovada', '70000000-0000-0000-0000-0000000000f1', now() - interval '40 days'),
  (:E, 97003, 'recebimento', 'manual', '70000000-0000-0000-0000-0000000000d1', 'aprovada_concessao', '70000000-0000-0000-0000-0000000000f2', now() - interval '10 days'),
  (:E, 97004, 'recebimento', 'manual', '70000000-0000-0000-0000-0000000000d1', 'reprovada', '70000000-0000-0000-0000-0000000000f2', now() - interval '20 days'),
  (:E, 97005, 'recebimento', 'manual', '70000000-0000-0000-0000-0000000000d1', 'reprovada', '70000000-0000-0000-0000-0000000000f1', now() - interval '400 days'),
  (:E, 97006, 'recebimento', 'manual', '70000000-0000-0000-0000-0000000000d1', 'pendente', '70000000-0000-0000-0000-0000000000f2', null);
-- entrega: BOM no prazo (2 dias de tolerância); RUIM 5 dias atrasado (5-2=3 → 70) e 20 dias (→ 0); NOVO no prazo
insert into compras_pedidos(id, empresa_id, numero, favorecido_id, data_pedido, entrega_prevista, status) values
  ('70000000-0000-0000-0000-0000000000a1', :E, 97001, '70000000-0000-0000-0000-0000000000f1', current_date - 30, current_date - 12, 'recebido'),
  ('70000000-0000-0000-0000-0000000000a2', :E, 97002, '70000000-0000-0000-0000-0000000000f2', current_date - 30, current_date - 15, 'recebido'),
  ('70000000-0000-0000-0000-0000000000a3', :E, 97003, '70000000-0000-0000-0000-0000000000f2', current_date - 60, current_date - 40, 'recebido'),
  ('70000000-0000-0000-0000-0000000000a4', :E, 97004, '70000000-0000-0000-0000-0000000000f3', current_date - 10, current_date - 3, 'recebido');
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao) values
  ('70000000-0000-0000-0000-0000000000c1', :E, '70C1', 97011, current_date - 11, 'entrada', false, 'autorizada'),
  ('70000000-0000-0000-0000-0000000000c2', :E, '70C2', 97012, current_date - 11, 'entrada', false, 'autorizada');
insert into compras_recebimentos(empresa_id, pedido_id, nfe_nota_id, data, divergencias) values
  (:E, '70000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000c1', current_date - 11, '[{"tipo":"entrega","bloqueia":false,"texto":"x"}]'),
  (:E, '70000000-0000-0000-0000-0000000000a1', null, current_date - 5, '[]'),                       -- 2º recebimento não conta na entrega; sem nota não conta no preço
  (:E, '70000000-0000-0000-0000-0000000000a2', '70000000-0000-0000-0000-0000000000c2', current_date - 10, '[{"tipo":"preco","bloqueia":true,"texto":"preço acima"}]'),
  (:E, '70000000-0000-0000-0000-0000000000a3', null, current_date - 20, '[]'),
  (:E, '70000000-0000-0000-0000-0000000000a4', null, current_date - 3, '[]');
set session_replication_role = origin;

select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');   -- leitura vê
create temp table r as select x from jsonb_array_elements(public.compras_iqf(:E)) x where x ->> 'nome' like 'FORN 70%';
reset role;
-- BOM: qualidade 100 (2), entrega 100 (1), preço 100 (1) → IQF 100, classe A
select pg_temp.ok((select (x ->> 'qualidade')::numeric = 100 and (x ->> 'n_qualidade')::int = 2 and (x ->> 'entrega')::numeric = 100 and (x ->> 'n_entrega')::int = 1
                     and (x ->> 'preco')::numeric = 100 and (x ->> 'iqf')::numeric = 100 and x ->> 'classe' = 'A' from r where x ->> 'nome' = 'FORN 70 BOM'), 'bom: A 100');
-- RUIM: qualidade 25, entrega (70+0)/2 = 35, preço 0 → (25*40 + 35*35 + 0*25)/100 = 22,3 → C
select pg_temp.ok((select (x ->> 'qualidade')::numeric = 25 and (x ->> 'entrega')::numeric = 35 and (x ->> 'preco')::numeric = 0 and (x ->> 'iqf')::numeric = 22.3 and x ->> 'classe' = 'C'
                     from r where x ->> 'nome' = 'FORN 70 RUIM'), 'ruim: C 22,3');
-- NOVO: só entrega (100), 1 evento → reponderado 100, classe N (poucos dados)
select pg_temp.ok((select (x ->> 'iqf')::numeric = 100 and x ->> 'qualidade' is null and x ->> 'classe' = 'N' from r where x ->> 'nome' = 'FORN 70 NOVO'), 'novo: N');
select pg_temp.ok((select x ->> 'nome' = 'FORN 70 RUIM' from r limit 1), 'pior primeiro');
select pg_temp.ok((select x -> 'eventos' = 'null'::jsonb from r limit 1), 'lista sem eventos');
-- detalhe com os eventos
select pg_temp.ok((select jsonb_array_length(public.compras_iqf(:E, '70000000-0000-0000-0000-0000000000f2') -> 0 -> 'eventos') = 5), '5 eventos do ruim');
select pg_temp.ok((select (public.compras_iqf(:E, '70000000-0000-0000-0000-0000000000f2') -> 0 -> 'eventos') @> '[{"dimensao":"entrega","nota":70}]'), 'atraso de 5 dias = 70');
-- pesos e período: só qualidade → RUIM 25; 1 mês tira a inspeção de 40 dias do BOM
update compras_parametros set iqf_peso_entrega = 0, iqf_peso_preco = 0, iqf_meses = 1, iqf_min_eventos = 1 where empresa_id = :E;
select pg_temp.ok((select (x ->> 'iqf')::numeric = 25 from jsonb_array_elements(public.compras_iqf(:E)) x where x ->> 'nome' = 'FORN 70 RUIM'), 'só qualidade');
select pg_temp.ok((select (x ->> 'n_qualidade')::int = 1 from jsonb_array_elements(public.compras_iqf(:E)) x where x ->> 'nome' = 'FORN 70 BOM'), 'período de 1 mês');
-- outra empresa não lê
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select public.compras_iqf('e000000a-0000-0000-0000-000000000000')$$, 'outra empresa');
reset role;
\o
select 'ok 70 iqf do fornecedor';
