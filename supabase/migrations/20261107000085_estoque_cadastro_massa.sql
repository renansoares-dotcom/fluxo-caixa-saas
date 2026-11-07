-- =====================================================================
-- Estoque — Etapa C (07/11/2026): cadastro e de-para em massa pelas NF-e de entrada, e prontidão para a implantação.
-- Situação em 07/11: 888 produtos (só os vendidos), 0 de-para e 1.580 itens de compra distintos nas notas de entrada.
-- Sem de-para, nenhuma nota de entrada movimenta o estoque. Aqui:
--  - est_classif_regras: regras editáveis (NCM e palavras → família) que sugerem a família de cada item de compra;
--  - famílias FERRAM (clichês, anilox, lâminas, facas) e NAOEST (energia, serviços, obras), com a regra "qualquer CFOP"
--    da família NAOEST que não movimenta o estoque;
--  - _est_regra aceita cfop '*' (qualquer CFOP), com a menor prioridade entre as regras do mesmo alcance;
--  - est_cadastro_massa: cria os produtos e os de-paras aprovados na tela, de uma vez, numa transação;
--  - est_prontidao: simula, sem gravar nada, o que cada item das notas faria no estoque (ok, sem produto, sem regra, sem local);
--  - o espelho do Iniflex passa a se ligar ao produto também quando o código do produto é trocado.
-- Só acrescenta. Não altera produtos, notas nem movimentos que já existem.
-- =====================================================================

-- 1) regra de CFOP para qualquer CFOP ('*'): útil para famílias inteiras (ex.: "não é estoque")
create or replace function public._est_regra(p_empresa uuid, p_cfop text, p_sentido text, p_familia uuid, p_tipo_sped text)
returns public.est_regras_cfop language sql stable security definer set search_path = public as $$
  select r.* from est_regras_cfop r
   where r.empresa_id = p_empresa and r.ativo and r.sentido = p_sentido
     and (r.cfop = p_cfop or (length(r.cfop) = 3 and r.cfop = right(p_cfop, 3)) or r.cfop = '*')
     and (r.familia_id is null or r.familia_id = p_familia) and (r.tipo_sped is null or r.tipo_sped = p_tipo_sped)
   order by (case when length(r.cfop) = 4 then 4 else 0 end + case when r.familia_id is not null then 2 else 0 end + case when r.tipo_sped is not null then 1 else 0 end) desc,
            (r.cfop = '*'), r.prioridade
   limit 1;
$$;
revoke all on function public._est_regra(uuid, text, text, uuid, text) from public, anon, authenticated;

-- 2) regras de classificação dos itens de compra (sugestão de família)
--    casa se (algum prefixo de NCM bate OU alguma palavra aparece na descrição, sem acento, com os espaços como escritos) E o valor unitário passa do mínimo;
--    regra sem NCM e sem palavras vale para tudo (use como a última). A primeira que casar (menor ordem) vence.
create table if not exists public.est_classif_regras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem int not null default 100,
  familia_id uuid not null references public.est_familias(id) on delete cascade,
  ncm_prefixos text[] not null default '{}',
  palavras text[] not null default '{}',
  valor_unit_min numeric(16,2),
  observacao text,
  ativo boolean not null default true
);
create index if not exists est_classif_emp on public.est_classif_regras(empresa_id, ordem);
alter table public.est_classif_regras enable row level security;
drop policy if exists est_classif_sel on public.est_classif_regras;
drop policy if exists est_classif_ins on public.est_classif_regras;
drop policy if exists est_classif_upd on public.est_classif_regras;
drop policy if exists est_classif_del on public.est_classif_regras;
create policy est_classif_sel on public.est_classif_regras for select to authenticated using (public.is_participante(empresa_id));
create policy est_classif_ins on public.est_classif_regras for insert to authenticated with check (public.pode_editar(empresa_id));
create policy est_classif_upd on public.est_classif_regras for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy est_classif_del on public.est_classif_regras for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.est_classif_regras to authenticated;

create or replace function public._est_classif_familia() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from est_familias where id = new.familia_id and empresa_id = new.empresa_id) then raise exception 'Família de outra empresa.'; end if;
  new.palavras := array(select upper(x) from unnest(new.palavras) x where trim(x) <> '');   -- o espaço em volta conta (' CA ' não casa com 'CARRO')
  new.ncm_prefixos := array(select regexp_replace(x, '\D', '', 'g') from unnest(new.ncm_prefixos) x where regexp_replace(x, '\D', '', 'g') <> '');
  return new;
end $$;
drop trigger if exists est_classif_familia on public.est_classif_regras;
create trigger est_classif_familia before insert or update on public.est_classif_regras for each row execute function public._est_classif_familia();

-- 3) famílias novas, regra "não é estoque" e regras de classificação de partida (sem duplicar)
create or replace function public._est_cadastro_padrao(p_empresa uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int := 0; f record; v_fam uuid;
begin
  if not exists (select 1 from est_familias where empresa_id = p_empresa) then return 0; end if;   -- estoque ainda não configurado
  insert into est_familias(empresa_id, codigo, nome, tipo_sped, local_padrao_id, controla_lote)
  values (p_empresa, 'FERRAM', 'Ferramental (clichês, anilox, lâminas, facas)', '10', (select id from est_locais where empresa_id = p_empresa and codigo = 'INS'), false),
         (p_empresa, 'NAOEST', 'Não é estoque (energia, serviços, obras)', '99', null, false)
  on conflict (empresa_id, codigo) do nothing;
  -- a família NAOEST não movimenta, com qualquer CFOP de entrada
  select id into v_fam from est_familias where empresa_id = p_empresa and codigo = 'NAOEST';
  if not exists (select 1 from est_regras_cfop where empresa_id = p_empresa and cfop = '*' and sentido = 'entrada' and familia_id = v_fam) then
    insert into est_regras_cfop(empresa_id, cfop, sentido, familia_id, tipo_movimento_id, prioridade, observacao)
    values (p_empresa, '*', 'entrada', v_fam, null, 10, 'Não é estoque: qualquer CFOP de entrada não movimenta');
  end if;
  if exists (select 1 from est_classif_regras where empresa_id = p_empresa) then return 0; end if;
  for f in select * from (values
    (10,  'NAOEST', array['2716'], array[]::text[], 'Energia elétrica'),
    (11,  'NAOEST', array['271012','27101921'], array[]::text[], 'Gasolina e diesel (o controle é na Gestão da Frota); lubrificantes e graxas ficam no uso e consumo'),
    (12,  'NAOEST', array['4901','4911'], array['SERVICO','MAO DE OBRA','LOCACAO ','ASSINATURA ','BOLETIM ',' EBOOK','MARKETING','LICENCA DE USO'], 'Serviços, assinaturas e materiais que não são estoque'),
    (13,  'NAOEST', array['2505','2517','2523','3816','4407','4412','6810','6904','6907','6908','6910'], array['CIMENTO','AREIA ','TELHA ','TIJOLO','ARGAMASSA','BRITA ','PISO ESM','PISO CERAM','PORCELANATO','REVESTIMENTO CERAM','LAVATORIO'], 'Material de obra e manutenção predial'),
    (20,  'FERRAM', array['8442'], array['CLICHE','ANILOX','LAMINA RASPADORA','LAMINA CORTANTE','DOCTOR','FACA ','DUPLA FACE','FITA CLICHE'], 'Ferramental de impressão e corte'),
    (30,  'EPI',    array['6116','6216','6401','6402','6403','6404','6405','6406','6506','9004'], array['EPI',' CA ','CA-','LUVA','BOTA ','PROTETOR AURICULAR','MASCARA','CAPACETE','OCULOS DE PROTECAO'], 'EPI (com CA)'),
    (40,  'LIMPEZA',array['3401','3402','3405','3808','4818','9603'], array['DETERGENTE','DESINFETANTE','SABAO','PAPEL TOALHA','PAPEL HIGIENICO','VASSOURA','ALVEJANTE'], 'Limpeza e higiene'),
    (50,  'ESCRIT', array['4802','4817','4820','9608','9609','9610','8443'], array['PAPEL A4','CANETA ESF','GRAMPO','TONER','CARTUCHO','RESMA'], 'Escritório'),
    (25,  'PECA',   array[]::text[], array['TEFLON','PTFE','ROLAMENTO','CORREIA','RETENTOR','MANCAL','RESISTENCIA ','CABO ','FUSIVEL','DISJUNTOR'], 'Peças pela descrição (antes do NCM de plástico ou borracha)'),
    (60,  'TINTA',  array['3215','3208','3209','3210','3814','2901','2902','2905','2909','2914','2915','3506'], array['TINTA','THINNER','THINER','SOLVENTE','VERNIZ','ACETATO','ALCOOL P/ IMPRESSAO','ADESIVO','URETHANE','BOND ','LACA '], 'Tintas, solventes, vernizes e adesivos de laminação'),
    (70,  'MASTER', array['3204','3206','3212','3811','3812','3824'], array['MASTER','MB ','ADITIVO','PIGMENTO','DESLIZANTE','ANTIBLOCK','ANTIESTATICO'], 'Master, pigmentos e aditivos'),
    (75,  'EMBAL',  array['3919','3923','4415','4819','4821','4822','4823'], array['TUBETE','CAIXA DE PAPELAO','PALLET','ETIQ','STRETCH','FITA ADESIVA'], 'Embalagens, tubetes, etiquetas, paletes e filme stretch'),
    (80,  'RESINA', array['3901','3902','3903','3904','3905','3906','3907','3908','3909','3910','3911','3912','3913','3914','3915','3920','3921'], array[]::text[], 'Resinas, compostos e filmes para laminação (só pelo NCM)'),
    (100, 'IMOB',   array['84','85','90','9401','9403','9405'], array[]::text[], 'Máquinas, equipamentos e móveis de valor unitário a partir de R$ 1.200: revise se é ativo imobilizado'),
    (110, 'PECA',   array['84','85','40','59','68','70','72','73','74','76','82','83','87','90','96'], array[]::text[], 'Peças de reposição e manutenção'),
    (200, 'CONSUMO',array[]::text[], array[]::text[], 'Tudo o que sobrar: uso e consumo (revise)')
  ) as x(ordem, fam, ncm, pal, obs) loop
    select id into v_fam from est_familias where empresa_id = p_empresa and codigo = f.fam;
    continue when v_fam is null;
    insert into est_classif_regras(empresa_id, ordem, familia_id, ncm_prefixos, palavras, valor_unit_min, observacao)
    values (p_empresa, f.ordem, v_fam, f.ncm, f.pal, case when f.fam = 'IMOB' then 1200 end, f.obs);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public._est_cadastro_padrao(uuid) from public, anon, authenticated;

create or replace function public.est_cadastro_padrao(p_empresa uuid, p_refazer boolean default false) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_editar(p_empresa) then raise exception 'Só administrador ou financeiro configura o estoque.'; end if;
  if p_refazer then delete from est_classif_regras where empresa_id = p_empresa; end if;
  return _est_cadastro_padrao(p_empresa);
end $$;
revoke all on function public.est_cadastro_padrao(uuid, boolean) from public, anon;
grant execute on function public.est_cadastro_padrao(uuid, boolean) to authenticated;

do $$ declare e uuid; begin
  for e in select distinct empresa_id from est_familias loop perform public._est_cadastro_padrao(e); end loop;
end $$;

-- 4) cadastro em massa: grupos aprovados na tela → produtos novos (ou existentes) + de-paras
--    p_grupos: [{ produto_id? , nao_estoque?, codigo?, descricao, unidade, ncm, familia_id,
--                 itens: [{ emit_doc, codigo_fornecedor, descricao, unidade, fator }] }]
create or replace function public.est_cadastro_massa(p_empresa uuid, p_grupos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g jsonb; it jsonb; v_pid uuid; f est_familias; v_cod text; v_pref text; v_seq int; v_prod int := 0; v_dp int := 0; v_ja int := 0;
        v_tipo text; v_fav uuid; v_preco numeric; v_ult date; ep estoque_parametros; v_fat numeric;
begin
  if not public.pode_editar(p_empresa) then raise exception 'Só administrador ou financeiro cadastra em massa.'; end if;
  if jsonb_typeof(p_grupos) <> 'array' or jsonb_array_length(p_grupos) = 0 then raise exception 'Nada a gravar.'; end if;
  if jsonb_array_length(p_grupos) > 2000 then raise exception 'No máximo 2.000 produtos por vez.'; end if;
  perform pg_advisory_xact_lock(hashtext('produtos:' || p_empresa::text));
  select * into ep from estoque_parametros where empresa_id = p_empresa;
  for g in select * from jsonb_array_elements(p_grupos) loop
    v_pid := null;
    if coalesce((g ->> 'nao_estoque')::boolean, false) then
      -- um produto genérico por empresa recebe todos os itens que não são estoque
      select * into f from est_familias where empresa_id = p_empresa and codigo = 'NAOEST';
      if f.id is null then raise exception 'Família NAOEST não configurada. Rode est_cadastro_padrao.'; end if;
      select id into v_pid from produtos where empresa_id = p_empresa and codigo = 'NAO-ESTOQUE';
      if v_pid is null then
        insert into produtos(empresa_id, codigo, descricao, tipo, unidade, familia_id, origem, observacao)
        values (p_empresa, 'NAO-ESTOQUE', 'ITENS DE COMPRA QUE NÃO SÃO ESTOQUE (ENERGIA, SERVIÇOS, OBRAS)', 'servico', 'UN', f.id, 'nfe_entrada',
                'Criado pelo cadastro em massa: o de-para destes itens só serve para a nota não ficar pendente no estoque.')
        returning id into v_pid; v_prod := v_prod + 1;
      end if;
    elsif g ->> 'produto_id' is not null then
      select id into v_pid from produtos where id = (g ->> 'produto_id')::uuid and empresa_id = p_empresa;
      if v_pid is null then raise exception 'Produto % não é desta empresa.', g ->> 'produto_id'; end if;
    else
      select * into f from est_familias where id = (g ->> 'familia_id')::uuid and empresa_id = p_empresa;
      if f.id is null then raise exception 'Família inválida no grupo "%".', g ->> 'descricao'; end if;
      if coalesce(trim(g ->> 'descricao'), '') = '' then raise exception 'Grupo sem descrição.'; end if;
      v_tipo := case f.codigo when 'RESINA' then 'materia_prima' when 'MASTER' then 'aditivo' when 'TINTA' then 'tinta_solvente' when 'EMBAL' then 'embalagem'
        when 'PECA' then 'peca_manutencao' when 'SEMI' then 'semiacabado' when 'ACABADO' then 'produto_acabado' when 'SERV' then 'servico' when 'NAOEST' then 'servico'
        when 'EPI' then 'uso_consumo' when 'LIMPEZA' then 'uso_consumo' when 'ESCRIT' then 'uso_consumo' when 'CONSUMO' then 'uso_consumo' else 'outro' end;
      v_cod := nullif(upper(trim(g ->> 'codigo')), '');
      if v_cod is null then
        v_pref := left(f.codigo, 3);
        select coalesce(max(substring(codigo from '^' || v_pref || '-(\d+)$')::int), 0) + 1 into v_seq from produtos where empresa_id = p_empresa and codigo ~ ('^' || v_pref || '-\d+$');
        v_cod := v_pref || '-' || lpad(v_seq::text, 4, '0');
      elsif exists (select 1 from produtos where empresa_id = p_empresa and codigo = v_cod) then
        raise exception 'Já existe produto com o código %.', v_cod;
      end if;
      insert into produtos(empresa_id, codigo, descricao, tipo, unidade, ncm, familia_id, origem, observacao)
      values (p_empresa, v_cod, upper(trim(g ->> 'descricao')), v_tipo, coalesce(nullif(upper(trim(g ->> 'unidade')), ''), 'UN'), nullif(g ->> 'ncm', ''), f.id, 'nfe_entrada',
              'Criado pelo cadastro em massa a partir das NF-e de entrada.')
      returning id into v_pid; v_prod := v_prod + 1;
    end if;
    for it in select * from jsonb_array_elements(coalesce(g -> 'itens', '[]'::jsonb)) loop
      v_fat := coalesce(nullif(it ->> 'fator', '')::numeric, 1); if v_fat <= 0 then v_fat := 1; end if;
      select id into v_fav from favorecidos where empresa_id = p_empresa and regexp_replace(coalesce(documento, ''), '\D', '', 'g') = regexp_replace(it ->> 'emit_doc', '\D', '', 'g') limit 1;
      -- último custo pela nota mais recente do item (na unidade do produto)
      select case when i.qcom > 0 then custo_item_nfe(i, ep) / (i.qcom * v_fat) end, n.emissao into v_preco, v_ult
        from nfe_notas n join nfe_itens i on i.nota_id = n.id
       where n.empresa_id = p_empresa and n.emit_doc = it ->> 'emit_doc' and i.cprod = it ->> 'codigo_fornecedor' and n.situacao = 'autorizada'
       order by n.emissao desc limit 1;
      insert into produto_fornecedores(empresa_id, produto_id, emit_doc, favorecido_id, codigo_fornecedor, descricao_fornecedor, unidade_fornecedor, fator, ultimo_preco, ultima_compra)
      values (p_empresa, v_pid, it ->> 'emit_doc', v_fav, it ->> 'codigo_fornecedor', it ->> 'descricao', it ->> 'unidade', v_fat, v_preco, v_ult)
      on conflict (empresa_id, emit_doc, codigo_fornecedor) do nothing;
      if found then v_dp := v_dp + 1; else v_ja := v_ja + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('produtos', v_prod, 'depara', v_dp, 'ja_existiam', v_ja);
end $$;
revoke all on function public.est_cadastro_massa(uuid, jsonb) from public, anon;
grant execute on function public.est_cadastro_massa(uuid, jsonb) to authenticated;

-- 5) prontidão: o que cada item das notas faria no estoque, SEM gravar (mesma decisão do _est_item)
create or replace function public.est_prontidao(p_empresa uuid, p_de date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  if not public.is_participante(p_empresa) then raise exception 'Sem permissão.'; end if;
  with it as (
    select n.id nota_id, n.tipo sentido, n.emissao_propria, n.emit_doc, i.cprod, i.xprod, coalesce(i.vprod, 0) - coalesce(i.vdesc, 0) valor,
           case when not n.emissao_propria and n.tipo = 'entrada' and left(regexp_replace(coalesce(i.cfop, ''), '\D', '', 'g'), 1) in ('5','6','7')
                then translate(left(regexp_replace(i.cfop, '\D', '', 'g'), 1), '567', '123') || substr(regexp_replace(i.cfop, '\D', '', 'g'), 2)
                else regexp_replace(coalesce(i.cfop, ''), '\D', '', 'g') end as cfop
      from nfe_notas n join nfe_itens i on i.nota_id = n.id
     where n.empresa_id = p_empresa and n.emissao >= p_de and n.situacao = 'autorizada' and coalesce(n.finalidade, '1') not in ('2', '3') and coalesce(i.qcom, 0) > 0
  ), pr as (
    select it.*, p.id produto_id, p.familia_id, p.tipo_sped, p.local_padrao_id
      from it left join lateral (
        select p.* from produtos p
         where p.empresa_id = p_empresa
           and ((not it.emissao_propria and p.id = (select pf.produto_id from produto_fornecedores pf where pf.empresa_id = p_empresa and pf.emit_doc = it.emit_doc and pf.codigo_fornecedor = it.cprod limit 1))
             or (it.emissao_propria and p.codigo = it.cprod))
         limit 1) p on true
  ), dec as (
    select pr.*, r.id regra_id, r.tipo_movimento_id, r.local_id regra_local, tm.sentido tm_sentido, tm.local_origem_id, tm.local_destino_id
      from pr left join lateral (select * from _est_regra(p_empresa, pr.cfop, pr.sentido, pr.familia_id, pr.tipo_sped)) r on true
      left join est_tipos_movimento tm on tm.id = r.tipo_movimento_id
  ), res as (
    select dec.*,
      case when regra_id is not null and tipo_movimento_id is null then 'nao_movimenta'
           when produto_id is null then 'sem_produto'
           when regra_id is null then 'sem_regra'
           when coalesce(regra_local, case when tm_sentido = 'S' then local_origem_id else local_destino_id end, local_padrao_id) is null then 'sem_local'
           else 'ok' end as resultado
      from dec
  )
  select jsonb_build_object(
    'resumo', (select coalesce(jsonb_agg(jsonb_build_object('sentido', sentido, 'resultado', resultado, 'itens', n, 'valor', v) order by sentido, resultado), '[]'::jsonb)
                 from (select sentido, resultado, count(*) n, round(sum(valor), 2) v from res group by 1, 2) s),
    'cfops_sem_regra', (select coalesce(jsonb_agg(jsonb_build_object('sentido', sentido, 'cfop', cfop, 'itens', n, 'valor', v, 'exemplo', ex) order by v desc), '[]'::jsonb)
                 from (select sentido, cfop, count(*) n, round(sum(valor), 2) v, max(xprod) ex from res where resultado = 'sem_regra' group by 1, 2) s),
    'sem_local', (select coalesce(jsonb_agg(jsonb_build_object('produto_id', produto_id, 'itens', n, 'valor', v) order by v desc), '[]'::jsonb)
                 from (select produto_id, count(*) n, round(sum(valor), 2) v from res where resultado = 'sem_local' group by 1 limit 50) s)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.est_prontidao(uuid, date) from public, anon;
grant execute on function public.est_prontidao(uuid, date) to authenticated;

-- 6) o espelho do Iniflex também se liga quando o código do produto é trocado depois (antes, só no cadastro)
drop trigger if exists estoque_ligar_espelho_codigo on public.produtos;
create trigger estoque_ligar_espelho_codigo after update of codigo on public.produtos for each row
  when (old.codigo is distinct from new.codigo) execute function public._estoque_ligar_espelho();

-- 7) auditoria
do $$ begin
  if to_regprocedure('public._auditar()') is not null then
    drop trigger if exists zz_auditoria on public.est_classif_regras;
    create trigger zz_auditoria after insert or update or delete on public.est_classif_regras for each row execute function public._auditar();
  end if;
end $$;

-- conferência: regras de classificação (16 na IPLAMM), famílias novas = 2 por empresa com estoque, funções = 3
select (select count(*) from est_classif_regras) as regras_classificacao,
       (select count(*) from est_familias where codigo in ('FERRAM', 'NAOEST')) as familias_novas,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('est_cadastro_padrao', 'est_cadastro_massa', 'est_prontidao')) as funcoes;
