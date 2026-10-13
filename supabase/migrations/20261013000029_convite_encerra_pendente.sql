-- criar_convite: quando a pessoa já tem conta e entra direto na empresa,
-- encerra qualquer convite pendente dela nesta empresa (senão o convite antigo
-- poderia trocar o papel no primeiro login).
create or replace function public.criar_convite(p_empresa uuid, p_email text, p_papel public.papel_membro default 'financeiro')
returns json language plpgsql security definer set search_path = public, auth as $$
declare v_email text := lower(trim(p_email)); v_uid uuid; v_token text;
begin
  if not is_admin(p_empresa) then raise exception 'Apenas administradores podem convidar usuários'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido: %', p_email; end if;
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is not null then
    insert into membros(empresa_id, user_id, papel) values (p_empresa, v_uid, p_papel)
      on conflict (empresa_id, user_id) do update set papel = excluded.papel;
    update convites set cancelado_em = now()
     where empresa_id = p_empresa and lower(email) = v_email and aceito_em is null and cancelado_em is null;
    return json_build_object('tipo', 'membro');
  end if;
  update convites set papel = p_papel, expira_em = now() + interval '14 days', criado_por = auth.uid(), criado_em = now()
   where empresa_id = p_empresa and lower(email) = v_email and aceito_em is null and cancelado_em is null
  returning token into v_token;
  if v_token is null then
    insert into convites(empresa_id, email, papel) values (p_empresa, v_email, p_papel) returning token into v_token;
  end if;
  return json_build_object('tipo', 'convite', 'token', v_token);
end $$;
