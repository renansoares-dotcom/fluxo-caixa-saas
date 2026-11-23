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
-- 195 — arquivo morto: pastas dentro da caixa e digitalização em PDF
\set E '''e000000a-0000-0000-0000-000000000000'''
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
create temp table _g (k text primary key, id uuid, t text); grant all on _g to authenticated;
create function pg_temp.g(k text) returns uuid language sql as $$ select id from _g where _g.k = $1 $$;
create function pg_temp.c(k text) returns text language sql as $$ select t from _g where _g.k = $1 $$;
grant execute on function pg_temp.g(text), pg_temp.c(text) to authenticated;

select pg_temp.entrar(:ADM::uuid);
select public.arq_config_salvar(:E::uuid, '{}');   -- padrão: compras só consulta
select public.arq_configurar(:E::uuid);
insert into _g(k, id) select 'cxf', public.arq_caixa_salvar(:E::uuid, jsonb_build_object('area', 'fiscal', 'titulo', 'Notas C1',
  'itens', jsonb_build_array(jsonb_build_object('tipo_id', (select id from arq_tipos where empresa_id = :E::uuid and nome = 'Notas fiscais de entrada e saída'), 'inicio', '2021-01-01', 'fim', '2021-12-31'))));
insert into _g(k, id) select 'cxr', public.arq_caixa_salvar(:E::uuid, jsonb_build_object('area', 'rh', 'titulo', 'Rescisões C1'));

-- ============================================================ pastas
select pg_temp.falha(format('select public.arq_pasta_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('caixa_id', pg_temp.g('cxf'), 'titulo', 'x')), 'título curto');
select pg_temp.falha(format('select public.arq_pasta_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('caixa_id', pg_temp.g('cxf'), 'titulo', 'Janeiro', 'inicio', '2021-02-01', 'fim', '2021-01-01')), 'período invertido');
insert into _g(k, id) select 'p1', public.arq_pasta_salvar(:E::uuid, jsonb_build_object('caixa_id', pg_temp.g('cxf'), 'titulo', 'Notas de janeiro', 'inicio', '2021-01-01', 'fim', '2021-01-31'));
insert into _g(k, id) select 'p2', public.arq_pasta_salvar(:E::uuid, jsonb_build_object('caixa_id', pg_temp.g('cxf'), 'titulo', 'Notas de fevereiro'));
insert into _g(k, id) select 'pr', public.arq_pasta_salvar(:E::uuid, jsonb_build_object('caixa_id', pg_temp.g('cxr'), 'titulo', 'Rescisão de Fulano'));
reset role;
select pg_temp.ok((select numero = 1 and etiqueta ~ '^F\d{7,}$' from arq_pastas where id = pg_temp.g('p1')) and (select numero = 2 from arq_pastas where id = pg_temp.g('p2')), 'pastas numeradas na caixa, etiqueta F…');
update arq_pastas set etiqueta = 'F9999999' where id = pg_temp.g('p1');
select pg_temp.ok((select etiqueta <> 'F9999999' from arq_pastas where id = pg_temp.g('p1')), 'a etiqueta da pasta não muda');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok((select count(*) = 0 from arq_pastas where id = pg_temp.g('pr')), 'financeiro não vê a pasta do RH');
select pg_temp.falha(format('select public.arq_pasta_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('caixa_id', pg_temp.g('cxr'), 'titulo', 'Outra rescisão')), 'financeiro criando pasta no RH');
select pg_temp.entrar(:LEI::uuid);
select pg_temp.falha(format('select public.arq_pasta_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', jsonb_build_object('caixa_id', pg_temp.g('cxf'), 'titulo', 'Março')), 'leitura criando pasta');

-- ============================================================ armazenamento e registro do PDF
select pg_temp.entrar(:FIN::uuid);
insert into _g(k, t) select 'cam1', :E || '/' || pg_temp.g('cxf') || '/' || pg_temp.g('p1') || '/' || gen_random_uuid() || '.pdf';
insert into storage.objects(bucket_id, name, metadata) values ('arquivo', pg_temp.c('cam1'), '{"size": 120000, "mimetype": "application/pdf"}');
select pg_temp.falha(format('insert into storage.objects(bucket_id, name) values (%L, %L)', 'arquivo', 'e000000a-0000-0000-0000-000000000000/' || pg_temp.g('cxr') || '/' || pg_temp.g('pr') || '/x.pdf'), 'financeiro enviando PDF para pasta do RH');
select pg_temp.falha(format('insert into storage.objects(bucket_id, name) values (%L, %L)', 'arquivo', 'e000000a-0000-0000-0000-000000000000/' || pg_temp.g('cxr') || '/' || pg_temp.g('p1') || '/x.pdf'), 'caminho com a caixa errada');
select pg_temp.falha(format('insert into storage.objects(bucket_id, name) values (%L, %L)', 'arquivo', 'e000000a-0000-0000-0000-000000000000/' || pg_temp.g('p1') || '/x.pdf'), 'caminho sem a caixa');
select pg_temp.falha(format('select public.arq_arquivo_registrar(%L, %L, %L)', pg_temp.g('p2'), pg_temp.c('cam1'), 'jan.pdf'), 'registrar o arquivo em outra pasta');
select pg_temp.falha(format('select public.arq_arquivo_registrar(%L, %L, %L)', pg_temp.g('p1'), pg_temp.c('cam1') || 'x', 'jan.pdf'), 'registrar arquivo que não foi enviado');
insert into _g(k, id) select 'a1', public.arq_arquivo_registrar(pg_temp.g('p1'), pg_temp.c('cam1'), 'Notas jan 2021.pdf');
select pg_temp.falha(format('select public.arq_arquivo_registrar(%L, %L, %L)', pg_temp.g('p1'), pg_temp.c('cam1'), 'de novo.pdf'), 'registrar o mesmo arquivo duas vezes');
select pg_temp.ok((select tamanho = 120000 and nome = 'Notas jan 2021.pdf' from arq_arquivos where id = pg_temp.g('a1')), 'tamanho vem do armazenamento');
select pg_temp.falha($$insert into arq_arquivos(empresa_id, pasta_id, caminho, nome) select empresa_id, id, 'x', 'x' from arq_pastas limit 1$$, 'gravar direto na tabela');
select pg_temp.falha(format('select public.arq_pasta_excluir(%L)', pg_temp.g('p1')), 'excluir pasta com arquivo');

-- quem vê: compras (consulta) vê e baixa; leitura e outra empresa não
select pg_temp.entrar(:CMP::uuid);
select pg_temp.ok((select count(*) = 1 from arq_arquivos where pasta_id = pg_temp.g('p1')) and (select count(*) = 1 from storage.objects where bucket_id = 'arquivo' and name = pg_temp.c('cam1')), 'quem consulta vê e baixa o PDF');
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) = 0 from storage.objects where bucket_id = 'arquivo') and (select count(*) = 0 from arq_arquivos), 'perfil de leitura não vê os PDFs');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.ok((select count(*) = 0 from storage.objects where bucket_id = 'arquivo') and (select count(*) = 0 from arq_pastas), 'outra empresa não vê');

-- apagar: primeiro o registro, depois o arquivo
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.arq_arquivo_excluir(%L)', pg_temp.g('a1')), 'quem só consulta apagando');
select pg_temp.entrar(:FIN::uuid);
delete from storage.objects where bucket_id = 'arquivo' and name = pg_temp.c('cam1');
reset role;
select pg_temp.ok((select count(*) = 1 from storage.objects where name = pg_temp.c('cam1')), 'o arquivo registrado não é apagado direto do armazenamento');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok(public.arq_arquivo_excluir(pg_temp.g('a1')) = pg_temp.c('cam1'), 'registro apagado devolve o caminho');
delete from storage.objects where bucket_id = 'arquivo' and name = pg_temp.c('cam1');
reset role;
select pg_temp.ok((select count(*) = 0 from storage.objects where name = pg_temp.c('cam1')), 'arquivo apagado do armazenamento');
select pg_temp.entrar(:FIN::uuid);
select public.arq_pasta_excluir(pg_temp.g('p1'));

-- parâmetros: tamanho da etiqueta da pasta
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha($$select public.arq_config_salvar('e000000a-0000-0000-0000-000000000000', '{"pasta_altura_mm": 5}')$$, 'etiqueta da pasta pequena demais');
select public.arq_config_salvar(:E::uuid, '{"pasta_largura_mm": 80, "pasta_altura_mm": 30}');
select pg_temp.ok((select pasta_largura_mm = 80 and pasta_altura_mm = 30 and papeis_gestor = '{admin,financeiro,diretor}' from arq_config where empresa_id = :E::uuid), 'tamanho da etiqueta da pasta salvo');
select public.arq_config_salvar(:E::uuid, '{}');
select pg_temp.ok((select pasta_largura_mm = 80 from arq_config where empresa_id = :E::uuid), 'salvar sem o tamanho mantém o tamanho');
reset role;
\o
\echo c1_arquivo_pastas ok
