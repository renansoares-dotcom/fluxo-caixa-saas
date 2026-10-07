-- Endosso para fornecedores (06/10): beneficiário pode ser fornecedor do cadastro de favorecidos;
-- modalidade do endosso (translativo ou em garantia) e referência da garantia registradas na duplicata.
alter table public.beneficiarios_endosso
  add column if not exists tipo text not null default 'FIDC' check (tipo in ('FIDC', 'Fornecedor', 'Banco', 'Outro')),
  add column if not exists favorecido_id uuid references public.favorecidos(id) on delete set null;
alter table public.duplicatas
  add column if not exists modalidade text not null default 'translativo' check (modalidade in ('translativo', 'garantia')),
  add column if not exists referencia text;
