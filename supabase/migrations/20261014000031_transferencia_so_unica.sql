-- =====================================================================
-- Etapa 7: transferência nova só no formato único (origem → destino)
--  - não aceita mais lançar transferência de entrada (3.01) nem transferência de saída sem conta de destino
--  - as 22 pontas antigas que ficaram sem par continuam podendo ser corrigidas/excluídas (a regra vale só para inclusão)
-- =====================================================================
create or replace function public._transf_so_unica() returns trigger
language plpgsql set search_path = public as $$
declare p plano_contas;
begin
  select * into p from plano_contas where id = new.plano_id;
  if p.tipo = 'T' then
    if p.natureza = 'C' then
      raise exception 'Transferência agora é um lançamento só: use o plano de transferência de saída (3.02) com a conta de origem e a de destino.';
    end if;
    if new.conta_destino_id is null then
      raise exception 'Informe a conta de destino da transferência (De → Para).';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists transf_so_unica on public.lancamentos;
create trigger transf_so_unica before insert on public.lancamentos for each row execute function public._transf_so_unica();
