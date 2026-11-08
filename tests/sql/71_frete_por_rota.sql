-- Frete próprio × terceirizado por rota (SQL 135): custo da frota pelo km × custo/km, fretes pelas notas da carga ou da ficha,
-- rateio pelo peso, R$/t por rota, sugestão com a diferença mínima, economia, agrupamento por UF e acesso.
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
create or replace function pg_temp.xml(p_uf text, p_mun text, p_peso numeric) returns text language sql as $$
  select format('<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe><dest><enderDest><xMun>%s</xMun><UF>%s</UF></enderDest></dest><transp><modFrete>0</modFrete><vol><pesoB>%s</pesoB></vol></transp></infNFe></NFe></nfeProc>', p_mun, p_uf, p_peso)
$$;
\set E '''e000000a-0000-0000-0000-000000000000'''
insert into log_parametros(empresa_id) values (:E) on conflict (empresa_id) do nothing;
update log_parametros set comp_rota_por = 'municipio', comp_meses = 6, comp_dif_pct = 10, comp_min_t = 1, diesel_rs_l = 6 where empresa_id = :E;
select pg_temp.falha($$update log_parametros set comp_rota_por = 'bairro' where empresa_id = 'e000000a-0000-0000-0000-000000000000'$$, 'rota inválida');
set session_replication_role = replica;
insert into log_veiculos(id, empresa_id, codigo, carga_kg, custo_km, consumo_km_l) values
  ('71000000-0000-0000-0000-0000000000b1', :E, 'TRK-71', 12000, 4.00, null), ('71000000-0000-0000-0000-0000000000b2', :E, 'VUC-71', 3000, null, 8);
-- notas: Recife 4 t + 2 t (frota), Recife 3 t (terceiro pela ficha), Caruaru 5 t (frota) e 5 t (terceiro pela carga), Natal 2 t (terceiro, ficha sem nota)
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, dest_uf, xml) values
  ('71000000-0000-0000-0000-0000000000c1', :E, '71C1', 97101, current_date - 20, 'saida', true, 'autorizada', 'PE', pg_temp.xml('PE', 'Recife', 4000)),
  ('71000000-0000-0000-0000-0000000000c2', :E, '71C2', 97102, current_date - 20, 'saida', true, 'autorizada', 'PE', pg_temp.xml('PE', 'Recife', 2000)),
  ('71000000-0000-0000-0000-0000000000c3', :E, '71C3', 97103, current_date - 15, 'saida', true, 'autorizada', 'PE', pg_temp.xml('PE', 'Recife', 3000)),
  ('71000000-0000-0000-0000-0000000000c4', :E, '71C4', 97104, current_date - 10, 'saida', true, 'autorizada', 'PE', pg_temp.xml('PE', 'Caruaru', 5000)),
  ('71000000-0000-0000-0000-0000000000c5', :E, '71C5', 97105, current_date - 10, 'saida', true, 'autorizada', 'PE', pg_temp.xml('PE', 'Caruaru', 5000));
insert into log_cargas(id, empresa_id, numero, data, veiculo_id, status, km_previsto, km_real, frete_previsto) values
  ('71000000-0000-0000-0000-0000000000a1', :E, 97101, current_date - 19, '71000000-0000-0000-0000-0000000000b1', 'concluida', 280, 300, null),   -- 300 × 4 = 1.200 (Recife 6 t → 200/t)
  ('71000000-0000-0000-0000-0000000000a2', :E, 97102, current_date - 9, '71000000-0000-0000-0000-0000000000b2', 'concluida', 240, null, null),   -- 240 / 8 × 6 = 180 (Caruaru 5 t → 36/t)
  ('71000000-0000-0000-0000-0000000000a3', :E, 97103, current_date - 9, null, 'planejada', 100, null, 999),                                     -- não saiu: fora
  ('71000000-0000-0000-0000-0000000000a4', :E, 97104, current_date - 9, '71000000-0000-0000-0000-0000000000b1', 'concluida', 200, null, null);  -- tem frete de terceiro: conta como terceiro
insert into log_carga_notas(empresa_id, carga_id, nota_id, seq) values
  (:E, '71000000-0000-0000-0000-0000000000a1', '71000000-0000-0000-0000-0000000000c1', 1), (:E, '71000000-0000-0000-0000-0000000000a1', '71000000-0000-0000-0000-0000000000c2', 2),
  (:E, '71000000-0000-0000-0000-0000000000a2', '71000000-0000-0000-0000-0000000000c4', 1), (:E, '71000000-0000-0000-0000-0000000000a4', '71000000-0000-0000-0000-0000000000c5', 1);
insert into log_fretes(empresa_id, numero, data, carga_id, notas, destino, valor, pedagio_valor, status) values
  (:E, 97101, current_date - 14, null, 'NF 97103', 'RECIFE/PE', 420, 30, 'aberto'),                                   -- Recife 3 t: 450 → 150/t
  (:E, 97102, current_date - 9, '71000000-0000-0000-0000-0000000000a4', null, null, 900, 0, 'aberto'),                -- Caruaru 5 t: 900 → 180/t
  (:E, 97103, current_date - 5, null, null, 'Natal/RN', 2000, null, 'aberto'),                                        -- sem nota
  (:E, 97104, current_date - 5, null, 'NF 97101', null, 5000, null, 'cancelado'),                                    -- cancelado: fora
  (:E, 97105, current_date - 300, null, null, 'Recife/PE', 800, null, 'aberto');                                      -- fora do período
set session_replication_role = origin;

select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');   -- leitura vê
create temp table r as select public.log_frete_comparativo(:E) j;
reset role;
create temp table rt as select x from r, jsonb_array_elements(j -> 'rotas') x;
-- Recife: próprio 6 t, R$ 1.200, 200/t; terceiro 3 t, R$ 450, 150/t → terceirizar (−25%), economia (200−150) × 6 = 300
select pg_temp.ok((select (x -> 'proprio' ->> 'peso_kg')::numeric = 6000 and (x -> 'proprio' ->> 'custo')::numeric = 1200 and (x -> 'proprio' ->> 'rs_t')::numeric = 200
                     and (x -> 'proprio' ->> 'viagens')::int = 1 and (x -> 'proprio' ->> 'notas')::int = 2 from rt where x ->> 'rota' = 'RECIFE / PE'), 'Recife próprio');
select pg_temp.ok((select (x -> 'terceiro' ->> 'rs_t')::numeric = 150 and (x ->> 'dif_pct')::numeric = -25 and x ->> 'sugestao' = 'terceirizar' and (x ->> 'economia')::numeric = 300
                     from rt where x ->> 'rota' = 'RECIFE / PE'), 'Recife: terceirizar');
-- Caruaru: próprio 36/t; terceiro (carga com frete) 180/t → frota própria, economia (180−36) × 5 = 720
select pg_temp.ok((select (x -> 'proprio' ->> 'rs_t')::numeric = 36 and (x -> 'terceiro' ->> 'rs_t')::numeric = 180 and x ->> 'sugestao' = 'frota_propria' and (x ->> 'economia')::numeric = 720
                     from rt where x ->> 'rota' = 'CARUARU / PE'), 'Caruaru: frota própria');
-- Natal: frete sem nota, sem peso → sem base
select pg_temp.ok((select (x -> 'terceiro' ->> 'custo')::numeric = 2000 and x ->> 'sugestao' = 'sem_base' and x -> 'proprio' ->> 'rs_t' is null from rt where x ->> 'rota' = 'NATAL/RN'), 'Natal sem base');
select pg_temp.ok((select count(*) = 3 from rt), 'só 3 rotas (cancelado, planejada e antigo fora)');
select pg_temp.ok((select x ->> 'rota' = 'NATAL/RN' from rt limit 1), 'maior custo primeiro');
-- diferença mínima de 30%: Recife (−25%) vira equivalente
update log_parametros set comp_dif_pct = 30 where empresa_id = :E;
select pg_temp.ok((select x ->> 'sugestao' = 'equivalente' from jsonb_array_elements(public.log_frete_comparativo(:E) -> 'rotas') x where x ->> 'rota' = 'RECIFE / PE'), 'tolerância');
-- por UF: PE junta tudo — próprio 11 t por 1.380; terceiro 8 t por 1.350
update log_parametros set comp_rota_por = 'uf' where empresa_id = :E;
select pg_temp.ok((select (x -> 'proprio' ->> 'peso_kg')::numeric = 11000 and (x -> 'proprio' ->> 'custo')::numeric = 1380 and (x -> 'terceiro' ->> 'peso_kg')::numeric = 8000
                     and (x -> 'terceiro' ->> 'custo')::numeric = 1350 from jsonb_array_elements(public.log_frete_comparativo(:E) -> 'rotas') x where x ->> 'rota' = 'PE'), 'por UF');
-- mínimo de toneladas: 7 t → nenhum lado de PE chega nos dois → sem base
update log_parametros set comp_min_t = 9 where empresa_id = :E;
select pg_temp.ok((select x ->> 'sugestao' = 'sem_base' from jsonb_array_elements(public.log_frete_comparativo(:E) -> 'rotas') x where x ->> 'rota' = 'PE'), 'mínimo de toneladas');
-- quem não vê a logística
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select public.log_frete_comparativo('e000000a-0000-0000-0000-000000000000')$$, 'outra empresa');
reset role;
\o
select 'ok 71 frete por rota';
