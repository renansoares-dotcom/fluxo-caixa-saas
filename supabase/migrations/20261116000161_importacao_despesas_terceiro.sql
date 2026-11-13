-- Importação: despesas da planilha de custo do intermediário (SQL 161). Pedido do Renan em 16/11/2026.
-- 1) Três tipos de despesa que faltavam: direito antidumping, taxas do conhecimento (BL) e taxa Suframa.
-- 2) Em processo por meio de terceiro a despesa não gera conta a pagar: quem paga é o intermediário e o valor já está nos repasses.
-- Aditivo: troca a lista de tipos aceitos (só acrescenta) e a função do gatilho das despesas.

alter table public.imp_despesas drop constraint if exists imp_despesas_categoria_check;
alter table public.imp_despesas add constraint imp_despesas_categoria_check check (categoria in ('ii', 'ipi', 'pis', 'cofins', 'icms', 'siscomex', 'afrmm', 'frete_internacional', 'seguro', 'capatazia',
  'armazenagem', 'despachante', 'frete_interno', 'demurrage', 'bancaria', 'multa', 'outras', 'antidumping', 'taxa_bl', 'suframa'));

create or replace function public._imp_titulo_despesa() returns trigger
language plpgsql security definer set search_path = public as $$
declare p imp_processos; c imp_config; v_plano uuid; v_desc text; l lancamentos;
  v_nomes jsonb := '{"ii":"Imposto de Importação","ipi":"IPI","pis":"PIS","cofins":"COFINS","icms":"ICMS","siscomex":"Taxa Siscomex","afrmm":"AFRMM","frete_internacional":"Frete internacional","seguro":"Seguro","capatazia":"Capatazia","armazenagem":"Armazenagem","despachante":"Despachante","frete_interno":"Frete interno","demurrage":"Demurrage","bancaria":"Despesa bancária","multa":"Multa","outras":"Outras despesas","antidumping":"Direito antidumping","taxa_bl":"Taxas do conhecimento (BL)","suframa":"Taxa Suframa"}';
begin
  if tg_op = 'DELETE' then
    if old.lancamento_id is not null then
      if old.pago and auth.uid() is not null and exists (select 1 from imp_processos where id = old.processo_id) then raise exception 'Despesa já paga: desmarque o pagamento antes de excluir.'; end if;
    end if;
    return old;
  end if;
  select * into p from imp_processos where id = new.processo_id;
  select * into c from imp_config where empresa_id = new.empresa_id;
  if new.conta_id is not null and not exists (select 1 from contas where id = new.conta_id and empresa_id = new.empresa_id) then raise exception 'Conta bancária inválida para esta empresa.'; end if;
  if new.item_id is not null and not exists (select 1 from imp_itens where id = new.item_id and processo_id = new.processo_id) then raise exception 'O item não é deste processo.'; end if;
  if tg_op = 'INSERT' and new.compoe_custo then                             -- imposto recuperável nasce fora do custo (pode ser mudado depois)
    if (new.categoria = 'icms' and coalesce(c.recupera_icms, true)) or (new.categoria = 'ipi' and coalesce(c.recupera_ipi, true))
       or (new.categoria in ('pis', 'cofins') and coalesce(c.recupera_pis_cofins, true)) or new.categoria in ('bancaria', 'multa', 'demurrage') then
      new.compoe_custo := false;
    end if;
  end if;
  v_plano := case when new.categoria in ('ii', 'ipi', 'pis', 'cofins', 'icms', 'siscomex', 'afrmm', 'antidumping', 'suframa') then coalesce(c.plano_impostos_id, c.plano_despesas_id)
                  when new.categoria = 'bancaria' then coalesce(c.plano_bancarias_id, c.plano_despesas_id) else c.plano_despesas_id end;
  if p.modalidade = 'terceiro' then return new; end if;                      -- quem paga a despesa é o intermediário: ela já está nos repasses, não vira conta a pagar
  if not coalesce(c.gerar_titulos, true) or v_plano is null or new.valor = 0 then return new; end if;
  v_desc := left(format('IMP %s — %s%s', p.numero, v_nomes ->> new.categoria, case when coalesce(new.descricao, '') <> '' then ' — ' || new.descricao else '' end), 250);
  if new.lancamento_id is not null then select * into l from lancamentos where id = new.lancamento_id; end if;
  if l.id is null then
    insert into lancamentos (empresa_id, data, plano_id, descricao, favorecido_id, centro_custo_id, status, conta_id, valor, origem, documento)
    values (new.empresa_id, case when new.pago then new.data_pagamento else new.vencimento end, v_plano, v_desc, new.favorecido_id, c.centro_custo_id,
            case when new.pago then 'Pago' else 'Em aberto' end, case when new.pago then new.conta_id end, new.valor, 'importacao', coalesce(new.documento, 'IMP ' || p.numero))
    returning id into new.lancamento_id;
  elsif new.pago then
    update lancamentos set data = new.data_pagamento, status = 'Pago', conta_id = coalesce(new.conta_id, conta_id), valor = new.valor, descricao = v_desc, favorecido_id = new.favorecido_id where id = l.id;
  elsif tg_op = 'UPDATE' and old.pago then
    update lancamentos set data = new.vencimento, status = 'Em aberto', conta_id = null, valor = new.valor, descricao = v_desc, favorecido_id = new.favorecido_id where id = l.id;
  elsif l.status = 'Em aberto' then
    update lancamentos set data = new.vencimento, valor = new.valor, descricao = v_desc, favorecido_id = new.favorecido_id where id = l.id;
  end if;
  return new;
end $$;
