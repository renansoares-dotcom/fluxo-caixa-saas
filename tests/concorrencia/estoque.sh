#!/bin/bash
# Concorrência no estoque: duas sessões ao mesmo tempo sobre o mesmo saldo e o mesmo movimento.
# Uso: BANCO=postgresql://... tests/concorrencia/estoque.sh   (roda depois das migrações e dos testes de banco)
set -u
BANCO="${BANCO:?informe BANCO}"
P=(psql "$BANCO" -X -q -At -v ON_ERROR_STOP=1)
E='e000000a-0000-0000-0000-000000000000'; U='f0000000-0000-0000-0000-00000000000f'; PR='c0c00000-0000-0000-0000-0000000000a1'
falhou() { echo "FALHOU (concorrência): $1"; exit 1; }

"${P[@]}" >/dev/null <<SQL || falhou "preparação"
select public._est_configurar('$E');
update est_locais set papeis = null, permite_negativo = false where empresa_id = '$E' and codigo = 'UC';
delete from est_fechamentos where empresa_id = '$E';
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade, controla_lote) values ('$PR', '$E', 'CONC-1', 'ITEM DO TESTE DE CONCORRENCIA', 'uso_consumo', 'UN', false) on conflict (id) do nothing;
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario)
  select '$E', current_date, '$PR', (select id from est_locais where empresa_id = '$E' and codigo = 'UC'), (select id from est_tipos_movimento where empresa_id = '$E' and codigo = 'COMPRA'), 100, 10
  where not exists (select 1 from est_movimentos where produto_id = '$PR');
SQL

entrar="select set_config('request.jwt.claim.sub', '$U', false); select set_config('request.jwt.claims', json_build_object('sub', '$U', 'role', 'authenticated', 'email', 'c@t.com')::text, false); set role authenticated;"
saida="insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select '$E', current_date, '$PR', (select id from est_locais where empresa_id = '$E' and codigo = 'UC'), (select id from est_tipos_movimento where empresa_id = '$E' and codigo = 'PERDA'), -60;"

# 1) duas saídas de 60 sobre um saldo de 100: só uma pode passar
( "${P[@]}" -c "$entrar" -c "begin" -c "$saida" -c "select pg_sleep(2)" -c "commit" >/tmp/conc-a.log 2>&1; echo $? >/tmp/conc-a.rc ) &
sleep 0.7
"${P[@]}" -c "$entrar" -c "$saida" >/tmp/conc-b.log 2>&1; echo $? >/tmp/conc-b.rc
wait
[ "$(cat /tmp/conc-a.rc)" = 0 ] || { cat /tmp/conc-a.log; falhou "a primeira saída devia passar"; }
[ "$(cat /tmp/conc-b.rc)" != 0 ] && grep -q "Saldo insuficiente" /tmp/conc-b.log || { cat /tmp/conc-b.log; falhou "a segunda saída devia ser barrada por saldo insuficiente"; }
[ "$("${P[@]}" -c "select quantidade::int from est_saldos where produto_id = '$PR'")" = 40 ] || falhou "saldo final devia ser 40"
[ "$("${P[@]}" -c "select (quantidade = 40 and valor = 400)::text from est_custos where produto_id = '$PR'")" = true ] || falhou "custo total devia ser 40 un. e R\$ 400"

# 2) dois estornos do mesmo movimento ao mesmo tempo: só um pode passar
M=$("${P[@]}" -c "select id from est_movimentos where produto_id = '$PR' and quantidade = -60 and estorno_de is null")
( "${P[@]}" -c "$entrar" -c "begin" -c "select public.est_estornar('$M', current_date, 'teste de concorrencia')" -c "select pg_sleep(2)" -c "commit" >/tmp/conc-a.log 2>&1; echo $? >/tmp/conc-a.rc ) &
sleep 0.7
"${P[@]}" -c "$entrar" -c "select public.est_estornar('$M', current_date, 'teste de concorrencia')" >/tmp/conc-b.log 2>&1; echo $? >/tmp/conc-b.rc
wait
[ "$(cat /tmp/conc-a.rc)" = 0 ] || { cat /tmp/conc-a.log; falhou "o primeiro estorno devia passar"; }
[ "$(cat /tmp/conc-b.rc)" != 0 ] && grep -q "estornado" /tmp/conc-b.log || { cat /tmp/conc-b.log; falhou "o segundo estorno devia ser barrado"; }
[ "$("${P[@]}" -c "select count(*) from est_movimentos where estorno_de = '$M'")" = 1 ] || falhou "devia existir um único estorno"
[ "$("${P[@]}" -c "select quantidade::int from est_saldos where produto_id = '$PR'")" = 100 ] || falhou "saldo após o estorno devia ser 100"
# 3) fechar o mês enquanto um lançamento com data do mês passado está em andamento: a posição guardada tem de incluir o lançamento
ADMIN='a0000000-0000-0000-0000-00000000000a'
entrar_adm="select set_config('request.jwt.claim.sub', '$ADMIN', false); select set_config('request.jwt.claims', json_build_object('sub', '$ADMIN', 'role', 'authenticated', 'email', 'a@t.com')::text, false); set role authenticated;"
MESP=$("${P[@]}" -c "select (date_trunc('month', current_date) - interval '1 month')::date")
ULT=$("${P[@]}" -c "select (date_trunc('month', current_date) - interval '1 day')::date")
"${P[@]}" >/dev/null <<SQL || falhou "preparação do fechamento"
delete from est_fechamentos where empresa_id = '$E'; delete from est_fechamento_saldos where empresa_id = '$E';
update est_config set dias_retroativos = null, custo_desvio_pct = null, exigir_documento = false where empresa_id = '$E';
SQL
entrada="insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario) select '$E', '$ULT', '$PR', (select id from est_locais where empresa_id = '$E' and codigo = 'UC'), (select id from est_tipos_movimento where empresa_id = '$E' and codigo = 'COMPRA'), 7, 10;"
( "${P[@]}" -c "$entrar_adm" -c "begin" -c "$entrada" -c "select pg_sleep(2)" -c "commit" >/tmp/conc-a.log 2>&1; echo $? >/tmp/conc-a.rc ) &
sleep 0.7
"${P[@]}" -c "$entrar_adm" -c "select public.est_fechar_mes('$E', '$MESP')" >/tmp/conc-b.log 2>&1; echo $? >/tmp/conc-b.rc
wait
[ "$(cat /tmp/conc-a.rc)" = 0 ] || { cat /tmp/conc-a.log; falhou "o lançamento em andamento devia terminar"; }
[ "$(cat /tmp/conc-b.rc)" = 0 ] || { cat /tmp/conc-b.log; falhou "o fechamento devia esperar e concluir"; }
[ "$("${P[@]}" -c "select (coalesce((select sum(quantidade) from est_fechamento_saldos where empresa_id = '$E' and mes = '$MESP' and produto_id = '$PR'), 0) = (select coalesce(sum(quantidade), 0) from est_movimentos where produto_id = '$PR' and data <= '$ULT'))::text")" = true ] || falhou "a posição do fechamento devia incluir o lançamento que estava em andamento"
"${P[@]}" -c "$entrar_adm" -c "$entrada" >/tmp/conc-b.log 2>&1 && falhou "lançamento em mês fechado devia ser barrado"
"${P[@]}" -c "delete from est_fechamentos where empresa_id = '$E'; delete from est_fechamento_saldos where empresa_id = '$E';" >/dev/null

# 4) estorno feito direto (como a tela do Kardex faz) de um movimento lançado por outro módulo: barrado
TIN=$("${P[@]}" -c "select m.id from tin_pesagens p join est_movimentos m on m.id = p.movimento_id where m.empresa_id = '$E' and not exists (select 1 from est_movimentos e where e.estorno_de = m.id) limit 1")
[ -n "$TIN" ] || falhou "não há pesagem de tinta com movimento para testar"
"${P[@]}" -c "$entrar_adm" -c "select public.est_estornar('$TIN', current_date, 'direto pelo Kardex')" >/tmp/conc-b.log 2>&1 && falhou "estorno direto da baixa de uma pesagem devia ser barrado"
grep -q "outro documento" /tmp/conc-b.log || { cat /tmp/conc-b.log; falhou "mensagem esperada: lançado por outro documento"; }
[ "$("${P[@]}" -c "select count(*) from est_movimentos where estorno_de = '$TIN'")" = 0 ] || falhou "não devia existir estorno da pesagem"
# 5) duas saídas com data antiga ao mesmo tempo: só uma pode passar (antes, as duas passavam e o Kardex ficava negativo num dia do meio)
PR2='c0c00000-0000-0000-0000-0000000000a2'
"${P[@]}" >/dev/null <<SQL || falhou "preparação da saída retroativa"
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade, controla_lote) values ('$PR2', '$E', 'CONC-2', 'ITEM DA SAIDA RETROATIVA', 'uso_consumo', 'UN', false) on conflict (id) do nothing;
delete from est_inv_contagens where empresa_id = '$E' and situacao in ('aberta', 'em_aprovacao');
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario)
  select '$E', current_date - d, '$PR2', (select id from est_locais where empresa_id = '$E' and codigo = 'UC'), (select id from est_tipos_movimento where empresa_id = '$E' and codigo = 'COMPRA'), 10, 10
    from (values (20), (2)) x(d) where not exists (select 1 from est_movimentos where produto_id = '$PR2');
SQL
antiga="insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select '$E', current_date - 10, '$PR2', (select id from est_locais where empresa_id = '$E' and codigo = 'UC'), (select id from est_tipos_movimento where empresa_id = '$E' and codigo = 'PERDA'), -8;"
( "${P[@]}" -c "$entrar_adm" -c "begin" -c "$antiga" -c "select pg_sleep(2)" -c "commit" >/tmp/conc-a.log 2>&1; echo $? >/tmp/conc-a.rc ) &
sleep 0.7
"${P[@]}" -c "$entrar_adm" -c "$antiga" >/tmp/conc-b.log 2>&1; echo $? >/tmp/conc-b.rc
wait
[ "$(cat /tmp/conc-a.rc)" = 0 ] || { cat /tmp/conc-a.log; falhou "a primeira saída retroativa devia passar"; }
[ "$(cat /tmp/conc-b.rc)" != 0 ] && grep -q "Saldo insuficiente" /tmp/conc-b.log || { cat /tmp/conc-b.log; falhou "a segunda saída retroativa devia ser barrada"; }
[ "$("${P[@]}" -c "select (min(saldo_local_apos) >= 0)::text from est_movimentos where produto_id = '$PR2'")" = true ] || falhou "o Kardex não devia ter saldo negativo em nenhum dia"
echo "concorrencia do estoque ok"
