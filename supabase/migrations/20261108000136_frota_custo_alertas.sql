-- Frota: custo por km com pneus, combustível do VExpenses e aviso de vencimento (melhoria 7.3 do plano de melhoria contínua, Passo 4) — 08/11/2026.
-- Aditivo. O custo por km por veículo e os alertas na tela já existiam (SQL 070); esta migração:
--   • guarda a origem do abastecimento e a referência do VExpenses (importar o mesmo gasto duas vezes é recusado);
--   • palavras que identificam combustível no extrato do VExpenses ficam nos parâmetros;
--   • manda o aviso de vencimento (documento do veículo, CNH/toxicológico/MOPP do motorista, preventiva por data ou km)
--     para os papéis escolhidos, com a antecedência dos parâmetros: um aviso ao entrar na antecedência e outro ao vencer.

-- 1) parâmetros
alter table public.log_parametros add column if not exists frota_alerta_ativo boolean not null default true;
alter table public.log_parametros add column if not exists frota_alerta_dias int not null default 30;
alter table public.log_parametros add column if not exists frota_alerta_km int not null default 1000;     -- preventiva por km: aviso faltando isto
alter table public.log_parametros add column if not exists frota_alerta_papeis text[] not null default array['admin', 'financeiro', 'diretor'];
alter table public.log_parametros add column if not exists frota_vexp_palavras text not null default 'POSTO, COMBUST, DIESEL, SHELL, IPIRANGA, PETROBRAS, RAIZEN, ALE COMBUST, GASOLINA, ETANOL, ARLA';
do $$ begin
  alter table public.log_parametros add constraint log_par_frota_alerta_chk check (frota_alerta_dias between 1 and 180 and frota_alerta_km between 0 and 50000);
exception when duplicate_object then null; end $$;

-- 2) abastecimento: origem e referência do VExpenses
alter table public.frota_abastecimentos add column if not exists origem text not null default 'manual';
alter table public.frota_abastecimentos add column if not exists vexp_ref text;
do $$ begin
  alter table public.frota_abastecimentos add constraint frota_abast_origem_chk check (origem in ('manual', 'vexpenses', 'app'));
exception when duplicate_object then null; end $$;
create unique index if not exists frota_abast_vexp on public.frota_abastecimentos(empresa_id, vexp_ref) where vexp_ref is not null;

-- 3) avisos de vencimento
create table if not exists public.frota_avisos_enviados (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave text not null,                     -- doc:<id>:<validade>:<fase> · mot:<id>:<campo>:<validade>:<fase> · prev:<id>:<alvo>:<fase>
  criado_em timestamptz not null default now(),
  primary key (empresa_id, chave)
);
alter table public.frota_avisos_enviados enable row level security;   -- só as funções escrevem e leem

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('frota_vencimento', 'Logística', 'Frota: vencimento de documento, habilitação ou preventiva',
        'Documento do veículo, CNH, toxicológico ou MOPP do motorista, ou preventiva perto de vencer (antecedência nos parâmetros) ou vencido.', false, 72)
on conflict (codigo) do nothing;

-- os itens que vencem (ou venceram) dentro da antecedência
create or replace function public.frota_vencimentos(p_empresa uuid, p_hoje date default current_date)
returns table(chave text, fase text, origem text, item text, vence date, dias int, falta_km numeric) language plpgsql stable security definer set search_path = public as $$
declare d int; k int;
begin
  if auth.uid() is not null and not ve_logistica(p_empresa) then raise exception 'Sem permissão para a logística.'; end if;
  select coalesce(frota_alerta_dias, 30), coalesce(frota_alerta_km, 1000) into d, k from log_parametros where empresa_id = p_empresa;
  d := coalesce(d, 30); k := coalesce(k, 1000);
  return query
  -- documento mais recente de cada tipo, por veículo ativo
  with doc as (select distinct on (x.veiculo_id, x.tipo) x.* from frota_documentos x join log_veiculos v on v.id = x.veiculo_id
                where x.empresa_id = p_empresa and v.situacao <> 'inativo' order by x.veiculo_id, x.tipo, x.validade desc nulls last)
  select format('doc:%s:%s:%s', doc.id, doc.validade, case when doc.validade < p_hoje then 'vencido' else 'aviso' end),
         case when doc.validade < p_hoje then 'vencido' else 'aviso' end, v.codigo,
         case doc.tipo when 'crlv' then 'CRLV / licenciamento' when 'ipva' then 'IPVA' when 'seguro' then 'Seguro' when 'tacografo' then 'Aferição do tacógrafo'
                       when 'aet' then 'AET' when 'antt' then 'ANTT / RNTRC' else 'Documento' end,
         doc.validade, doc.validade - p_hoje, null::numeric
    from doc join log_veiculos v on v.id = doc.veiculo_id where doc.validade is not null and doc.validade <= p_hoje + d
  union all
  select format('mot:%s:%s:%s:%s', m.id, c.campo, c.val, case when c.val < p_hoje then 'vencido' else 'aviso' end),
         case when c.val < p_hoje then 'vencido' else 'aviso' end, m.nome, c.rot, c.val, c.val - p_hoje, null
    from frota_motoristas m cross join lateral (values ('cnh', 'CNH', m.cnh_validade), ('toxicologico', 'Exame toxicológico', m.toxicologico_validade), ('mopp', 'Curso MOPP', m.mopp_validade)) c(campo, rot, val)
   where m.empresa_id = p_empresa and m.ativo and c.val is not null and c.val <= p_hoje + d
  union all
  -- preventiva: o que vencer primeiro (data ou km)
  select format('prev:%s:%s:%s', p.id, coalesce(p.ultima_data::text, '') || '/' || coalesce(p.ultimo_km::text, ''), case when venc then 'vencido' else 'aviso' end),
         case when venc then 'vencido' else 'aviso' end, v.codigo, 'Preventiva: ' || p.descricao, prox, prox - p_hoje, faltakm
    from frota_planos p join log_veiculos v on v.id = p.veiculo_id
    cross join lateral (select case when p.a_cada_meses is not null and p.ultima_data is not null then (p.ultima_data + make_interval(months => p.a_cada_meses))::date end prox,
                               case when p.a_cada_km is not null and p.ultimo_km is not null and v.km_atual is not null then p.ultimo_km + p.a_cada_km - v.km_atual end faltakm) x
    cross join lateral (select (x.prox is not null and x.prox < p_hoje) or (x.faltakm is not null and x.faltakm <= 0) venc) y
   where p.empresa_id = p_empresa and p.ativo and v.situacao <> 'inativo'
     and ((x.prox is not null and x.prox <= p_hoje + d) or (x.faltakm is not null and x.faltakm <= k));
end $$;
revoke all on function public.frota_vencimentos(uuid, date) from public, anon;
grant execute on function public.frota_vencimentos(uuid, date) to authenticated;

-- manda os avisos novos de uma empresa (um aviso por item e fase); devolve quantos itens novos
create or replace function public._frota_avisar(p_empresa uuid, p_hoje date default current_date)
returns int language plpgsql security definer set search_path = public as $$
declare P log_parametros; n int := 0; r record; txt text := ''; urg boolean := false;
begin
  select * into P from log_parametros where empresa_id = p_empresa;
  if P.id is not null and not P.frota_alerta_ativo then return 0; end if;
  for r in select v.* from frota_vencimentos(p_empresa, p_hoje) v order by v.fase desc, v.vence nulls last loop
    insert into frota_avisos_enviados(empresa_id, chave) values (p_empresa, r.chave) on conflict do nothing;
    if not found then continue; end if;
    n := n + 1; urg := urg or r.fase = 'vencido';
    if n <= 8 then txt := txt || case when n > 1 then ' · ' else '' end || r.origem || ' — ' || r.item || ': '
      || case when r.fase = 'vencido' then 'vencido' when r.vence is not null then 'vence em ' || to_char(r.vence, 'DD/MM') else 'faltam ' || r.falta_km::int || ' km' end; end if;
  end loop;
  if n > 0 then
    perform _notificar_u(p_empresa, _usuarios_papel(p_empresa, coalesce(P.frota_alerta_papeis, array['admin', 'financeiro', 'diretor'])), 'frota_vencimento',
      'Frota: ' || n || ' vencimento(s) ' || case when urg then '(há itens vencidos)' else 'chegando' end, txt || case when n > 8 then ' · e mais ' || (n - 8) end, '#/logistica/gestao-frota', null, urg);
  end if;
  return n;
end $$;
revoke all on function public._frota_avisar(uuid, date) from public, anon, authenticated;

create or replace function public._frota_avisos() returns void language plpgsql security definer set search_path = public as $$
declare e uuid;
begin
  for e in select distinct empresa_id from log_veiculos where situacao <> 'inativo' union select distinct empresa_id from frota_motoristas where ativo loop
    begin perform _frota_avisar(e); exception when others then raise warning 'avisos da frota (%): %', e, sqlerrm; end;
  end loop;
end $$;
revoke all on function public._frota_avisos() from public, anon, authenticated;

create or replace function public.frota_avisar_agora(p_empresa uuid) returns int language plpgsql security definer set search_path = public as $$
begin
  if not pode_logistica(p_empresa) then raise exception 'Só quem edita a logística manda os avisos.'; end if;
  return _frota_avisar(p_empresa);
end $$;
revoke all on function public.frota_avisar_agora(uuid) from public, anon;
grant execute on function public.frota_avisar_agora(uuid) to authenticated;

-- 4) agendamento: todo dia às 7h40 (10h40 UTC)
do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'frota-avisos';
  perform cron.schedule('frota-avisos', '40 10 * * *', $job$ select public._frota_avisos(); $job$);
exception when others then raise notice 'agendamento dos avisos da frota não criado: %', sqlerrm;
end $$;

select (select count(*) from information_schema.columns where table_name = 'log_parametros' and column_name like 'frota_%') as parametros,
       (select count(*) from information_schema.columns where table_name = 'frota_abastecimentos' and column_name in ('origem', 'vexp_ref')) as colunas;
