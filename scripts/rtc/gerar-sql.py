#!/usr/bin/env python3
"""Gera a migração com as tabelas oficiais de classificação do IBS/CBS a partir do repositório aberto da Receita Federal
(github.com/ReceitaFederal/calculadora-rtc-regime-regular, licença MIT).

Uso:  python3 -I scripts/rtc/gerar-sql.py <pasta do repositório clonado> <arquivo .sql de saída> [commit] [versão da calculadora]

Monta a base SQLite em memória com os scripts da pasta flyway/ (na mesma ordem do Flyway) e escreve os INSERTs das tabelas
rtc_* só com o que é de CBS/IBS (o Imposto Seletivo fica de fora). Para atualizar a plataforma quando a Receita publicar
versão nova: clonar de novo, rodar este script apontando para uma migração NOVA e aplicar.
"""
import sqlite3, sys, os, glob, re

repo, saida = sys.argv[1], sys.argv[2]
commit = sys.argv[3] if len(sys.argv) > 3 else ''
versao = sys.argv[4] if len(sys.argv) > 4 else ''
fw = os.path.join(repo, 'flyway', 'sql')
db = sqlite3.connect(':memory:')

def rodar(p):
    t = open(p, encoding='utf-8').read()
    # o Flyway roda cada migração numa transação; as que mexem em PRAGMA foreign_keys rodam fora (flyway.mixed=true)
    if os.path.basename(p).startswith('V') and not re.search(r'(?im)^\s*pragma\s+foreign_keys', t): t = 'BEGIN;\n' + t + '\nCOMMIT;'
    db.executescript(t)

rodar(os.path.join(fw, 'criacao', 'beforeMigrate.sql'))
rodar(os.path.join(fw, 'criacao', 'B0001__sistema_tributario_completo.sql'))
for p in sorted(glob.glob(os.path.join(fw, 'manutencao', 'V*.sql'))): rodar(p)
rodar(os.path.join(fw, 'criacao', 'afterMigrate.sql'))
if db.execute('pragma foreign_key_check').fetchall(): sys.exit('base gerada com chave estrangeira quebrada')

q = lambda s: db.execute(s).fetchall()
CBS = "exists (select 1 from TRIBUTO_SITUACAO_TRIBUTARIA x join TRIBUTO t on t.TBTO_ID = x.TRST_TBTO_ID where x.TRST_SITR_ID = s.SITR_ID and t.TBTO_SIGLA = 'CBS')"
ultima = max(int(os.path.basename(p)[1:5]) for p in glob.glob(os.path.join(fw, 'manutencao', 'V*.sql')))

def lit(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace("'", "''") + "'"
def linhas(tabela, colunas, dados, por=200):
    out = []
    for i in range(0, len(dados), por):
        out.append(f'insert into public.{tabela} ({colunas}) values\n' + ',\n'.join('(' + ', '.join(lit(v) for v in r) + ')' for r in dados[i:i + por]) + ';')
    return '\n'.join(out)
b = lambda v: bool(v)

cst = [(c, d, i, f, b(g), b(r), b(dif)) for c, d, i, f, g, r, dif in q(f"select SITR_CD, SITR_DESCRICAO, SITR_INICIO_VIGENCIA, SITR_FIM_VIGENCIA, SITR_IND_GIBSCBS, SITR_IND_GRED, SITR_IND_GDIF from SITUACAO_TRIBUTARIA s where {CBS} order by 1")]
red = {}
for cl, sg, v in q("select PERE_CLTR_ID, t.TBTO_SIGLA, PERE_VALOR from PERCENTUAL_REDUCAO p join TRIBUTO t on t.TBTO_ID = p.PERE_TBTO_ID where PERE_FIM_VIGENCIA is null"): red[(cl, sg)] = v
mod = {}
for cl, tp in q("select TDCL_CLTR_ID, t.TPDF_TIPO from TIPO_DFE_CLASSIFICACAO d join TIPO_DFE t on t.TPDF_ID = d.TDCL_TPDF_ID where d.TDCL_FIM_VIGENCIA is null and t.TPDF_TIPO is not null order by 2"): mod.setdefault(cl, []).append(tp)
fund = dict(q("select FDCL_CLTR_ID, f.FDLG_TEXTO_CURTO from FUNDAMENTACAO_CLASSIFICACAO x join FUNDAMENTACAO_LEGAL f on f.FDLG_ID = x.FDCL_FDLG_ID"))
ct, ids = [], {}
for r in q(f"""select c.CLTR_ID, c.CLTR_CD, s.SITR_CD, c.CLTR_DESCRICAO, c.CLTR_TIPO_ALIQUOTA, c.CLTR_NOMENCLATURA, nullif(c.CLTR_ANEXO, ''), c.CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_CBS,
      c.CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_IBS, c.CLTR_CREDITO_OPERACAO_ANTECEDENTE, c.CLTR_IN_CREDITO_PRESUMIDO_FORNECEDOR, c.CLTR_IN_CREDITO_PRESUMIDO_ADQUIRENTE,
      c.CLTR_INICIO_VIGENCIA, c.CLTR_FIM_VIGENCIA, c.CLTR_DATA_ATUALIZACAO
      from CLASSIFICACAO_TRIBUTARIA c join SITUACAO_TRIBUTARIA s on s.SITR_ID = c.CLTR_SITR_ID where {CBS} order by c.CLTR_CD"""):
    i = r[0]; ids[i] = r[1]
    ct.append((r[1], r[2], r[3].strip(), r[4], r[5], r[6], red.get((i, 'CBS'), 0), red.get((i, 'IBSUF'), 0), red.get((i, 'IBSMun'), 0), b(r[7]), b(r[8]), r[9], b(r[10]), b(r[11]),
               (fund.get(i) or '').strip() or None, r[12], r[13], '{' + ','.join(str(m) for m in mod.get(i, [])) + '}', r[14]))
if len({c[0] for c in ct}) != len(ct): sys.exit('cClassTrib repetido na base')
ncm = [(i, ids[cl], n, a, f) for i, n, cl, a, f in q("select NCMA_ID, NCMA_NCM_CD, NCMA_CLTR_ID, NCMA_INICIO_VIGENCIA, NCMA_FIM_VIGENCIA from NCM_APLICAVEL order by 1") if cl in ids]
vid = {r[0] for r in ncm}
exc = [r for r in q("select ENCM_ID, ENCM_NCMA_ID, ENCM_NCM_CD, ENCM_INICIO_VIGENCIA, ENCM_FIM_VIGENCIA from EXCECAO_NCM_APLICAVEL order by 1") if r[1] in vid]

cab = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cabecalho.sql'), encoding='utf-8').read()
corpo = [cab, '',
  'truncate public.rtc_classtrib_ncm_exc, public.rtc_classtrib_ncm, public.rtc_classtrib, public.rtc_cst;', '',
  linhas('rtc_cst', 'cst, descricao, inicio, fim, grupo_ibscbs, reducao, diferimento', cst), '',
  linhas('rtc_classtrib', 'codigo, cst, descricao, tipo_aliquota, nomenclatura, anexo, red_cbs, red_ibs_uf, red_ibs_mun, credito_adquirente_cbs, credito_adquirente_ibs, credito_antecedente, credito_presumido_fornecedor, credito_presumido_adquirente, fundamento, inicio, fim, modelos, atualizado_em', ct, 60), '',
  linhas('rtc_classtrib_ncm', 'id, codigo, ncm, inicio, fim', ncm, 400), '',
  linhas('rtc_classtrib_ncm_exc', 'id, vinculo_id, ncm, inicio, fim', exc), '',
  f"insert into public.rtc_base (id, versao_base, calculadora, commit, fonte, linhas) values (1, {lit('V%04d' % ultima)}, {lit(versao)}, {lit(commit)}, 'github.com/ReceitaFederal/calculadora-rtc-regime-regular', jsonb_build_object('cst', {len(cst)}, 'classtrib', {len(ct)}, 'ncm', {len(ncm)}, 'excecoes', {len(exc)}))",
  '  on conflict (id) do update set versao_base = excluded.versao_base, calculadora = excluded.calculadora, commit = excluded.commit, fonte = excluded.fonte, linhas = excluded.linhas, carregada_em = now();', '']
open(saida, 'w', encoding='utf-8').write('\n'.join(corpo))
print(f'cst {len(cst)} · cClassTrib {len(ct)} · vínculos NCM {len(ncm)} · exceções {len(exc)} · base V{ultima:04d}')
