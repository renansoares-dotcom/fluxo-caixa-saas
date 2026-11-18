-- 169 — Ligação com a Receita Federal: APIs da Apuração Assistida da CBS e DARF do RAD (18/11/2026, pedido do Renan)
-- A função rfb-cbs (Supabase) fala com https://api.receitafederal.gov.br/apuracao-cbs/v2 usando a credencial da empresa
-- guardada em segredo (RFB_CBS_CHAVE / RFB_CBS_SEGREDO). Aqui fica só o que a plataforma precisa guardar:
-- * rfb_cbs_solicitacoes: as consultas assíncronas (débitos, créditos, pagamentos, recolhimentos) com o tíquete e a situação.
--   A Receita aceita 4 solicitações por dia por serviço e devolve só o que mudou desde a última: a plataforma guarda o histórico.
-- * rfb_cbs_creditos: o crédito de CBS de cada documento como a Receita o vê (apurado, a apropriar, apropriado, utilizado, saldo credor).
-- * rfb_cbs_recolhimentos: os recolhimentos feitos como adquirente (RAD) confirmados pela Receita, por DARF e documento.
-- * rad_recolhimentos ganha os dados do DARF gerado (PIX, código de barras, link do PDF, data máxima e valores) e o título criado.
-- Quem grava é só a função (service_role). Os membros da empresa leem; pedir consulta e gerar DARF exige rfb_pode (admin ou financeiro).
-- Aditivo.

create or replace function public.rfb_pode(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.pode_editar(p_empresa);
$$;

create table if not exists public.rfb_cbs_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  api text not null check (api in ('debitos', 'creditos', 'pagamentos', 'recolhimentos')),
  tiquete text,
  situacao text not null default 'PENDENTE' check (situacao in ('PENDENTE', 'EM_PROCESSAMENTO', 'CONCLUIDA', 'ERRO', 'EXPIRADA', 'RECUSADA')),
  tea_segundos int,
  codigo_erro text, mensagem_erro text,
  importada_em timestamptz, registros int,            -- preenchidos quando o arquivo foi baixado e importado
  resumo jsonb,                                        -- cabeçalho do arquivo (geradoEm, períodos, quantidades); nunca o token nem a URL assinada
  solicitada_por uuid, solicitada_por_nome text,
  solicitada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index if not exists rfb_cbs_solicitacoes_e on public.rfb_cbs_solicitacoes(empresa_id, api, solicitada_em desc);

create table if not exists public.rfb_cbs_creditos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave text not null,
  pa text not null,                                    -- período de apuração mm/aaaa
  origem int not null default 0,                       -- 0 normal; 20–22 devoluções; 30–32 cancelamentos; 50–54 perecimento; 55 nota de crédito
  documento int,                                       -- 55 NF-e, 57 CT-e…
  emissao timestamptz, registro timestamptz, atualizacao timestamptz,
  apurado numeric(18,2) not null default 0, excedente numeric(18,2) not null default 0,
  a_apropriar numeric(18,2) not null default 0, apropriado numeric(18,2) not null default 0,
  inapropriavel numeric(18,2) not null default 0, suspenso numeric(18,2) not null default 0, prescrito numeric(18,2) not null default 0,
  utilizado numeric(18,2) not null default 0, saldo_credor numeric(18,2) not null default 0,
  dados jsonb,                                         -- o grupo "cbs" como veio
  solicitacao_id uuid references public.rfb_cbs_solicitacoes(id) on delete set null,
  recebido_em timestamptz not null default now(),
  unique (empresa_id, chave, pa, origem)
);
create index if not exists rfb_cbs_creditos_c on public.rfb_cbs_creditos(empresa_id, chave);

create table if not exists public.rfb_cbs_recolhimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero_darf text not null, sequencial int not null default 0,
  tipo int, data_arrecadacao date,
  pa text, vencimento date, ni_fornecedor text, chave text,
  principal numeric(18,2) not null default 0, multa numeric(18,2) not null default 0, juros numeric(18,2) not null default 0, total numeric(18,2) not null default 0,
  solicitacao_id uuid references public.rfb_cbs_solicitacoes(id) on delete set null,
  recebido_em timestamptz not null default now(),
  unique (empresa_id, numero_darf, sequencial)
);
create index if not exists rfb_cbs_recolhimentos_c on public.rfb_cbs_recolhimentos(empresa_id, chave);

alter table public.rad_recolhimentos add column if not exists darf_opcao text check (darf_opcao is null or darf_opcao in ('PAGAMENTO_TOTAL', 'PAGAMENTO_PARCIAL'));
alter table public.rad_recolhimentos add column if not exists darf_chave_pix text;
alter table public.rad_recolhimentos add column if not exists darf_codigo_barras text;
alter table public.rad_recolhimentos add column if not exists darf_link_pdf text;
alter table public.rad_recolhimentos add column if not exists darf_data_maxima date;
alter table public.rad_recolhimentos add column if not exists darf_valor_principal numeric(18,2);
alter table public.rad_recolhimentos add column if not exists darf_valor_total numeric(18,2);
alter table public.rad_recolhimentos add column if not exists darf_gerado_em timestamptz;
alter table public.rad_recolhimentos add column if not exists darf_gerado_por uuid;
alter table public.rad_recolhimentos add column if not exists darf_retorno text;                      -- código devolvido pela Receita na última tentativa
alter table public.rad_recolhimentos add column if not exists darf_mensagem text;
alter table public.rad_recolhimentos add column if not exists lancamento_id uuid references public.lancamentos(id) on delete set null;   -- título a pagar do DARF
alter table public.rad_recolhimentos add column if not exists recolhido_em date;                      -- confirmado pela consulta de recolhimentos
alter table public.rad_recolhimentos add column if not exists numero_darf text;

do $$ declare t text; begin
  foreach t in array array['rfb_cbs_solicitacoes', 'rfb_cbs_creditos', 'rfb_cbs_recolhimentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_membro(empresa_id))', t || '_sel', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
drop trigger if exists zz_auditoria on public.rfb_cbs_solicitacoes;
create trigger zz_auditoria after insert or update or delete on public.rfb_cbs_solicitacoes for each row execute function public._auditar();

-- ---------- o DARF do RAD foi gerado: grava os dados, muda a situação e cria o título a pagar (se a conta estiver nos parâmetros) ----------
-- só a função rfb-cbs chama (service_role); p_usuario é quem pediu na tela
create or replace function public.rad_darf_registrar(p_id uuid, p_usuario uuid, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r rad_recolhimentos; cfg rad_config; n nfe_notas; v_ok boolean := (p_dados ->> 'cdRetorno') = 'DARF_GERADO'; v_tot numeric; v_lanc uuid;
begin
  select * into r from rad_recolhimentos where id = p_id for update;
  if r.id is null then raise exception 'Recolhimento não encontrado.'; end if;
  if not v_ok then
    update rad_recolhimentos set darf_retorno = p_dados ->> 'cdRetorno', darf_mensagem = left(coalesce(p_dados ->> 'mensagem', ''), 500) where id = r.id;
    return jsonb_build_object('ok', false, 'cdRetorno', p_dados ->> 'cdRetorno');
  end if;
  v_tot := (p_dados -> 'informacoesPagamento' ->> 'valorDarfTotal')::numeric;
  select * into cfg from rad_config where empresa_id = r.empresa_id;
  select * into n from nfe_notas where id = r.nota_id;
  v_lanc := r.lancamento_id;
  if v_lanc is null and cfg.plano_darf_id is not null and coalesce(v_tot, 0) > 0 then
    insert into lancamentos(empresa_id, data, plano_id, status, valor, descricao, documento, origem)
    values (r.empresa_id, coalesce((p_dados -> 'informacoesPagamento' ->> 'dataMaximaPagamento')::date, current_date), cfg.plano_darf_id, 'Em aberto', v_tot,
            'DARF CBS — recolhimento pelo adquirente, NF ' || coalesce(n.numero::text, '') || coalesce(' ' || n.emit_nome, ''), 'RAD NF ' || coalesce(n.numero::text, ''), 'rad')
    returning id into v_lanc;
  elsif v_lanc is not null and coalesce(v_tot, 0) > 0 then   -- DARF gerado de novo: atualiza o título ainda em aberto
    update lancamentos set valor = v_tot, data = coalesce((p_dados -> 'informacoesPagamento' ->> 'dataMaximaPagamento')::date, data) where id = v_lanc and status <> 'Pago';
  end if;
  update rad_recolhimentos set situacao = 'darf_gerado', darf_opcao = p_dados ->> 'opcaoPagamento', darf_chave_pix = p_dados -> 'darf' ->> 'chavePIX', darf_codigo_barras = p_dados -> 'darf' ->> 'codigoBarras',
    darf_link_pdf = p_dados -> 'darf' ->> 'linkDarfPDF', darf_data_maxima = (p_dados -> 'informacoesPagamento' ->> 'dataMaximaPagamento')::date,
    darf_valor_principal = (p_dados -> 'informacoesPagamento' ->> 'valorDarfPrincipal')::numeric, darf_valor_total = v_tot, darf_gerado_em = now(), darf_gerado_por = p_usuario,
    darf_retorno = 'DARF_GERADO', darf_mensagem = null, lancamento_id = v_lanc where id = r.id;
  return jsonb_build_object('ok', true, 'lancamento_id', v_lanc, 'valor', v_tot);
end $$;

-- ---------- recolhimentos confirmados pela Receita: marca a nota como recolhida ----------
create or replace function public.rad_confirmar_recolhidos(p_empresa uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update rad_recolhimentos r set situacao = 'recolhido', recolhido_em = x.data_arrecadacao, numero_darf = x.numero_darf
    from (select distinct on (chave) chave, data_arrecadacao, numero_darf from rfb_cbs_recolhimentos where empresa_id = p_empresa and chave is not null order by chave, data_arrecadacao desc) x
   where r.empresa_id = p_empresa and r.chave = x.chave and r.situacao in ('marcado', 'darf_gerado');
  get diagnostics n = row_count;
  return n;
end $$;

-- a nota com DARF gerado continua aparecendo na Autorização de Pagamentos com o líquido sugerido (antes, só a "marcada")
create or replace function public.rad_titulos(p_empresa uuid) returns table (lancamento_id uuid, recolhimento_id uuid, nota_id uuid, nota_numero int, valor_cbs numeric, valor_titulo numeric, liquido_sugerido numeric)
language sql stable security definer set search_path = public as $$
  select x.lid, x.rid, x.nid, x.numero, x.cbs, x.vt, greatest(0, x.vt - x.cbs)
    from (select l.id lid, r.id rid, n.id nid, n.numero, coalesce(r.darf_valor_principal, r.valor_cbs) cbs, abs(l.valor) vt, row_number() over (partition by r.id order by l.data, l.id) ordem
            from rad_recolhimentos r join nfe_notas n on n.id = r.nota_id join nfe_vinculos v on v.nota_id = n.id join lancamentos l on l.id = v.lancamento_id
           where r.empresa_id = p_empresa and r.situacao in ('marcado', 'darf_gerado', 'recolhido') and l.status <> 'Pago' and public.is_membro(p_empresa)) x
   where x.ordem = 1;
$$;

revoke all on function public.rad_darf_registrar(uuid, uuid, jsonb), public.rad_confirmar_recolhidos(uuid) from public, anon, authenticated;
grant execute on function public.rad_darf_registrar(uuid, uuid, jsonb), public.rad_confirmar_recolhidos(uuid) to service_role;
revoke all on function public.rfb_pode(uuid) from public, anon;
grant execute on function public.rfb_pode(uuid), public.rad_titulos(uuid) to authenticated, service_role;
