-- Pré-impressão (SQL 089): numeração, versão imutável com hash, checklist antes de ir ao cliente, situação só pelas funções,
-- portal (lista, ficha sem notas internas, pino, decisão só da última versão enviada, aprovar exige declaração e nome,
-- prova com hash/termo, upload do cliente volta para a equipe), decisão registrada por fora com evidência, clicheria vira
-- ferramenta, liberação por papel, trava da OP, isolamento entre clientes e entre empresas.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'teste@exemplo.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- dados: empresa B, dois clientes, um usuário do portal de cada, um produto e uma OP
insert into auth.users(id, email) values ('ee000000-0000-0000-0000-000000000001', 'compras@cliente-um.exemplo'), ('ee000000-0000-0000-0000-000000000002', 'compras@cliente-dois.exemplo');
insert into favorecidos(id, empresa_id, nome, documento) values
  ('ef000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'CLIENTE UM ALIMENTOS', '11222333000181'),
  ('ef000000-0000-0000-0000-000000000002', 'e000000b-0000-0000-0000-000000000000', 'CLIENTE DOIS BEBIDAS', '44555666000172');
insert into portal_usuarios(empresa_id, user_id, favorecido_id, email) values
  ('e000000b-0000-0000-0000-000000000000', 'ee000000-0000-0000-0000-000000000001', 'ef000000-0000-0000-0000-000000000001', 'compras@cliente-um.exemplo'),
  ('e000000b-0000-0000-0000-000000000000', 'ee000000-0000-0000-0000-000000000002', 'ef000000-0000-0000-0000-000000000002', 'compras@cliente-dois.exemplo');
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade) values ('e1000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'EMB-001', 'EMBALAGEM BISCOITO 200G', 'produto_acabado', 'KG');
insert into prod_ordens(id, empresa_id, numero, produto_id, quantidade, status) values ('e2000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 7001, 'e1000000-0000-0000-0000-000000000001', 1000, 'planejada');

select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
insert into pre_parametros(empresa_id, checklist, bloquear_op) values ('e000000b-0000-0000-0000-000000000000', array['Textos revisados', 'Código de barras válido'], true);
insert into pre_projetos(id, empresa_id, numero, favorecido_id, produto_id, nome, situacao, cores)
values ('e3000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 999, 'ef000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
        'Biscoito Maria 200 g', 'aprovada', '[{"nome":"Azul"},{"nome":"Vermelho"},{"nome":"Preto"}]');
select pg_temp.ok((select numero = 1 and situacao = 'em_criacao' from pre_projetos where id = 'e3000000-0000-0000-0000-000000000001'), 'numeração própria e nasce em criação');
select pg_temp.falha($q$insert into pre_projetos(empresa_id, favorecido_id, nome) values ('e000000b-0000-0000-0000-000000000000', (select id from favorecidos where empresa_id = 'e000000a-0000-0000-0000-000000000000' limit 1), 'x')$q$, 'cliente de outra empresa');
select pg_temp.falha($q$update pre_projetos set situacao = 'aprovada' where id = 'e3000000-0000-0000-0000-000000000001'$q$, 'situação só pelas funções');
select pg_temp.falha($q$insert into pre_versoes(empresa_id, projeto_id, caminho, nome, hash) values ('e000000b-0000-0000-0000-000000000000', 'e3000000-0000-0000-0000-000000000001', 'x', 'a.pdf', 'abc')$q$, 'hash SHA-256 obrigatório');

-- versão 1 (a equipe): checklist do parâmetro; não vai ao cliente com checklist pendente
insert into pre_versoes(id, empresa_id, projeto_id, caminho, nome, tipo, tamanho, hash, previa, origem, enviada_em)
values ('e4000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'e3000000-0000-0000-0000-000000000001',
        'e000000b-0000-0000-0000-000000000000/e3000000-0000-0000-0000-000000000001/v1.pdf', 'biscoito-v1.pdf', 'application/pdf', 1000, repeat('a', 64),
        'e000000b-0000-0000-0000-000000000000/e3000000-0000-0000-0000-000000000001/v1.png', 'cliente', now());
select pg_temp.ok((select numero = 1 and origem = 'interno' and enviada_em is null and jsonb_array_length(checklist) = 2 from pre_versoes where id = 'e4000000-0000-0000-0000-000000000001'),
  'numerada, origem interna, não enviada e com o checklist dos parâmetros');
select pg_temp.falha($q$update pre_versoes set hash = repeat('b', 64) where id = 'e4000000-0000-0000-0000-000000000001'$q$, 'arquivo/hash da versão não mudam');
select pg_temp.falha($q$select pre_enviar_cliente('e4000000-0000-0000-0000-000000000001')$q$, 'checklist pendente');
update pre_versoes set checklist = '[{"item":"Textos revisados","ok":true},{"item":"Código de barras válido","ok":true}]' where id = 'e4000000-0000-0000-0000-000000000001';
insert into pre_comentarios(empresa_id, versao_id, texto, interno) values ('e000000b-0000-0000-0000-000000000000', 'e4000000-0000-0000-0000-000000000001', 'Nota interna: conferir o registro', true);
select pg_temp.ok(pre_enviar_cliente('e4000000-0000-0000-0000-000000000001') = 'aguardando_cliente', 'enviada ao cliente');
select pg_temp.ok((select prazo = current_date + 3 from pre_projetos where id = 'e3000000-0000-0000-0000-000000000001'), 'prazo do cliente pelos parâmetros');
select pg_temp.falha($q$update pre_versoes set observacao = 'mudou' where id = 'e4000000-0000-0000-0000-000000000001'$q$, 'versão enviada não muda');
select pg_temp.falha($q$select pre_enviar_cliente('e4000000-0000-0000-0000-000000000001')$q$, 'não reenvia');

-- trava da OP: arte do produto aguardando o cliente
select pg_temp.falha($q$update prod_ordens set status = 'liberada' where id = 'e2000000-0000-0000-0000-000000000001'$q$, 'OP travada sem arte aprovada');

-- portal: o cliente UM vê a arte, sem a nota interna; o cliente DOIS não vê
reset role;
select pg_temp.entrar('ee000000-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) from portal_artes('ef000000-0000-0000-0000-000000000001') where pendente) = 1, 'portal lista a arte pendente');
select pg_temp.ok(_pre_arquivo('e000000b-0000-0000-0000-000000000000/e3000000-0000-0000-0000-000000000001/v1.png', false), 'cliente lê a prévia enviada');
select pg_temp.ok(not _pre_arquivo('e000000b-0000-0000-0000-000000000000/e3000000-0000-0000-0000-000000000001/rascunho.pdf', false), 'cliente não lê arquivo que não foi a ele');
select pg_temp.ok(_pre_arquivo('e000000b-0000-0000-0000-000000000000/e3000000-0000-0000-0000-000000000001/novo.pdf', true), 'cliente pode enviar arquivo na arte em aprovação');
select pg_temp.ok(jsonb_array_length(portal_arte('ef000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001') -> 'comentarios') = 0, 'nota interna não vai ao portal');
select pg_temp.ok((select count(*) from pre_projetos) = 0, 'cliente do portal não lê as tabelas internas');
select pg_temp.falha($q$select portal_arte('ef000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000001')$q$, 'outro cliente');
select pg_temp.falha($q$select portal_arte_comentar('ef000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 1.5, 0.2, 'fora')$q$, 'pino fora da arte');
select pg_temp.ok(portal_arte_comentar('ef000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 0.42, 0.18, 'Trocar "Maria" por "Maria Tradicional"') is not null, 'pino do cliente');
select pg_temp.falha($q$select portal_arte_decidir('ef000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 'aprovada', null, 'Ana Souza', false)$q$, 'aprovar exige a declaração');
select pg_temp.falha($q$select portal_arte_decidir('ef000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 'aprovada', null, '  ', true)$q$, 'aprovar exige o nome');
select pg_temp.ok(portal_arte_decidir('ef000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 'alteracao', null, null) ->> 'situacao' = 'alteracao_solicitada', 'pedido de alteração (pino conta como motivo)');
select pg_temp.falha($q$select portal_arte_decidir('ef000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 'aprovada', null, 'Ana', true)$q$, 'já decidida');

-- versão 2 da equipe: a v1 não pode mais ser decidida; a v2 é aprovada com prova
reset role;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select situacao from pre_projetos where id = 'e3000000-0000-0000-0000-000000000001') = 'alteracao_solicitada', 'situação na equipe');
insert into pre_versoes(id, empresa_id, projeto_id, caminho, nome, hash, previa, observacao, checklist)
values ('e4000000-0000-0000-0000-000000000002', 'e000000b-0000-0000-0000-000000000000', 'e3000000-0000-0000-0000-000000000001',
        'e000000b-0000-0000-0000-000000000000/e3000000-0000-0000-0000-000000000001/v2.pdf', 'biscoito-v2.pdf', repeat('c', 64),
        'e000000b-0000-0000-0000-000000000000/e3000000-0000-0000-0000-000000000001/v2.png', 'Nome do produto corrigido',
        '[{"item":"Textos revisados","ok":true},{"item":"Código de barras válido","ok":true}]');
select pre_enviar_cliente('e4000000-0000-0000-0000-000000000002');
reset role;
select pg_temp.entrar('ee000000-0000-0000-0000-000000000001');
select pg_temp.falha($q$select portal_arte_decidir('ef000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 'aprovada', null, 'Ana', true)$q$, 'versão antiga não se decide');
select pg_temp.ok(portal_arte_decidir('ef000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000002', 'aprovada', null, 'Ana Souza', true) ->> 'hash' = repeat('c', 64), 'aprovada com o hash da versão');
select pg_temp.falha($q$select portal_arte_enviar('ef000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000/e3000000-0000-0000-0000-000000000001/c.pdf', null, 'c.pdf', 'application/pdf', 10, repeat('d', 64), null)$q$, 'aprovada não recebe arquivo do cliente');
reset role;
select pg_temp.ok((select nome = 'Ana Souza' and origem = 'cliente' and termo like 'Declaro%' and hash = repeat('c', 64) and user_id = 'ee000000-0000-0000-0000-000000000001'
                   from pre_decisoes where versao_id = 'e4000000-0000-0000-0000-000000000002'), 'prova: nome, termo, hash e usuário');
select pg_temp.ok((select versao_aprovada_id = 'e4000000-0000-0000-0000-000000000002' from pre_projetos where id = 'e3000000-0000-0000-0000-000000000001'), 'versão aprovada no projeto');
select pg_temp.ok((select count(*) from pre_eventos where projeto_id = 'e3000000-0000-0000-0000-000000000001' and tipo = 'decisao') = 2, 'linha do tempo das decisões');
select pg_temp.ok((select ok from pre_arte_produto('e1000000-0000-0000-0000-000000000001')) is null, 'função da OP pede membro');

-- clicheria vira ferramenta; liberar; a OP destrava
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select ok and versao = 2 from pre_arte_produto('e1000000-0000-0000-0000-000000000001')), 'arte em vigor do produto');
update prod_ordens set status = 'liberada' where id = 'e2000000-0000-0000-0000-000000000001';
select pg_temp.falha($q$select pre_clicheria('e3000000-0000-0000-0000-000000000001', 'receber')$q$, 'receber antes de enviar');
select pre_clicheria('e3000000-0000-0000-0000-000000000001', 'enviar', null, current_date, current_date + 5, 1800);
select pg_temp.falha($q$select pre_liberar('e3000000-0000-0000-0000-000000000001')$q$, 'clichês não chegaram');
select pre_clicheria('e3000000-0000-0000-0000-000000000001', 'receber');
select pg_temp.ok((select f.tipo = 'cliche' and f.codigo = 'CL-0001-V2' and f.cores = 3 and f.favorecido_id = 'ef000000-0000-0000-0000-000000000001'
                   from pre_projetos p join prod_ferramentas f on f.id = p.ferramenta_id where p.id = 'e3000000-0000-0000-0000-000000000001'), 'clichê entra nas ferramentas');
select pg_temp.ok(pre_liberar('e3000000-0000-0000-0000-000000000001') = 'liberada', 'liberada para produção');
select pg_temp.falha($q$insert into pre_versoes(empresa_id, projeto_id, caminho, nome, hash) values ('e000000b-0000-0000-0000-000000000000', 'e3000000-0000-0000-0000-000000000001', 'x', 'a.pdf', repeat('e', 64))$q$, 'liberada não recebe versão');

-- arte do cliente DOIS: o cliente envia o arquivo; decisão por fora exige evidência
insert into pre_projetos(id, empresa_id, favorecido_id, nome) values ('e3000000-0000-0000-0000-000000000002', 'e000000b-0000-0000-0000-000000000000', 'ef000000-0000-0000-0000-000000000002', 'Rótulo Suco 1 L');
reset role;
select pg_temp.entrar('ee000000-0000-0000-0000-000000000002');
select pg_temp.falha($q$select portal_arte_enviar('ef000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000002', 'outra/pasta/a.pdf', null, 'a.pdf', 'application/pdf', 10, repeat('d', 64), null)$q$, 'caminho fora do projeto');
select pg_temp.ok(portal_arte_enviar('ef000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000002', 'e000000b-0000-0000-0000-000000000000/e3000000-0000-0000-0000-000000000002/cliente.pdf',
  null, 'suco-final.pdf', 'application/pdf', 2048, repeat('D', 64), 'Arte da nossa agência') is not null, 'cliente envia a arte');
select pg_temp.ok((select count(*) from portal_artes('ef000000-0000-0000-0000-000000000002') where not pendente) = 1, 'aparece no portal, sem pendência');
select pg_temp.ok((select count(*) from portal_artes('ef000000-0000-0000-0000-000000000001')) = 0, 'não vê as artes de outro cliente');
reset role;
select pg_temp.ok((select origem = 'cliente' and hash = repeat('d', 64) and enviado_por = 'compras@cliente-dois.exemplo' from pre_versoes where projeto_id = 'e3000000-0000-0000-0000-000000000002'), 'versão do cliente, hash em minúscula');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
insert into pre_versoes(id, empresa_id, projeto_id, caminho, nome, hash, previa, checklist) values ('e4000000-0000-0000-0000-000000000003', 'e000000b-0000-0000-0000-000000000000', 'e3000000-0000-0000-0000-000000000002', 'e000000b-0000-0000-0000-000000000000/e3000000-0000-0000-0000-000000000002/v2.pdf', 'suco-v2.pdf', repeat('f', 64), 'p.png', '[{"item":"Textos revisados","ok":true}]');
select pre_enviar_cliente('e4000000-0000-0000-0000-000000000003');
select pg_temp.falha($q$select pre_registrar_decisao('e4000000-0000-0000-0000-000000000003', 'aprovada', null, 'Carlos Lima', null)$q$, 'decisão por fora exige evidência');
select pg_temp.ok(pre_registrar_decisao('e4000000-0000-0000-0000-000000000003', 'aprovada', null, 'Carlos Lima', 'E-mail de 07/11 às 10:12') ->> 'situacao' = 'aprovada', 'decisão registrada pela equipe');
select pg_temp.ok((select origem = 'interno' and evidencia like 'E-mail%' from pre_decisoes where versao_id = 'e4000000-0000-0000-0000-000000000003'), 'origem interna com evidência');
select pg_temp.falha($q$update pre_projetos set situacao = 'cancelada' where id = 'e3000000-0000-0000-0000-000000000002'$q$, 'cancelar exige motivo');

-- leitura: vê; não cria. Empresa A não enxerga a B.
reset role;
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from pre_projetos) = 0, 'outra empresa não vê');
reset role;
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.falha($q$select pre_liberar('e3000000-0000-0000-0000-000000000001')$q$, 'outra empresa não libera');
select pg_temp.falha($q$select pre_enviar_cliente('e4000000-0000-0000-0000-000000000003')$q$, 'outra empresa não envia');
reset role;
\o
select 'pre_impressao ok';
