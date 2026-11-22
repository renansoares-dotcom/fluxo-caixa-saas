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
echo "concorrencia do estoque ok"
