-- Conversas: só quem participa lê; o administrador da empresa não lê as conversas dos outros; outra empresa não vê nada;
-- grupo respeita entrada, saída e "só administradores escrevem"; lida/não lidas; aviso sem repetição.
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
\set AB '\'b0000000-0000-0000-0000-00000000000b\''

-- conversa individual admin A ↔ leitura A
select pg_temp.entrar(:AA);
select chat_abrir_direta(:EA, :LA) as d1 \gset
select pg_temp.ok(chat_abrir_direta(:EA, :LA) = :'d1', 'abrir de novo devolve a mesma conversa');
select pg_temp.erro($$select chat_abrir_direta('e000000a-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-00000000000b')$$, 'não é da empresa');
select chat_enviar(:'d1', 'Olá, tudo bem?', 'aaaaaaaa-0000-0000-0000-000000000001');
select chat_enviar(:'d1', 'Olá, tudo bem?', 'aaaaaaaa-0000-0000-0000-000000000001');   -- reenvio da fila
select pg_temp.ok((select count(*) from chat_mensagens where conversa_id = :'d1') = 1, 'reenvio com o mesmo cliente_id não duplica');
select chat_enviar(:'d1', 'Segunda mensagem');
select pg_temp.erro($$select chat_enviar('$$ || :'d1' || $$', '   ')$$, 'vazia');
reset role;
select pg_temp.ok((select count(*) from notificacoes where user_id = :LA and tipo = 'chat') = 1, 'duas mensagens seguidas geram um aviso só');

select pg_temp.entrar(:LA);
select pg_temp.ok((select count(*) from chat_mensagens where conversa_id = :'d1') = 2, 'a outra pessoa lê as mensagens');
select pg_temp.ok((select nao_lidas from chat_resumo(:EA) where id = :'d1') = 2, '2 não lidas');
select pg_temp.ok((select nome from chat_resumo(:EA) where id = :'d1') = 'admin.a', 'na individual aparece o nome da outra pessoa');
select chat_marcar(:'d1', true);
select pg_temp.ok((select nao_lidas from chat_resumo(:EA) where id = :'d1') = 0, 'marcar como lida zera');
-- conversa leitura ↔ financeiro: o administrador da empresa não pode ler
select chat_abrir_direta(:EA, :FA) as d2 \gset
select chat_enviar(:'d2', 'Particular');
reset role;

select pg_temp.entrar(:AA);
select pg_temp.ok((select lida_ate from chat_participantes where conversa_id = :'d1' and user_id = :LA) is not null, 'quem enviou vê o ✓✓ azul');
select pg_temp.ok(not exists (select 1 from chat_mensagens where conversa_id = :'d2'), 'administrador da empresa NÃO lê conversa dos outros');
select pg_temp.ok(not exists (select 1 from chat_conversas where id = :'d2'), 'nem vê a conversa');
select pg_temp.erro($$select chat_enviar('$$ || :'d2' || $$', 'intruso')$$, 'não participa');
reset role;

select pg_temp.entrar(:AB);
select pg_temp.ok((select count(*) from chat_mensagens) = 0 and (select count(*) from chat_conversas) = 0, 'outra empresa não vê nada');
select pg_temp.ok((select count(*) from chat_resumo(:EA)) = 0, 'resumo de outra empresa vem vazio');
reset role;

-- grupo
select pg_temp.entrar(:FA);
select chat_criar_grupo(:EA, 'Financeiro', 'Equipe do financeiro', array[:AA, :AB]::uuid[]) as g \gset
select pg_temp.ok((select count(*) from chat_participantes where conversa_id = :'g') = 2, 'quem não é da empresa não entra no grupo');
select chat_enviar(:'g', 'Antes da leitura entrar');
reset role;
select pg_sleep(1.1);
select pg_temp.entrar(:LA);
select pg_temp.erro($$select chat_grupo_adicionar('$$ || :'g' || $$', array['c0000000-0000-0000-0000-00000000000c']::uuid[])$$, 'administradores');
reset role;
select pg_temp.entrar(:FA);
select pg_temp.ok(chat_grupo_adicionar(:'g', array[:LA]::uuid[]) = 1, 'administrador adiciona');
reset role;
select pg_temp.entrar(:LA);
select pg_temp.ok(not exists (select 1 from chat_mensagens where conversa_id = :'g' and texto = 'Antes da leitura entrar'), 'quem entrou não vê mensagens anteriores');
select chat_enviar(:'g', 'Cheguei');
reset role;
select pg_temp.entrar(:FA);
select chat_grupo_editar(:'g', 'Financeiro', null, true);
reset role;
select pg_temp.entrar(:LA);
select pg_temp.erro($$select chat_enviar('$$ || :'g' || $$', 'oi')$$, 'Só os administradores podem escrever');
reset role;
select pg_temp.entrar(:FA);
select chat_grupo_remover(:'g', :LA);
select chat_enviar(:'g', 'Depois que a leitura saiu');
select pg_temp.erro($$select chat_grupo_admin('$$ || :'g' || $$', 'd0000000-0000-0000-0000-00000000000d', false)$$, 'pelo menos um administrador');
reset role;
select pg_temp.entrar(:LA);
select pg_temp.ok(exists (select 1 from chat_mensagens where conversa_id = :'g' and texto = 'Cheguei'), 'quem saiu ainda lê o histórico');
select pg_temp.ok(not exists (select 1 from chat_mensagens where conversa_id = :'g' and texto = 'Depois que a leitura saiu'), 'quem saiu não lê o que veio depois');
select pg_temp.ok((select saiu from chat_resumo(:EA) where id = :'g'), 'resumo mostra que saiu');
select pg_temp.ok(not _chat_pode_anexar(:EA || '/' || :'g' || '/x.pdf'), 'quem saiu não anexa');
select pg_temp.ok(_chat_pode_anexar(:EA || '/' || :'d1' || '/x.pdf'), 'participante anexa na própria conversa');
select pg_temp.ok(not _chat_pode_anexar('e000000b-0000-0000-0000-000000000000/' || :'d1' || '/x.pdf'), 'pasta de outra empresa não');
select pg_temp.erro($$select chat_enviar('$$ || :'d1' || $$', null, null, '[{"caminho":"e000000b-0000-0000-0000-000000000000/x/y.pdf","nome":"y.pdf"}]')$$, 'fora da conversa');
reset role;

set role anon;
select pg_temp.erro('select count(*) from chat_mensagens', 'permission denied');
select pg_temp.erro($$select chat_resumo('e000000a-0000-0000-0000-000000000000')$$, 'permission denied');
reset role;
-- tentativa de gravar direto na tabela (sem a função)
select pg_temp.entrar(:AA);
select pg_temp.erro($$insert into chat_mensagens(conversa_id, empresa_id, autor_id, texto) values ('$$ || :'d1' || $$', 'e000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-00000000000a', 'x')$$, 'permission denied');
reset role;
\o
select 'conversas: ok' as resultado;
