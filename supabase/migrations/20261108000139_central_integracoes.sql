-- Central de Integrações (melhoria 1.6 do plano de melhoria contínua, Passo 5) — 08/11/2026.
-- Aditivo. Uma tela com todas as entradas e saídas automáticas da plataforma:
--   • extratos bancários (OFX, CNAB, ERP), VExpenses, NF-e de saída e de entrada, Iniflex (produção), e-frete (CIOT),
--     remessa de pagamentos (CNAB), e-mail, WhatsApp e as rotinas automáticas (pg_cron);
--   • para cada uma: a última importação/envio, quantas nos últimos 30 dias, as falhas dos últimos 7 dias, a situação e o
--     próximo passo, com o link da tela;
--   • "esperado a cada N dias úteis" por integração (parâmetro): passou disso, a integração fica ATRASADA e quem estiver
--     nos perfis escolhidos recebe um aviso por dia útil (às 9h40) com o que está atrasado ou com falha.

create table if not exists public.integ_config (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  ativo boolean not null default true,              -- desligada = não usada pela empresa (sai dos avisos)
  max_dias int check (max_dias between 0 and 90),   -- esperado a cada N dias úteis; 0 = sem aviso de atraso; null = padrão
  primary key (empresa_id, codigo)
);
create table if not exists public.integ_geral (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  avisar boolean not null default true,
  papeis text[] not null default array['admin', 'financeiro']
);
create table if not exists public.integ_avisos_enviados (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  dia date not null,
  primary key (empresa_id, dia)
);
alter table public.integ_config enable row level security;
alter table public.integ_geral enable row level security;
alter table public.integ_avisos_enviados enable row level security;
create or replace function public.integ_pode(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.papel_em(p_empresa) in ('admin', 'diretor', 'financeiro')
$$;
revoke all on function public.integ_pode(uuid) from public, anon;
grant execute on function public.integ_pode(uuid) to authenticated;
drop policy if exists integ_config_sel on public.integ_config;
create policy integ_config_sel on public.integ_config for select to authenticated using (public.integ_pode(empresa_id));
drop policy if exists integ_config_ins on public.integ_config;
create policy integ_config_ins on public.integ_config for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists integ_config_upd on public.integ_config;
create policy integ_config_upd on public.integ_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
drop policy if exists integ_geral_sel on public.integ_geral;
create policy integ_geral_sel on public.integ_geral for select to authenticated using (public.integ_pode(empresa_id));
drop policy if exists integ_geral_ins on public.integ_geral;
create policy integ_geral_ins on public.integ_geral for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists integ_geral_upd on public.integ_geral;
create policy integ_geral_upd on public.integ_geral for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
grant select, insert, update on public.integ_config, public.integ_geral to authenticated;
drop trigger if exists zz_auditoria on public.integ_config;
create trigger zz_auditoria after insert or update or delete on public.integ_config for each row execute function public._auditar();

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('integracoes', 'Administração', 'Integrações atrasadas ou com falha', 'Extrato, nota, Iniflex, VExpenses ou envio que não chegou no prazo esperado ou falhou (Central de Integrações).', false, 95)
on conflict (codigo) do nothing;

-- dias úteis entre duas datas (exclusive a primeira), pelos feriados do fechamento (SQL 107)
create or replace function public._dias_uteis_entre(a date, b date) returns int language sql immutable as $$
  select case when a is null or b is null or b <= a then 0 else (select count(*)::int from generate_series(a + 1, b, interval '1 day') d where public._eh_dia_util(d::date)) end
$$;

-- catálogo: código, nome, área, link e o padrão de "esperado a cada N dias úteis"
create or replace function public._integ_catalogo()
returns table(codigo text, nome text, area text, descricao text, link text, max_padrao int, ordem int) language sql immutable as $$
  values
  ('extratos', 'Extratos bancários', 'Financeiro', 'OFX, CNAB 240 e extrato do ERP importados na Conciliação Bancária, por conta.', '#/conciliacao', 2, 1),
  ('vexpenses', 'VExpenses', 'Financeiro', 'Extrato de despesas dos cartões (VExpenses) importado na Conciliação.', '#/conciliacao', 7, 2),
  ('nfe_saida', 'NF-e de saída', 'Fiscal', 'XML das notas emitidas pela empresa, importados em Notas Fiscais.', '#/notas', 1, 3),
  ('nfe_entrada', 'NF-e de entrada', 'Fiscal', 'XML das notas dos fornecedores, importados em Notas Fiscais.', '#/notas', 3, 4),
  ('iniflex', 'Iniflex — produção', 'Produção', 'Apontamentos de produção importados do Iniflex.', '#/producao/importar', 1, 5),
  ('efrete', 'e-frete (CIOT)', 'Logística', 'Chamadas ao e-frete para declarar e encerrar o CIOT dos fretes.', '#/logistica/fretes', 0, 6),
  ('cnab_remessa', 'Remessa de pagamentos (CNAB)', 'Financeiro', 'Arquivos de pagamento gerados na Autorização de Pagamentos para o banco.', '#/autorizacao', 0, 7),
  ('email', 'E-mail', 'Comunicação', 'Envio dos e-mails da plataforma pelo Resend.', '#/config/email', 0, 8),
  ('whatsapp', 'WhatsApp', 'Comunicação', 'Envio das mensagens pela API oficial do WhatsApp.', '#/config/whatsapp', 0, 9),
  ('rotinas', 'Rotinas automáticas', 'Plataforma', 'Agendamentos do banco (avisos, cobranças, relatórios, recorrentes, limpezas).', '#/integracoes', 0, 10)
$$;

-- o painel
create or replace function public.integ_painel(p_empresa uuid, p_hoje date default (now() at time zone 'America/Recife')::date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record; out jsonb := '[]'; v_ult timestamptz; v_n30 int; v_fal int; v_err text; v_det text; v_pend int; v_atr int; v_max int; v_ativo boolean; v_dias int; v_sit text; v_passo text;
  v_ini timestamptz := (p_hoje - 30)::timestamptz; v_7 timestamptz := (p_hoje - 7)::timestamptz;
begin
  if not integ_pode(p_empresa) then raise exception 'Só administrador, diretor e financeiro veem a Central de Integrações.'; end if;
  for c in select * from _integ_catalogo() order by ordem loop
    v_ult := null; v_n30 := 0; v_fal := 0; v_err := null; v_det := null; v_pend := 0; v_atr := 0;
    select coalesce(ic.ativo, true), coalesce(ic.max_dias, c.max_padrao) into v_ativo, v_max from (select 1) x left join integ_config ic on ic.empresa_id = p_empresa and ic.codigo = c.codigo;
    case c.codigo
    when 'extratos' then
      select max(created_at), count(*) filter (where created_at >= v_ini) into v_ult, v_n30 from extrato_importacoes where empresa_id = p_empresa and coalesce(formato, 'ofx') <> 'vexpenses';
      select count(*) filter (where s.ultimo_fim is null or _dias_uteis_entre(s.ultimo_fim, p_hoje) > greatest(v_max, 1)), coalesce(sum(s.pendentes), 0)
        into v_atr, v_pend
        from conc_extratos_situacao(p_empresa) s
       where s.conta_id <> all(coalesce((select contas_sem_alerta from conc_config where empresa_id = p_empresa), '{}'))   -- contas dispensadas na Conciliação
         and coalesce(s.formato, 'ofx') <> 'vexpenses';
      v_det := format('%s conta(s) com o extrato atrasado; %s lançamento(s) do extrato a conciliar', v_atr, v_pend);
    when 'vexpenses' then
      select max(created_at), count(*) filter (where created_at >= v_ini) into v_ult, v_n30 from extrato_importacoes where empresa_id = p_empresa and formato = 'vexpenses';
    when 'nfe_saida' then
      select max(importado_em), count(*) filter (where importado_em >= v_ini) into v_ult, v_n30 from nfe_notas where empresa_id = p_empresa and tipo = 'saida' and emissao_propria;
      select max(emissao)::text into v_det from nfe_notas where empresa_id = p_empresa and tipo = 'saida' and emissao_propria;
      v_det := case when v_det is null then null else 'última emissão importada: ' || to_char(v_det::date, 'DD/MM/YYYY') end;
    when 'nfe_entrada' then
      select max(importado_em), count(*) filter (where importado_em >= v_ini) into v_ult, v_n30 from nfe_notas where empresa_id = p_empresa and tipo = 'entrada';
    when 'iniflex' then
      select max(criado_em), count(*) filter (where criado_em >= v_ini) into v_ult, v_n30 from prod_apontamentos where empresa_id = p_empresa and origem = 'iniflex';
    when 'efrete' then
      select max(criado_em), count(*) filter (where criado_em >= v_ini), count(*) filter (where not ok and criado_em >= v_7) into v_ult, v_n30, v_fal from efrete_chamadas where empresa_id = p_empresa;
      select left(coalesce(resposta ->> 'Excecao', resposta ->> 'erro', resposta::text, 'HTTP ' || http_status), 300) into v_err from efrete_chamadas where empresa_id = p_empresa and not ok and criado_em >= v_7 order by criado_em desc limit 1;
    when 'cnab_remessa' then
      select max(gerado_em), count(*) filter (where gerado_em >= v_ini and situacao = 'gerada') into v_ult, v_n30 from pag_remessas where empresa_id = p_empresa;
    when 'email' then
      select max(enviado_em), count(*) filter (where enviado_em >= v_ini), count(*) filter (where situacao = 'erro' and criado_em >= v_7),
             count(*) filter (where situacao = 'pendente' and criado_em < now() - interval '30 minutes')
        into v_ult, v_n30, v_fal, v_pend from email_fila where empresa_id = p_empresa;
      select erro into v_err from email_fila where empresa_id = p_empresa and situacao = 'erro' and criado_em >= v_7 order by criado_em desc limit 1;
      v_det := case when v_pend > 0 then format('%s e-mail(s) parados na fila há mais de 30 minutos (envio desligado ou sem a chave do Resend?)', v_pend) end;
    when 'whatsapp' then
      select max(enviado_em), count(*) filter (where enviado_em >= v_ini), count(*) filter (where situacao = 'erro' and criado_em >= v_7),
             count(*) filter (where situacao = 'pendente' and criado_em < now() - interval '30 minutes')
        into v_ult, v_n30, v_fal, v_pend from wa_fila where empresa_id = p_empresa;
      select erro into v_err from wa_fila where empresa_id = p_empresa and situacao = 'erro' and criado_em >= v_7 order by criado_em desc limit 1;
      v_det := case when v_pend > 0 then format('%s mensagem(ns) parada(s) na fila há mais de 30 minutos (WhatsApp desligado ou sem o token?)', v_pend) end;
    when 'rotinas' then
      begin
        execute $q$select max(end_time), count(*) filter (where start_time >= $1), count(*) filter (where status = 'failed' and start_time >= $2),
                       (select left(return_message, 300) from cron.job_run_details where status = 'failed' and start_time >= $2 order by start_time desc limit 1)
                  from cron.job_run_details$q$ into v_ult, v_n30, v_fal, v_err using v_ini, v_7;
      exception when others then v_det := 'sem acesso ao histórico do pg_cron neste banco';
      end;
    end case;
    v_dias := case when v_ult is null then null else _dias_uteis_entre((v_ult at time zone 'America/Recife')::date, p_hoje) end;
    v_sit := case when not v_ativo then 'desligada'
                  when c.codigo = 'extratos' and v_atr > 0 then 'atrasada'
                  when v_ult is null and c.codigo not in ('email', 'whatsapp', 'rotinas', 'efrete', 'cnab_remessa') then 'sem_dados'
                  when v_max > 0 and c.codigo <> 'extratos' and v_dias > v_max then 'atrasada'
                  when v_fal > 0 or v_pend > 0 and c.codigo in ('email', 'whatsapp') then 'falha'
                  when v_ult is null then 'sem_uso'
                  else 'ok' end;
    v_passo := case v_sit
      when 'desligada' then 'Marcada como não usada pela empresa.'
      when 'sem_dados' then 'Nenhuma importação ainda. Faça a primeira em ' || c.nome || '.'
      when 'atrasada' then case c.codigo
          when 'extratos' then format('Importe o extrato de %s conta(s) atrasada(s) na Conciliação Bancária.', v_atr)
          when 'nfe_saida' then 'Importe os XML das notas emitidas desde a última importação.'
          when 'nfe_entrada' then 'Importe os XML das notas de fornecedores recebidas.'
          when 'iniflex' then 'Exporte do Iniflex e importe os apontamentos em Produção › Importar do Iniflex.'
          when 'vexpenses' then 'Baixe o Extrato de Pagamentos da VExpenses e importe na Conciliação.'
          else 'Faça a importação em ' || c.nome || '.' end || format(' Última: há %s dia(s) útil(eis); esperado a cada %s.', v_dias, v_max)
      when 'falha' then case c.codigo
          when 'email' then 'Veja a fila em E-mail e modelos: confira se o envio está ligado, o domínio validado e a chave RESEND_API_KEY.'
          when 'whatsapp' then 'Veja a fila em WhatsApp: confira o token, o número e se os modelos estão aprovados na Meta.'
          when 'efrete' then 'Abra o frete e repita a chamada; se persistir, confira o certificado e as credenciais do e-frete.'
          when 'rotinas' then 'Uma rotina automática falhou; veja a mensagem e avise o suporte.'
          else 'Veja os detalhes na tela.' end
      when 'sem_uso' then 'Ainda não usado.'
      else 'Em dia.' end;
    out := out || jsonb_build_object('codigo', c.codigo, 'nome', c.nome, 'area', c.area, 'descricao', c.descricao, 'link', c.link, 'ativo', v_ativo,
      'max_dias', v_max, 'max_padrao', c.max_padrao, 'ultima', v_ult, 'dias_uteis', v_dias, 'qtd_30d', v_n30, 'falhas_7d', v_fal, 'ultimo_erro', v_err,
      'pendentes', v_pend, 'atrasadas', v_atr, 'detalhe', v_det, 'situacao', v_sit, 'proximo_passo', v_passo);
  end loop;
  return out;
end $$;
revoke all on function public.integ_painel(uuid, date) from public, anon;
grant execute on function public.integ_painel(uuid, date) to authenticated;

-- aviso diário (dias úteis): o que está atrasado ou com falha, uma vez por dia por empresa
create or replace function public._integ_avisar(p_empresa uuid, p_hoje date default (now() at time zone 'America/Recife')::date)
returns int language plpgsql security definer set search_path = public as $$
declare g integ_geral; L jsonb; n int; txt text; v_claims text := current_setting('request.jwt.claims', true); v_dono uuid;
begin
  select * into g from integ_geral where empresa_id = p_empresa;
  if g.empresa_id is not null and not g.avisar then return 0; end if;
  if not _eh_dia_util(p_hoje) then return 0; end if;
  -- o painel confere o perfil de quem chama: roda como o primeiro administrador da empresa
  select user_id into v_dono from membros where empresa_id = p_empresa and papel::text = 'admin' order by created_at limit 1;
  if v_dono is null then return 0; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_dono::text, true);
  L := integ_painel(p_empresa, p_hoje);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_claims::json ->> 'sub', ''), true);
  select count(*), string_agg(x ->> 'nome' || ': ' || case x ->> 'situacao' when 'atrasada' then 'atrasada' else 'com falha' end, ' · ') into n, txt
    from jsonb_array_elements(L) x where x ->> 'situacao' in ('atrasada', 'falha');
  if n = 0 then return 0; end if;
  insert into integ_avisos_enviados(empresa_id, dia) values (p_empresa, p_hoje) on conflict do nothing;
  if not found then return 0; end if;
  perform _notificar_u(p_empresa, _usuarios_papel(p_empresa, coalesce(g.papeis, array['admin', 'financeiro'])), 'integracoes',
    'Integrações: ' || n || ' precisa(m) de atenção', txt, '#/integracoes', null, false);
  return n;
end $$;
revoke all on function public._integ_avisar(uuid, date) from public, anon, authenticated;

create or replace function public._integ_avisos() returns void language plpgsql security definer set search_path = public as $$
declare e uuid;
begin
  for e in select id from empresas loop
    begin perform _integ_avisar(e); exception when others then raise warning 'avisos de integrações (%): %', e, sqlerrm; end;
  end loop;
end $$;
revoke all on function public._integ_avisos() from public, anon, authenticated;

do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'integracoes-avisos';
  perform cron.schedule('integracoes-avisos', '40 12 * * 1-5', $job$ select public._integ_avisos(); $job$);
exception when others then raise notice 'agendamento dos avisos de integrações não criado: %', sqlerrm;
end $$;

select count(*) as integracoes from public._integ_catalogo();
