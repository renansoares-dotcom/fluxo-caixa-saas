-- Conversas, etapa 2: editar, apagar (para todos / para mim), reações, menções, busca, cartões e conversa do registro.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.erro(p_sql text, p_esperado text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm not ilike '%' || p_esperado || '%' then raise exception 'esperava "%", veio "%"', p_esperado, sqlerrm; end if; return; end;
  raise exception 'deveria ter falhado: %', p_sql;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
\set EA '\'e000000a-0000-0000-0000-000000000000\''
\set AA '\'a0000000-0000-0000-0000-00000000000a\''
\set LA '\'c0000000-0000-0000-0000-00000000000c\''
\set FA '\'d0000000-0000-0000-0000-00000000000d\''
\set CA '\'f0000000-0000-0000-0000-00000000000f\''
\set AB '\'b0000000-0000-0000-0000-00000000000b\''
select id as lanc from lancamentos where empresa_id = :EA limit 1 \gset

-- editar e apagar
select pg_temp.entrar(:AA);
select chat_abrir_direta(:EA, :FA) as d \gset
select (chat_enviar(:'d', 'texto original com palavra-chave orçamento')).id as m1 \gset
select (chat_enviar(:'d', 'responde', null, '[]', :'m1')).id as m2 \gset
select pg_temp.ok((select resposta_a from chat_mensagens where id = :'m2') = :'m1', 'resposta ligada à mensagem');
select chat_editar(:'m1', 'texto corrigido com orçamento');
select pg_temp.ok((select editado_em is not null and texto = 'texto corrigido com orçamento' from chat_mensagens where id = :'m1'), 'editou');
reset role;
select pg_temp.ok((select count(*) from chat_historico where mensagem_id = :'m1' and acao = 'edicao' and texto like 'texto original%') = 1, 'original guardado no histórico');
select pg_temp.entrar(:FA);
select pg_temp.erro($$select chat_editar('$$ || :'m1' || $$', 'intruso')$$, 'Só quem enviou');
select pg_temp.erro($$select chat_apagar('$$ || :'m1' || $$', true)$$, 'Só quem enviou');
select pg_temp.ok((select count(*) from chat_buscar(:EA, 'orçamento')) = 1, 'busca acha pela palavra');
select chat_reagir(:'m1', '👍');
select chat_reagir(:'m1', '❤️');
select pg_temp.ok((select emoji from chat_reacoes where mensagem_id = :'m1') = '❤️', 'trocar a reação');
select chat_favoritar(:'m1', true);
select pg_temp.ok((select count(*) from chat_favoritas) = 1, 'favorita só minha');
select chat_apagar(:'m2', false);
select pg_temp.ok(not exists (select 1 from chat_mensagens where id = :'m2'), 'apagada para mim some só para mim');
reset role;
select pg_temp.entrar(:LA);
select pg_temp.ok((select count(*) from chat_buscar(:EA, 'orçamento')) = 0, 'quem não participa não acha na busca');
select pg_temp.ok((select count(*) from chat_reacoes) = 0, 'quem não participa não vê reações');
reset role;
select pg_temp.entrar(:AA);
select pg_temp.ok(exists (select 1 from chat_mensagens where id = :'m2'), 'para o autor a mensagem continua');
select pg_temp.ok((select count(*) from chat_favoritas) = 0, 'não vejo a favorita dos outros');
select chat_apagar(:'m1', true);
select pg_temp.ok((select texto is null and apagado_em is not null from chat_mensagens where id = :'m1'), 'apagada para todos');
select pg_temp.erro($$select chat_reagir('$$ || :'m1' || $$', '😀')$$, 'Não dá para reagir');
reset role;
select pg_temp.ok((select count(*) from chat_reacoes where mensagem_id = :'m1') = 0, 'reações da apagada saem');
select pg_temp.ok((select count(*) from chat_historico where mensagem_id = :'m1' and acao = 'apagada') = 1, 'original da apagada guardado');
-- passou do prazo
update chat_mensagens set criado_em = now() - interval '20 minutes' where id = :'m2';
select pg_temp.entrar(:AA);
select pg_temp.erro($$select chat_editar('$$ || :'m2' || $$', 'tarde')$$, '15 minutos');
reset role;
set role authenticated; select pg_temp.erro('select count(*) from chat_historico', 'permission denied'); reset role;

-- menção fura o silêncio
select pg_temp.entrar(:FA);
select chat_preferencias(:'d', '9999-12-31', null, null, false);
reset role;
delete from notificacoes;
select pg_temp.entrar(:AA);
select chat_enviar(:'d', 'sem menção');
select chat_enviar(:'d', '@financeiro olha isso', null, '[]', null, array[:FA, :AB]::uuid[]);
reset role;
select pg_temp.ok((select count(*) from notificacoes where user_id = :FA) = 1, 'silenciada: só a menção avisa');
select pg_temp.ok((select mencoes from chat_mensagens where texto = '@financeiro olha isso') = array[:FA]::uuid[], 'menção só a quem participa');
select pg_temp.entrar(:FA);
select pg_temp.ok((select mencoes from chat_resumo(:EA) where id = :'d') = 1, 'contador de menções');
reset role;

-- cartões e conversa do registro
select pg_temp.entrar(:AA);
select pg_temp.ok((select count(*) from chat_cartoes(jsonb_build_array(jsonb_build_object('tipo', 'lancamento', 'id', :'lanc')))) = 1, 'cartão do lançamento');
select chat_registro('lancamento', :'lanc') as r \gset
select pg_temp.ok(chat_registro('lancamento', :'lanc') = :'r', 'uma conversa por registro');
select chat_enviar(:'r', 'sobre este lançamento');
select pg_temp.ok((select tipo from chat_resumo(:EA) where id = :'r') = 'registro', 'aparece na lista como registro');
reset role;
select pg_temp.entrar(:CA);
select pg_temp.erro($$select chat_registro('lancamento', '$$ || :'lanc' || $$')$$, 'não tem acesso');
select pg_temp.ok((select count(*) from chat_cartoes(jsonb_build_array(jsonb_build_object('tipo', 'lancamento', 'id', :'lanc')))) = 0, 'compras não vê o cartão do lançamento');
select chat_abrir_direta(:EA, :AA) as dc \gset
select pg_temp.erro($$select chat_enviar('$$ || :'dc' || $$', null, null, '[]', null, '{}', jsonb_build_object('tipo', 'lancamento', 'id', '$$ || :'lanc' || $$'))$$, 'não tem acesso');
reset role;
select pg_temp.entrar(:AB);
select pg_temp.erro($$select chat_registro('lancamento', '$$ || :'lanc' || $$')$$, 'não tem acesso');
reset role;
select pg_temp.entrar(:LA);
select pg_temp.ok(chat_registro('lancamento', :'lanc') = :'r', 'leitura vê o lançamento e entra na conversa');
select pg_temp.ok(exists (select 1 from chat_mensagens where conversa_id = :'r'), 'e lê o que foi dito');
reset role;
-- visto por último
select pg_temp.entrar(:FA); select chat_visto(false); reset role;
select pg_temp.entrar(:AA); select chat_visto();
select pg_temp.ok((select visto_em from chat_contatos(:EA) where user_id = :FA) is null, 'quem esconde não aparece');
reset role;
select pg_temp.entrar(:FA);
select pg_temp.ok((select visto_em from chat_contatos(:EA) where user_id = :AA) is null, 'quem esconde também não vê');
reset role;
\o
select 'conversas etapa 2: ok' as resultado;
