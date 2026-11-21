-- 175 — Leitor de código de barras, etapa 2 (21/11/2026, Renan): etiqueta de mercadoria.
--   1. Cada LOTE e cada PRODUTO ganham um código de etiqueta curto e único (L0000123 / P0000456): só letras maiúsculas e
--      dígitos, para sair igual em qualquer leitor (código de barras comum ou QR) e em qualquer teclado.
--   2. Parâmetros da etiqueta por empresa: tipo de código (barras, QR ou os dois), tamanho em milímetros e cópias.
-- A mercadoria que chega só com etiqueta de texto do fornecedor passa a ser identificada pela etiqueta da plataforma.
-- Aditivo: nada muda nos movimentos nem nos saldos.

create sequence if not exists public.etiqueta_seq;
grant usage on sequence public.etiqueta_seq to authenticated;

alter table public.est_lotes add column if not exists etiqueta text default ('L' || lpad(nextval('public.etiqueta_seq')::text, 7, '0'));
alter table public.produtos add column if not exists etiqueta text default ('P' || lpad(nextval('public.etiqueta_seq')::text, 7, '0'));
update public.est_lotes set etiqueta = 'L' || lpad(nextval('public.etiqueta_seq')::text, 7, '0') where etiqueta is null;
update public.produtos set etiqueta = 'P' || lpad(nextval('public.etiqueta_seq')::text, 7, '0') where etiqueta is null;
alter table public.est_lotes alter column etiqueta set not null;
alter table public.produtos alter column etiqueta set not null;
create unique index if not exists est_lotes_etiqueta on public.est_lotes (etiqueta);
create unique index if not exists produtos_etiqueta on public.produtos (etiqueta);

-- o código da etiqueta não se altera (a etiqueta colada na mercadoria tem de continuar valendo)
create or replace function public._etq_fixa() returns trigger language plpgsql as $$
begin
  if new.etiqueta is distinct from old.etiqueta then new.etiqueta := old.etiqueta; end if;
  return new;
end $$;
drop trigger if exists est_lotes_etq_fixa on public.est_lotes;
create trigger est_lotes_etq_fixa before update of etiqueta on public.est_lotes for each row execute function public._etq_fixa();
drop trigger if exists produtos_etq_fixa on public.produtos;
create trigger produtos_etq_fixa before update of etiqueta on public.produtos for each row execute function public._etq_fixa();

-- parâmetros da etiqueta (sem linha = padrões abaixo)
create table if not exists public.etq_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  codigo text not null default 'ambos' check (codigo in ('barras', 'qr', 'ambos')),   -- o que sai impresso: código de barras, QR ou os dois
  largura_mm int not null default 100 check (largura_mm between 30 and 210),
  altura_mm int not null default 70 check (altura_mm between 20 and 297),
  copias int not null default 1 check (copias between 1 and 200),                      -- cópias sugeridas por lote
  mostrar_fornecedor boolean not null default true,
  atualizado_em timestamptz not null default now()
);
alter table public.etq_config enable row level security;
drop policy if exists etq_config_ler on public.etq_config;
create policy etq_config_ler on public.etq_config for select to authenticated
  using (exists (select 1 from public.membros m where m.empresa_id = etq_config.empresa_id and m.user_id = auth.uid()));
revoke all on public.etq_config from anon;
revoke insert, update, delete on public.etq_config from authenticated;
grant select on public.etq_config to authenticated;

create or replace function public.etq_config_salvar(p_empresa uuid, p_codigo text, p_largura int, p_altura int, p_copias int, p_fornecedor boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'diretor')) then
    raise exception 'Só o administrador ou o diretor muda os parâmetros da etiqueta';
  end if;
  if p_codigo not in ('barras', 'qr', 'ambos') then raise exception 'Tipo de código inválido'; end if;
  if p_largura is null or p_largura < 30 or p_largura > 210 or p_altura is null or p_altura < 20 or p_altura > 297 then raise exception 'Tamanho da etiqueta fora da faixa (largura 30 a 210 mm, altura 20 a 297 mm)'; end if;
  if p_copias is null or p_copias < 1 or p_copias > 200 then raise exception 'Cópias: de 1 a 200'; end if;
  insert into etq_config (empresa_id, codigo, largura_mm, altura_mm, copias, mostrar_fornecedor)
    values (p_empresa, p_codigo, p_largura, p_altura, p_copias, coalesce(p_fornecedor, true))
  on conflict (empresa_id) do update set codigo = excluded.codigo, largura_mm = excluded.largura_mm, altura_mm = excluded.altura_mm,
    copias = excluded.copias, mostrar_fornecedor = excluded.mostrar_fornecedor, atualizado_em = now();
end $$;
revoke all on function public.etq_config_salvar(uuid, text, int, int, int, boolean) from public, anon;
grant execute on function public.etq_config_salvar(uuid, text, int, int, int, boolean) to authenticated;
revoke all on function public._etq_fixa() from public, anon, authenticated;
