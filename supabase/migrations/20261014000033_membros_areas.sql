-- =====================================================================
-- Acesso por área: Financeiro (fin), CPD (cpd) e Contabilidade (cont)
--  - membros.areas = lista de áreas que o usuário enxerga no menu
--  - vazio (null) = todas as áreas → é o valor de todos os usuários atuais,
--    então NADA muda para quem já usa a plataforma até o administrador marcar
--  - não apaga nem altera nenhum dado: só acrescenta uma coluna
--  - o que cada um pode EDITAR continua sendo decidido pelo papel
--    (leitura, financeiro, diretor…), que o banco já garante
-- =====================================================================
alter table public.membros add column if not exists areas text[];

alter table public.membros drop constraint if exists membros_areas_validas;
alter table public.membros add constraint membros_areas_validas
  check (areas is null or (cardinality(areas) > 0 and areas <@ array['fin', 'cpd', 'cont']::text[]));

comment on column public.membros.areas is 'Áreas visíveis no menu (fin, cpd, cont). Nulo = todas.';

-- a lista de usuários da tela "Empresa e usuários" passa a trazer as áreas
-- (mudar as colunas de retorno exige recriar a função; a regra de quem pode ver continua a mesma)
drop function if exists public.listar_membros(uuid);
create function public.listar_membros(p_empresa uuid)
returns table(user_id uuid, email text, papel public.papel_membro, created_at timestamptz, areas text[])
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, u.email::text, m.papel, m.created_at, m.areas
  from membros m join auth.users u on u.id = m.user_id
  where m.empresa_id = p_empresa and is_membro(p_empresa)
  order by m.created_at;
$$;
