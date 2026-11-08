-- Programação inteligente (melhoria 6.2 do plano de melhoria contínua) — 08/11/2026.
-- Aditivo. O que impede cada etapa de OP de começar e a sequência por máquina:
--   • prod_prontidao(empresa): para cada etapa aberta, os impedimentos —
--       arte não aprovada (pré-impressão), clichê não recebido, tinta não preparada (ordem de tinta aprovada
--       ou tinta pronta em estoque), material da estrutura sem saldo (reservado na ordem de entrega/prioridade)
--       e o aviso de etapa anterior em aberto —, com as cores do produto e quanto cada uma escurece (0 claro, 100 escuro);
--   • prod_prog_aplicar(maquina, etapas[], inicio, trocas_min[]): grava a sequência na máquina (ordem_maquina) e as datas
--     previstas, enchendo cada dia até as horas do setor;
--   • prod_prog_config: o que conta como impedimento, os minutos de troca de cor e de limpeza escuro → claro,
--     a janela de entrega em que a ordem pode mudar por causa da cor, o horizonte e o setor de impressão.
-- A sequência sugerida é calculada na tela (js/lib/programacao-calc.js) com esses dados.

create table if not exists public.prod_prog_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  considerar_arte boolean not null default true,
  considerar_cliche boolean not null default true,
  considerar_tinta boolean not null default true,
  considerar_material boolean not null default true,
  troca_cor_min smallint not null default 20 check (troca_cor_min between 0 and 240),          -- por cor que entra
  limpeza_escuro_claro_min smallint not null default 40 check (limpeza_escuro_claro_min between 0 and 480),
  janela_entrega_dias smallint not null default 3 check (janela_entrega_dias between 0 and 30),
  horizonte_dias smallint not null default 21 check (horizonte_dias between 1 and 90),
  setor_impressao_id uuid references public.prod_setores(id) on delete set null,                 -- vazio: o setor com "impress" no nome
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.prod_prog_config enable row level security;
drop policy if exists prod_prog_config_sel on public.prod_prog_config;
drop policy if exists prod_prog_config_ins on public.prod_prog_config;
drop policy if exists prod_prog_config_upd on public.prod_prog_config;
create policy prod_prog_config_sel on public.prod_prog_config for select to authenticated using (public.is_participante(empresa_id));
create policy prod_prog_config_ins on public.prod_prog_config for insert to authenticated with check (public.pode_pcp(empresa_id));
create policy prod_prog_config_upd on public.prod_prog_config for update to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id));
grant select, insert, update on public.prod_prog_config to authenticated;
drop trigger if exists zz_auditoria on public.prod_prog_config;
create trigger zz_auditoria after insert or update or delete on public.prod_prog_config for each row execute function public._auditar();

-- a posição da etapa na fila da máquina (1 = a próxima)
alter table public.prod_ordem_etapas add column if not exists ordem_maquina int;
create index if not exists prod_etapas_fila on public.prod_ordem_etapas(maquina_id, ordem_maquina) where status <> 'concluida';

-- quanto a cor escurece: pelo L* do laboratório ou, sem ele, pela luminância do hex
create or replace function public._cor_escuridao(p_l numeric, p_hex text) returns numeric language sql immutable as $$
  select case when p_l is not null then greatest(0, least(100, round(100 - p_l, 1)))
    when p_hex ~* '^#?[0-9a-f]{6}$' then round(100 - (0.2126 * ('x' || substr(ltrim(p_hex, '#'), 1, 2))::bit(8)::int
      + 0.7152 * ('x' || substr(ltrim(p_hex, '#'), 3, 2))::bit(8)::int + 0.0722 * ('x' || substr(ltrim(p_hex, '#'), 5, 2))::bit(8)::int) / 2.55, 1)
    else 50 end
$$;

create or replace function public.prod_prontidao(p_empresa uuid)
returns table(etapa_id uuid, ordem_id uuid, numero int, maquina_id uuid, setor_id uuid, seq smallint, impressao boolean,
              impedimentos jsonb, avisos jsonb, cores jsonb, escuridao numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare cfg prod_prog_config; v_set uuid;
begin
  if not public.is_participante(p_empresa) then raise exception 'Sem permissão.'; end if;
  select * into cfg from prod_prog_config where empresa_id = p_empresa;
  if cfg.empresa_id is null then cfg := row(p_empresa, true, true, true, true, 20, 40, 3, 21, null, now(), null)::prod_prog_config; end if;
  v_set := coalesce(cfg.setor_impressao_id, (select s.id from prod_setores s where s.empresa_id = p_empresa and semacento_lower(s.nome) like '%impress%' order by s.ordem limit 1));
  return query
  with ops as (
    select o.* from prod_ordens o where o.empresa_id = p_empresa and o.status in ('planejada', 'liberada', 'em_producao')),
  ets as (
    select e.*, o.produto_id, o.quantidade qtd_op, o.entrega, o.prioridade, o.numero op_numero,
      (v_set is not null and e.setor_id = v_set) imp,
      (select pe.status <> 'concluida' from prod_ordem_etapas pe where pe.ordem_id = e.ordem_id and pe.seq < e.seq order by pe.seq desc limit 1) ant_aberta,
      (select s.nome from prod_ordem_etapas pe join prod_setores s on s.id = pe.setor_id where pe.ordem_id = e.ordem_id and pe.seq < e.seq order by pe.seq desc limit 1) ant_nome
    from prod_ordem_etapas e join ops o on o.id = e.ordem_id where e.status <> 'concluida'),
  -- projeto de arte: o da OP; sem ele, o mais recente do produto
  proj as (
    select distinct on (t.id) t.id etapa, p.numero pnum, p.situacao, p.tipo, p.cliche_recebido_em, p.cliche_previsto
    from ets t join pre_projetos p on p.empresa_id = p_empresa and not p.arquivado and p.situacao <> 'cancelada' and (p.ordem_id = t.ordem_id or (t.produto_id is not null and p.produto_id = t.produto_id))
    order by t.id, (p.ordem_id = t.ordem_id) desc, p.criado_em desc),
  cores as (
    select t.id etapa, c.id cor_id, c.codigo, c.nome, c.hex, _cor_escuridao(c.lab_l, c.hex) esc, pc.consumo_g_kg, c.produto_id tinta_prod,
      exists (select 1 from tin_ordens tor where tor.ordem_id = t.ordem_id and tor.cor_id = c.id and tor.situacao in ('aprovada', 'entregue', 'encerrada')) pronta_op,
      coalesce((select sum(s.quantidade) from est_saldos s where s.produto_id = c.produto_id and s.quantidade > 0
        and not exists (select 1 from est_lotes l where l.id = s.lote_id and l.bloqueado)), 0) saldo_kg
    from ets t join tin_produto_cores pc on pc.produto_id = t.produto_id join tin_cores c on c.id = pc.cor_id where pc.empresa_id = p_empresa),
  -- material: necessidade da OP pela estrutura, reservada na ordem de entrega e prioridade (uma vez por OP)
  nec as (
    select o.id ordem_id, pe.componente_id, pr.codigo, pr.descricao, pr.unidade,
      pe.quantidade / pe.base * o.quantidade * (1 + pe.perda_pct / 100) q, o.entrega, o.prioridade, o.numero
    from ops o join produto_estrutura pe on pe.produto_id = o.produto_id join produtos pr on pr.id = pe.componente_id
    where not exists (select 1 from prod_ordem_etapas x where x.ordem_id = o.id and x.seq = 1 and x.status <> 'aguardando')),   -- já começou: material já saiu
  disp as (
    select s.produto_id, sum(s.quantidade) q from est_saldos s join est_locais l on l.id = s.local_id
    where s.empresa_id = p_empresa and l.controla_saldo and l.finalidade in ('materia_prima', 'insumo', 'processo') and s.quantidade > 0
      and not exists (select 1 from est_lotes lt where lt.id = s.lote_id and lt.bloqueado)
    group by s.produto_id),
  falta as (
    select n.ordem_id, n.codigo, n.descricao, n.unidade, n.q, coalesce(d.q, 0) disp,
      sum(n.q) over (partition by n.componente_id order by n.entrega nulls last, n.prioridade, n.numero) acum
    from nec n left join disp d on d.produto_id = n.componente_id)
  select t.id, t.ordem_id, t.op_numero, t.maquina_id, t.setor_id, t.seq, t.imp,
    coalesce((select jsonb_agg(i) from (
      -- arte e clichê só na impressão
      select jsonb_build_object('tipo', 'arte', 'texto', 'Arte não aprovada (projeto nº ' || pj.pnum || ': ' || replace(pj.situacao, '_', ' ') || ')') i
        from proj pj where cfg.considerar_arte and t.imp and pj.etapa = t.id and pj.situacao in ('em_criacao', 'aguardando_cliente', 'alteracao_solicitada', 'reprovada')
      union all
      select jsonb_build_object('tipo', 'cliche', 'texto', 'Clichê não recebido' || coalesce(' (previsto ' || to_char(pj.cliche_previsto, 'DD/MM') || ')', ''))
        from proj pj where cfg.considerar_cliche and t.imp and pj.etapa = t.id and pj.tipo <> 'reimpressao' and pj.cliche_recebido_em is null
          and pj.situacao in ('aprovada', 'na_clicheria')
      union all
      select jsonb_build_object('tipo', 'tinta', 'texto', 'Tinta ' || c.codigo || ' não preparada')
        from cores c where cfg.considerar_tinta and t.imp and c.etapa = t.id and not c.pronta_op
          and c.saldo_kg < coalesce(c.consumo_g_kg * t.qtd_op / 1000, 0.001)
      union all
      select jsonb_build_object('tipo', 'material', 'texto', f.codigo || ' sem saldo: faltam ' || trim(to_char(least(f.q, f.acum - f.disp), 'FM999G999G990D0')) || ' ' || coalesce(f.unidade, ''))
        from falta f where cfg.considerar_material and f.ordem_id = t.ordem_id and t.seq = (select min(x.seq) from prod_ordem_etapas x where x.ordem_id = t.ordem_id and x.status <> 'concluida')
          and f.acum > f.disp + 0.0005
    ) z), '[]'::jsonb),
    case when t.ant_aberta then jsonb_build_array(jsonb_build_object('tipo', 'etapa', 'texto', 'Aguarda a etapa anterior (' || coalesce(t.ant_nome, '') || ')')) else '[]'::jsonb end,
    coalesce((select jsonb_agg(jsonb_build_object('id', c.cor_id, 'codigo', c.codigo, 'nome', c.nome, 'hex', c.hex, 'esc', c.esc) order by c.esc) from cores c where c.etapa = t.id), '[]'::jsonb),
    (select max(c.esc) from cores c where c.etapa = t.id)
  from ets t;
end $$;
revoke all on function public.prod_prontidao(uuid) from public, anon;
grant execute on function public.prod_prontidao(uuid) to authenticated;

-- grava a fila da máquina: a ordem e as datas, enchendo cada dia até as horas do setor
create or replace function public.prod_prog_aplicar(p_maquina uuid, p_etapas uuid[], p_inicio date, p_trocas_min int[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare m prod_maquinas; v_hd numeric; v_dia date := p_inicio; v_usado numeric := 0; v_h numeric; v_n int := 0; e prod_ordem_etapas; i int;
begin
  select * into m from prod_maquinas where id = p_maquina;
  if m.id is null or not public.pode_pcp(m.empresa_id) then raise exception 'Sem permissão.'; end if;
  if p_inicio is null or p_inicio < current_date - 1 then raise exception 'Informe o início (hoje ou depois).'; end if;
  if coalesce(array_length(p_etapas, 1), 0) = 0 then raise exception 'Nenhuma etapa na sequência.'; end if;
  if (select count(distinct x) from unnest(p_etapas) x) <> array_length(p_etapas, 1) then raise exception 'Etapa repetida na sequência.'; end if;
  select greatest(coalesce(horas_dia, 24), 1) into v_hd from prod_setores where id = m.setor_id;
  -- quem sai da fila desta máquina perde a posição
  update prod_ordem_etapas set ordem_maquina = null where maquina_id = p_maquina and status <> 'concluida' and not (id = any(p_etapas));
  for i in 1 .. array_length(p_etapas, 1) loop
    select * into e from prod_ordem_etapas where id = p_etapas[i] and empresa_id = m.empresa_id;
    if e.id is null then raise exception 'Etapa não encontrada.'; end if;
    if e.setor_id <> m.setor_id then raise exception 'A etapa % não é do setor da máquina.', e.seq; end if;
    if e.status = 'concluida' then raise exception 'Etapa já concluída.'; end if;
    v_h := coalesce(e.horas_previstas, 0) + coalesce(p_trocas_min[i], 0) / 60.0;   -- a troca de cor entra no tempo da etapa
    if v_usado > 0 and v_usado + v_h > v_hd then v_dia := v_dia + 1; v_usado := 0; end if;
    update prod_ordem_etapas set maquina_id = p_maquina, ordem_maquina = i, inicio_previsto = v_dia,
      fim_previsto = v_dia + greatest(ceil((v_usado + v_h) / v_hd)::int - 1, 0) where id = e.id;
    v_usado := v_usado + v_h;
    while v_usado > v_hd loop v_dia := v_dia + 1; v_usado := v_usado - v_hd; end loop;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.prod_prog_aplicar(uuid, uuid[], date, int[]) from public, anon;
grant execute on function public.prod_prog_aplicar(uuid, uuid[], date, int[]) to authenticated;

select (select count(*) from pg_proc where proname in ('prod_prontidao', 'prod_prog_aplicar', '_cor_escuridao')) as funcoes;
