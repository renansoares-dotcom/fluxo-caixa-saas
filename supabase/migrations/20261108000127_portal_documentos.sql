-- Portal do Cliente: boleto, DANFE e uso (melhoria 3.5 do plano de melhoria contínua, Passo 4) — 08/11/2026.
-- Aditivo.
--   • 2ª via do boleto: o financeiro anexa o PDF do boleto e/ou a linha digitável ao título; o cliente baixa no Portal;
--   • DANFE em PDF: gerado no navegador a partir do XML autorizado (portal_nota_xml já existe);
--   • painel de uso do Portal: quem entrou, o que viu (abas, DANFE, XML, boleto, PIX, canhoto), artes respondidas e
--     pedidos de prorrogação, por acesso (registro pelo próprio Portal, sem o que foi digitado);
--   • "saiu para entrega" com rastreio já veio no App do Motorista (SQL 124).

-- 1) boletos dos títulos
create table if not exists public.portal_boletos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  lancamento_id uuid not null unique references public.lancamentos(id) on delete cascade,
  linha_digitavel text check (linha_digitavel is null or regexp_replace(linha_digitavel, '\D', '', 'g') ~ '^(\d{44}|\d{47}|\d{48})$'),
  arquivo_path text,
  vencimento date,                                       -- vencimento do boleto (pode ser a 2ª via com nova data)
  enviado_por text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  check (linha_digitavel is not null or arquivo_path is not null)
);
alter table public.portal_boletos enable row level security;
drop policy if exists portal_boletos_sel on public.portal_boletos;
drop policy if exists portal_boletos_ins on public.portal_boletos;
drop policy if exists portal_boletos_upd on public.portal_boletos;
drop policy if exists portal_boletos_del on public.portal_boletos;
create policy portal_boletos_sel on public.portal_boletos for select to authenticated using (public.is_membro(empresa_id));
create policy portal_boletos_ins on public.portal_boletos for insert to authenticated with check (public.pode_editar(empresa_id));
create policy portal_boletos_upd on public.portal_boletos for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy portal_boletos_del on public.portal_boletos for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.portal_boletos to authenticated;
drop trigger if exists zz_auditoria on public.portal_boletos;
create trigger zz_auditoria after insert or update or delete on public.portal_boletos for each row execute function public._auditar();

-- arquivos: portal/<empresa>/boletos/<lançamento>/<arquivo>.pdf (privado; link temporário)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal', 'portal', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create or replace function public._portal_boleto_meu(p_nome text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from portal_boletos b join lancamentos l on l.id = b.lancamento_id
                  where b.arquivo_path = p_nome and l.status = 'Em aberto' and portal_meu(l.favorecido_id));
$$;
revoke all on function public._portal_boleto_meu(text) from public, anon;
grant execute on function public._portal_boleto_meu(text) to authenticated;
drop policy if exists portal_arq_sel on storage.objects;
drop policy if exists portal_arq_ins on storage.objects;
drop policy if exists portal_arq_del on storage.objects;
create policy portal_arq_sel on storage.objects for select to authenticated
  using (bucket_id = 'portal' and (public.is_membro(public._uuid_ou_nulo((storage.foldername(name))[1])) or public._portal_boleto_meu(name)));
create policy portal_arq_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'portal' and public.pode_editar(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy portal_arq_del on storage.objects for delete to authenticated
  using (bucket_id = 'portal' and public.pode_editar(public._uuid_ou_nulo((storage.foldername(name))[1])));

-- títulos do Portal com o boleto (recriada: mesma lista do SQL 043 + boleto)
create or replace function public.portal_boletos_meus(p_fav uuid)
returns table(lancamento_id uuid, linha_digitavel text, arquivo_path text, vencimento date)
language sql stable security definer set search_path = public as $$
  select b.lancamento_id, b.linha_digitavel, b.arquivo_path, b.vencimento
    from portal_boletos b join lancamentos l on l.id = b.lancamento_id
   where portal_meu(p_fav) and l.favorecido_id = p_fav and l.status = 'Em aberto';
$$;
revoke all on function public.portal_boletos_meus(uuid) from public, anon;
grant execute on function public.portal_boletos_meus(uuid) to authenticated;

-- 2) o que o cliente fez no Portal
create table if not exists public.portal_eventos (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  favorecido_id uuid not null references public.favorecidos(id) on delete cascade,
  tipo text not null check (tipo in ('entrada', 'titulos', 'notas', 'entregas', 'compras', 'pedidos', 'artes', 'danfe', 'xml', 'boleto', 'pix', 'canhoto')),
  ref_id uuid,
  criado_em timestamptz not null default now()
);
create index if not exists portal_eventos_emp on public.portal_eventos(empresa_id, criado_em desc);
alter table public.portal_eventos enable row level security;
drop policy if exists portal_eventos_sel on public.portal_eventos;
create policy portal_eventos_sel on public.portal_eventos for select to authenticated using (public.is_membro(empresa_id));
grant select on public.portal_eventos to authenticated;

create or replace function public.portal_registrar(p_fav uuid, p_tipo text, p_ref uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not portal_meu(p_fav) then return; end if;                       -- não é cliente do Portal: ignora
  -- a mesma aba aberta várias vezes seguidas conta uma vez a cada 10 minutos
  if p_tipo in ('entrada', 'titulos', 'notas', 'entregas', 'compras', 'pedidos', 'artes') and exists (
       select 1 from portal_eventos where user_id = auth.uid() and favorecido_id = p_fav and tipo = p_tipo and criado_em > now() - interval '10 minutes') then return; end if;
  insert into portal_eventos(empresa_id, favorecido_id, tipo, ref_id) select f.empresa_id, f.id, p_tipo, p_ref from favorecidos f where f.id = p_fav;
end $$;
revoke all on function public.portal_registrar(uuid, text, uuid) from public, anon;
grant execute on function public.portal_registrar(uuid, text, uuid) to authenticated;

-- painel de uso: por acesso do Portal
create or replace function public.portal_uso(p_empresa uuid, p_dias int default 30)
returns table(user_id uuid, email text, cliente text, favorecido_id uuid, ativo boolean, ultimo_acesso timestamptz, dias_com_acesso bigint,
              titulos bigint, notas bigint, entregas bigint, artes bigint, danfe bigint, xml bigint, boletos bigint, pix bigint, canhotos bigint,
              artes_respondidas bigint, prorrogacoes bigint, whatsapp boolean)
language sql stable security definer set search_path = public as $$
  select pu.user_id, pu.email, f.nome, f.id, pu.ativo, pu.ultimo_acesso,
    (select count(distinct (e.criado_em at time zone 'America/Sao_Paulo')::date) from portal_eventos e where e.user_id = pu.user_id and e.favorecido_id = pu.favorecido_id and e.criado_em > now() - make_interval(days => p_dias)),
    c.titulos, c.notas, c.entregas, c.artes, c.danfe, c.xml, c.boleto, c.pix, c.canhoto,
    (select count(*) from pre_decisoes d where d.user_id = pu.user_id and d.origem = 'cliente' and d.criado_em > now() - make_interval(days => p_dias)),
    (select count(*) from portal_prorrogacoes pp where pp.solicitado_por = pu.user_id and pp.solicitado_em > now() - make_interval(days => p_dias)),
    pu.whatsapp_optin_em is not null
  from portal_usuarios pu join favorecidos f on f.id = pu.favorecido_id
  left join lateral (select count(*) filter (where tipo = 'titulos') titulos, count(*) filter (where tipo = 'notas') notas, count(*) filter (where tipo = 'entregas') entregas,
                            count(*) filter (where tipo = 'artes') artes, count(*) filter (where tipo = 'danfe') danfe, count(*) filter (where tipo = 'xml') xml,
                            count(*) filter (where tipo = 'boleto') boleto, count(*) filter (where tipo = 'pix') pix, count(*) filter (where tipo = 'canhoto') canhoto
                       from portal_eventos e where e.user_id = pu.user_id and e.favorecido_id = pu.favorecido_id and e.criado_em > now() - make_interval(days => p_dias)) c on true
  where pu.empresa_id = p_empresa and (public.pode_editar(p_empresa) or public.is_admin(p_empresa) or public.pode_aprovar_compra(p_empresa))
  order by pu.ultimo_acesso desc nulls last;
$$;
revoke all on function public.portal_uso(uuid, int) from public, anon;
grant execute on function public.portal_uso(uuid, int) to authenticated;

select (select count(*) from information_schema.tables where table_name in ('portal_boletos', 'portal_eventos')) as tabelas;
