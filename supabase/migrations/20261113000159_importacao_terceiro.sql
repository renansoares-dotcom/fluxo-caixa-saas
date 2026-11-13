-- Importação por meio de terceiro (Compras e Estoque › Importação, CMP005). Pedido do Renan em 13/11/2026.
-- Na importação direta a empresa fecha o câmbio e paga o exportador. Na importação por meio de terceiro quem importa é um
-- intermediário: a empresa repassa reais a ele, ele paga o exportador e os tributos e depois
-- emite a nota fiscal. O processo passa a guardar o intermediário, o total que ele informou e os repasses, que são os
-- adiantamentos a fornecedor já lançados no financeiro (Créditos e adiantamentos) ou um valor informado ainda a confirmar.
-- Aditivo: só cria colunas, tabela, funções e gatilhos novos.

alter table public.imp_processos add column if not exists modalidade text not null default 'direta';
alter table public.imp_processos add column if not exists intermediario_id uuid references public.favorecidos(id) on delete set null;
alter table public.imp_processos add column if not exists total_informado_brl numeric(16,2);
alter table public.imp_processos drop constraint if exists imp_processos_modalidade_ck;
alter table public.imp_processos add constraint imp_processos_modalidade_ck check (modalidade in ('direta', 'terceiro'));
alter table public.imp_processos drop constraint if exists imp_processos_total_informado_ck;
alter table public.imp_processos add constraint imp_processos_total_informado_ck check (total_informado_brl is null or total_informado_brl >= 0);

-- ---------------------------------------------------------------- repasses ao intermediário (em reais)
create table if not exists public.imp_repasses (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  processo_id uuid not null references public.imp_processos(id) on delete cascade,
  credito_id uuid references public.creditos(id) on delete set null,          -- o adiantamento a fornecedor do financeiro
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  data date,                                                                   -- vazio = data a confirmar
  valor numeric(16,2) not null check (valor > 0),
  valor_moeda numeric(16,2) check (valor_moeda is null or valor_moeda > 0),    -- quanto o intermediário abateu na moeda do processo
  taxa numeric(12,6) check (taxa is null or taxa > 0),                         -- a taxa que ele informou para esse repasse
  confirmado boolean not null default false,                                   -- com lançamento pago no financeiro
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists imp_repasses_proc on public.imp_repasses(processo_id);
create unique index if not exists imp_repasses_credito on public.imp_repasses(credito_id) where credito_id is not null;   -- um adiantamento serve a um processo só

alter table public.imp_repasses enable row level security;
drop policy if exists imp_repasses_sel on public.imp_repasses;
create policy imp_repasses_sel on public.imp_repasses for select to authenticated using (public.is_membro(empresa_id) or public.imp_pode(empresa_id));
drop policy if exists imp_repasses_ins on public.imp_repasses;
create policy imp_repasses_ins on public.imp_repasses for insert to authenticated with check (public.imp_pode(empresa_id));
drop policy if exists imp_repasses_upd on public.imp_repasses;
create policy imp_repasses_upd on public.imp_repasses for update to authenticated using (public.imp_pode(empresa_id)) with check (public.imp_pode(empresa_id));
drop policy if exists imp_repasses_del on public.imp_repasses;
create policy imp_repasses_del on public.imp_repasses for delete to authenticated using (public.imp_pode(empresa_id));
grant select, insert, update, delete on public.imp_repasses to authenticated;
drop trigger if exists zz_auditoria on public.imp_repasses;
create trigger zz_auditoria after insert or update or delete on public.imp_repasses for each row execute function public._auditar();
drop trigger if exists imp_filho on public.imp_repasses;
create trigger imp_filho before insert or update or delete on public.imp_repasses for each row execute function public._imp_filho();

-- ---------------------------------------------------------------- regras
-- processo por meio de terceiro: precisa do intermediário (da mesma empresa); com repasse lançado, a modalidade e o intermediário não mudam
create or replace function public._imp_processo_terceiro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.modalidade = 'terceiro' then
    if new.intermediario_id is null then raise exception 'Informe o intermediário: quem faz a importação e recebe os repasses.'; end if;
    if not exists (select 1 from favorecidos where id = new.intermediario_id and empresa_id = new.empresa_id) then raise exception 'Intermediário inválido para esta empresa.'; end if;
    if tg_op = 'UPDATE' and old.modalidade = 'direta' and exists (select 1 from imp_cambios where processo_id = new.id) then
      raise exception 'Este processo já tem pagamento ao exterior programado: exclua antes de mudar para importação por meio de terceiro.';
    end if;
  else
    new.intermediario_id := null;
  end if;
  if tg_op = 'UPDATE' and (new.modalidade is distinct from old.modalidade or new.intermediario_id is distinct from old.intermediario_id)
     and exists (select 1 from imp_repasses where processo_id = new.id) then
    raise exception 'Este processo já tem repasse lançado: exclua os repasses antes de mudar a modalidade ou o intermediário.';
  end if;
  return new;
end $$;
drop trigger if exists imp_processo_terceiro on public.imp_processos;
create trigger imp_processo_terceiro before insert or update on public.imp_processos for each row execute function public._imp_processo_terceiro();

-- na importação por meio de terceiro quem paga o exterior é o intermediário: a empresa não tem câmbio próprio
create or replace function public._imp_cambio_terceiro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from imp_processos where id = new.processo_id and modalidade = 'terceiro') then
    raise exception 'Neste processo quem paga o exportador é o intermediário: registre os repasses em vez do câmbio.';
  end if;
  return new;
end $$;
drop trigger if exists imp_cambio_terceiro on public.imp_cambios;
create trigger imp_cambio_terceiro before insert on public.imp_cambios for each row execute function public._imp_cambio_terceiro();

-- repasse: só em processo por meio de terceiro; ligado a um adiantamento, copia dele a data, o valor e o lançamento
create or replace function public._imp_repasse() returns trigger
language plpgsql security definer set search_path = public as $$
declare p imp_processos; c creditos;
begin
  select * into p from imp_processos where id = new.processo_id;
  if p.modalidade <> 'terceiro' then raise exception 'Repasse só existe em importação por meio de terceiro.'; end if;
  if new.credito_id is not null then
    select * into c from creditos where id = new.credito_id;
    if c.id is null or c.empresa_id <> new.empresa_id then raise exception 'Adiantamento inválido para esta empresa.'; end if;
    if c.cancelado then raise exception 'Este adiantamento está cancelado.'; end if;
    if c.favorecido_id is distinct from p.intermediario_id then raise exception 'O adiantamento é de outro fornecedor, não do intermediário deste processo.'; end if;
    new.data := c.data; new.valor := c.valor; new.lancamento_id := c.lancamento_id;
    new.confirmado := c.lancamento_id is not null and exists (select 1 from lancamentos where id = c.lancamento_id and status = 'Pago');
  else
    new.lancamento_id := null; new.confirmado := false;                      -- sem adiantamento no financeiro é só valor informado
  end if;
  if new.valor_moeda is not null and new.taxa is null then new.taxa := round(new.valor / new.valor_moeda, 6); end if;
  return new;
end $$;
drop trigger if exists imp_repasse_regras on public.imp_repasses;
create trigger imp_repasse_regras before insert or update on public.imp_repasses for each row execute function public._imp_repasse();

-- adiantamentos do intermediário que ainda não estão em nenhum processo (para a tela oferecer o vínculo)
create or replace function public.imp_adiantamentos_livres(p_processo uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p imp_processos;
begin
  select * into p from imp_processos where id = p_processo;
  if p.id is null or not (is_membro(p.empresa_id) or imp_pode(p.empresa_id)) then raise exception 'Sem acesso a este processo.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'data', c.data, 'valor', c.valor, 'descricao', coalesce(l.descricao, c.descricao), 'conta', ct.nome,
                                                      'pago', coalesce(l.status = 'Pago', false)) order by c.data, c.criado_em)
                     from creditos c left join lancamentos l on l.id = c.lancamento_id left join contas ct on ct.id = l.conta_id
                    where c.empresa_id = p.empresa_id and c.favorecido_id = p.intermediario_id and c.natureza = 'fornecedor' and c.tipo = 'adiantamento' and not c.cancelado
                      and not exists (select 1 from imp_repasses r where r.credito_id = c.id)), '[]'::jsonb);
end $$;
grant execute on function public.imp_adiantamentos_livres(uuid) to authenticated;
