-- =====================================================================
-- Melhoria contínua 5.1 — Roteiro da implantação do estoque (08/11/2026)
-- Uma tela acompanha, com os números do banco, cada passo até o estoque oficial rodar sozinho pelas NF-e:
--   1 espelho do Iniflex · 2 locais e setores · 3 cadastro dos materiais · 4 de-para das compras · 5 regras dos CFOPs
--   6 vendas prontas · 7 saldo inicial · 8 automático e pendências · 9 primeiro fechamento do mês.
-- Cada passo pode ter responsável, data prevista e observação (est_implantacao_etapas); a situação é calculada.
-- Migração ADITIVA.
-- =====================================================================
create table if not exists public.est_implantacao_etapas (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  etapa text not null check (etapa in ('espelho', 'locais', 'cadastro', 'depara', 'cfop', 'vendas', 'saldo', 'automatico', 'fechamento')),
  responsavel text check (length(responsavel) <= 120),
  prevista date,
  observacao text check (length(observacao) <= 2000),
  dispensada boolean not null default false,            -- passo que não se aplica a esta empresa
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid(),
  primary key (empresa_id, etapa)
);
alter table public.est_implantacao_etapas enable row level security;
drop policy if exists est_implantacao_etapas_sel on public.est_implantacao_etapas;
drop policy if exists est_implantacao_etapas_ins on public.est_implantacao_etapas;
drop policy if exists est_implantacao_etapas_upd on public.est_implantacao_etapas;
drop policy if exists est_implantacao_etapas_del on public.est_implantacao_etapas;
create policy est_implantacao_etapas_sel on public.est_implantacao_etapas for select to authenticated using (public.is_participante(empresa_id));
create policy est_implantacao_etapas_ins on public.est_implantacao_etapas for insert to authenticated with check (public.pode_editar(empresa_id));
create policy est_implantacao_etapas_upd on public.est_implantacao_etapas for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy est_implantacao_etapas_del on public.est_implantacao_etapas for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.est_implantacao_etapas to authenticated;
drop trigger if exists zz_auditoria on public.est_implantacao_etapas;
create trigger zz_auditoria after insert or update or delete on public.est_implantacao_etapas for each row execute function public._auditar();

-- metas para dar um passo por concluído (ajustáveis na tela)
create table if not exists public.est_implantacao_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  meta_cadastro_pct numeric(5,2) not null default 95 check (meta_cadastro_pct between 50 and 100),  -- % do valor do espelho com produto
  meta_entrada_pct numeric(5,2) not null default 90 check (meta_entrada_pct between 50 and 100),    -- % do valor das entradas prontas
  meta_saida_pct numeric(5,2) not null default 98 check (meta_saida_pct between 50 and 100),        -- % do valor das vendas prontas
  janela_meses smallint not null default 12 check (janela_meses between 1 and 24),                  -- notas consideradas na prontidão
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.est_implantacao_config enable row level security;
drop policy if exists est_implantacao_config_sel on public.est_implantacao_config;
drop policy if exists est_implantacao_config_ins on public.est_implantacao_config;
drop policy if exists est_implantacao_config_upd on public.est_implantacao_config;
create policy est_implantacao_config_sel on public.est_implantacao_config for select to authenticated using (public.is_participante(empresa_id));
create policy est_implantacao_config_ins on public.est_implantacao_config for insert to authenticated with check (public.pode_editar(empresa_id));
create policy est_implantacao_config_upd on public.est_implantacao_config for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
grant select, insert, update on public.est_implantacao_config to authenticated;
drop trigger if exists zz_auditoria on public.est_implantacao_config;
create trigger zz_auditoria after insert or update or delete on public.est_implantacao_config for each row execute function public._auditar();

-- números de cada passo (a tela decide a situação com os limites dos parâmetros)
create or replace function public.est_implantacao_situacao(p_empresa uuid, p_desde date default (current_date - 365))
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_esp record; v_cfg record; v_pr jsonb; v_out jsonb;
begin
  if not public.is_participante(p_empresa) then raise exception 'Sem permissão.'; end if;
  select e.id, e.data_ref, e.linhas, e.valor_total, e.criado_em into v_esp
    from estoque_espelhos e where e.empresa_id = p_empresa order by e.data_ref desc, e.criado_em desc limit 1;
  select * into v_cfg from est_config where empresa_id = p_empresa;
  v_pr := public.est_prontidao(p_empresa, p_desde);
  select jsonb_build_object(
    'espelho', jsonb_build_object(
      'qtd', (select count(*) from estoque_espelhos where empresa_id = p_empresa),
      'id', v_esp.id, 'data_ref', v_esp.data_ref, 'linhas', coalesce(v_esp.linhas, 0), 'valor', v_esp.valor_total,
      'depositos', (select count(distinct deposito) from estoque_espelho_itens where espelho_id = v_esp.id)),
    'locais', jsonb_build_object(
      'ativos', (select count(*) from est_locais where empresa_id = p_empresa and ativo),
      'setores', (select count(*) from prod_setores where empresa_id = p_empresa and ativo),
      'setores_sem_local', (select count(*) from prod_setores s where s.empresa_id = p_empresa and s.ativo
                              and not exists (select 1 from est_locais l where l.empresa_id = p_empresa and l.ativo and l.setor_id = s.id))),
    'cadastro', jsonb_build_object(
      'produtos', (select count(*) from produtos where empresa_id = p_empresa),
      'nao_acabados', (select count(*) from produtos where empresa_id = p_empresa and coalesce(tipo_sped, '') <> '04'),
      'esp_linhas', (select count(*) from estoque_espelho_itens where espelho_id = v_esp.id),
      'esp_ligadas', (select count(*) from estoque_espelho_itens where espelho_id = v_esp.id and produto_id is not null),
      'esp_valor', (select coalesce(sum(valor), 0) from estoque_espelho_itens where espelho_id = v_esp.id),
      'esp_valor_ligado', (select coalesce(sum(valor), 0) from estoque_espelho_itens where espelho_id = v_esp.id and produto_id is not null),
      'sem_familia', (select count(*) from produtos where empresa_id = p_empresa and familia_id is null)),
    'depara', jsonb_build_object('qtd', (select count(*) from produto_fornecedores where empresa_id = p_empresa)),
    'prontidao', v_pr,
    'saldo', jsonb_build_object('implantado_em', v_cfg.implantado_em,
      'movimentos', (select count(*) from est_movimentos where empresa_id = p_empresa),
      'valor', (select coalesce(sum(s.valor), 0) from est_saldos s where s.empresa_id = p_empresa)),
    'automatico', jsonb_build_object('ligado', coalesce(v_cfg.automatico, false),
      'pendencias', (select count(*) from est_pendencias where empresa_id = p_empresa and status = 'aberta')),
    'fechamento', jsonb_build_object('qtd', (select count(*) from est_fechamentos where empresa_id = p_empresa),
      'ultimo', (select max(mes) from est_fechamentos where empresa_id = p_empresa)),
    'desde', p_desde
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.est_implantacao_situacao(uuid, date) from public, anon;
grant execute on function public.est_implantacao_situacao(uuid, date) to authenticated;

-- conferência: 2 tabelas e 1 função
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('est_implantacao_etapas', 'est_implantacao_config')) as tabelas,
       (select count(*) from pg_proc where proname = 'est_implantacao_situacao') as funcao;
