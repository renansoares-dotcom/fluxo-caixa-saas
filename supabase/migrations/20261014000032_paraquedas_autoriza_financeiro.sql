-- =====================================================================
-- Paraquedas: quem autoriza passa a ser o DIRETOR ou o FINANCEIRO (além do administrador)
-- =====================================================================
create or replace function public.pode_aprovar_paraquedas(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'diretor', 'financeiro'));
$$;

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
      if not pode_aprovar_paraquedas(new.empresa_id) then raise exception 'Só o diretor ou o financeiro autoriza paraquedas.'; end if;
      new.aprovado_por := auth.uid(); new.aprovado_em := now();
    elsif new.status = 'aguardando' and old.status = 'rejeitado' then
      new.aprovado_por := null; new.aprovado_em := null;     -- reenviado depois de corrigido
    elsif new.status = 'cancelado' then
      if old.status in ('pago', 'nota_recebida') then raise exception 'Paraquedas já pago não pode ser cancelado.'; end if;
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
    raise exception 'Paraquedas já aprovado: valor e dados de quem recebe não podem mudar. Cancele e lance outro.';
  end if;
  return new;
end $$;
