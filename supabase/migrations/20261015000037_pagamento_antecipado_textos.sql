-- =====================================================================
-- "Paraquedas" passa a se chamar "Pagamento Antecipado" (PA nº) nas mensagens do banco
--  - só troca textos de avisos e de erros; regras, tabelas e dados continuam iguais
-- =====================================================================
create or replace function public._paraquedas_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(max(numero), 0) + 1 into new.numero from paraquedas where empresa_id = new.empresa_id;
    new.status := 'aguardando'; new.aprovado_por := null; new.aprovado_em := null;
    new.criado_por := auth.uid(); new.cnpj := nullif(regexp_replace(coalesce(new.cnpj, ''), '\D', '', 'g'), '');
    return new;
  end if;
  new.atualizado_em := now(); new.numero := old.numero; new.criado_por := old.criado_por;
  new.cnpj := nullif(regexp_replace(coalesce(new.cnpj, ''), '\D', '', 'g'), '');
  if new.status is distinct from old.status then
    if new.status in ('aprovado', 'rejeitado') and old.status = 'aguardando' then
      if not pode_aprovar_paraquedas(new.empresa_id) then raise exception 'Só o diretor ou o financeiro autoriza pagamento antecipado.'; end if;
      new.aprovado_por := auth.uid(); new.aprovado_em := now();
    elsif new.status = 'aguardando' and old.status = 'rejeitado' then
      new.aprovado_por := null; new.aprovado_em := null;     -- reenviado depois de corrigido
    elsif new.status = 'cancelado' then
      if old.status in ('pago', 'nota_recebida') then raise exception 'Pagamento antecipado já pago não pode ser cancelado.'; end if;
    elsif new.status in ('pago', 'nota_recebida') and old.status in ('aprovado', 'pago') then
      null;
    else
      raise exception 'Mudança de situação não permitida: % → %', old.status, new.status;
    end if;
  end if;
  -- depois de aprovado, valor e recebedor só mudam voltando para aprovação
  if old.status <> 'aguardando' and old.status <> 'rejeitado' and new.status not in ('aguardando')
     and (new.valor is distinct from old.valor or new.razao_social is distinct from old.razao_social or new.cnpj is distinct from old.cnpj
          or new.pix_chave is distinct from old.pix_chave or new.conta_bancaria is distinct from old.conta_bancaria) then
    raise exception 'Pagamento antecipado já autorizado: valor e dados de quem recebe não podem mudar. Cancele e lance outro.';
  end if;
  return new;
end $$;

create or replace function public._paraquedas_notifica() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  aprovadores uuid[]; v text; dt text; resumo text;
begin
  select array_agg(user_id) into aprovadores from membros where empresa_id = new.empresa_id and papel::text in ('admin', 'diretor', 'financeiro');
  v := 'R$ ' || translate(to_char(new.valor, 'FM999,999,999,990.00'), ',.', '.,');
  dt := to_char(new.data_pagamento, 'DD/MM');
  resumo := new.razao_social || ' — ' || v || ' · pagar em ' || dt;
  if tg_op = 'INSERT' or (new.status = 'aguardando' and old.status = 'rejeitado') then
    perform _notificar(new.empresa_id, aprovadores, 'paraquedas_novo',
      case when new.prioridade = 'urgente' then 'URGENTE · ' else '' end || 'Pagamento antecipado PA nº ' || new.numero
        || case when tg_op = 'INSERT' then ' aguardando autorização' else ' reenviado para autorização' end,
      resumo, '#/paraquedas', new.id);
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'aprovado' then
      perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_aprovado', 'Pagamento antecipado PA nº ' || new.numero || ' autorizado', resumo, '#/paraquedas', new.id);
    elsif new.status = 'rejeitado' then
      perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_rejeitado', 'Pagamento antecipado PA nº ' || new.numero || ' recusado',
        coalesce(new.motivo, 'sem motivo informado') || ' · ' || resumo, '#/paraquedas', new.id);
    elsif new.status = 'pago' then
      perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_pago', 'Pagamento antecipado PA nº ' || new.numero || ' pago', resumo, '#/paraquedas', new.id);
    elsif new.status = 'cancelado' then
      perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_cancelado', 'Pagamento antecipado PA nº ' || new.numero || ' cancelado',
        coalesce(new.motivo, '') || ' · ' || resumo, '#/paraquedas', new.id);
    end if;
  end if;
  if new.comprovante_path is not null and new.comprovante_path is distinct from old.comprovante_path then
    perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_comprovante', 'Comprovante do pagamento antecipado PA nº ' || new.numero || ' anexado', resumo, '#/paraquedas', new.id);
  end if;
  return new;
end $$;
