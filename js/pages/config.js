import { sb, state, q, fetchAll, isAdmin, podeEditar, loadCadastros } from '../lib/data.js';
import { $, esc, options, formData, toast, fail, parseNum, dateBR, money, exportXLSX } from '../lib/ui.js';

export const title = 'Empresa e usuários';
const PAPEIS = [['admin', 'Administrador — tudo, inclusive usuários'], ['financeiro', 'Financeiro — lança e edita'], ['diretor', 'Diretor — consulta e aprova autorizações'], ['leitura', 'Leitura — só consulta']];

export async function render(root) {
  const e = state.empresa, adm = isAdmin();
  root.innerHTML = `
    <div class="grid2">
      <div class="card"><h2>Dados da empresa</h2>
        <form id="ef" class="grid-form">
          <label class="span2">Nome<input name="nome" value="${esc(e.nome)}" required ${adm ? '' : 'disabled'}></label>
          <label>CNPJ<input name="cnpj" value="${esc(e.cnpj || '')}" ${adm ? '' : 'disabled'}></label>
          <label>Ano de início do controle<input name="ano_inicio" type="number" value="${e.ano_inicio}" ${adm ? '' : 'disabled'}></label>
          <label class="span2">Elaborado por (nome no PDF de autorização)<input name="elaborado_por" value="${esc(e.elaborado_por || '')}" ${adm ? '' : 'disabled'}></label>
          <div class="span2 small muted" style="margin-top:6px"><strong>Emitente das duplicatas</strong></div>
          ${[['razao_social', 'Razão social', 1], ['ie', 'Inscrição estadual'], ['cep', 'CEP'], ['logradouro', 'Endereço', 1], ['municipio', 'Município'], ['uf', 'UF'],
            ['responsavel_nome', 'Responsável legal'], ['responsavel_cpf', 'CPF do responsável'], ['avalista_nome', 'Avalista'], ['avalista_cpf', 'CPF do avalista']]
            .map(([k, t, sp]) => `<label class="${sp ? 'span2' : ''}">${t}<input name="${k}" value="${esc(e[k] || '')}" ${adm ? '' : 'disabled'}></label>`).join('')}
        </form>
        ${adm ? '<div style="margin-top:12px"><button class="btn primary" id="esave">Salvar</button></div>' : ''}
      </div>
      <div class="card"><h2>Usuários</h2><div id="mem" class="table-wrap"></div>
        ${adm ? `<form id="mf" class="toolbar" style="margin-top:12px">
          <label class="grow">E-mail do usuário<input name="email" type="email" required placeholder="a pessoa precisa ter criado a conta"></label>
          <label>Papel<select name="papel">${options(PAPEIS.map(([id, nome]) => ({ id, nome: id })), { selected: 'financeiro' })}</select></label>
          <button class="btn primary">Adicionar</button></form>
          <p class="muted small">${PAPEIS.map(p => `<strong>${p[0]}</strong>: ${p[1].split('— ')[1]}`).join(' · ')}</p>` : ''}
      </div>
    </div>
    ${podeEditar() ? `<div class="card"><h2>Importar lançamentos (Excel ou CSV)</h2>
      <p class="muted small" style="margin-top:0">Colunas aceitas (cabeçalho na 1ª linha): <strong>Data</strong>, <strong>Plano de contas</strong> (código, ex. 2.05.09, ou "2.05.09 - NOME"),
      <strong>Valor</strong>, Descrição, Favorecido, Centro de Custo, Status (Pago / Em aberto), Conta, Opcional 1..4. É o mesmo layout das abas mensais da planilha
      e do Excel exportado em Lançamentos. Beneficiários novos são cadastrados automaticamente.</p>
      <div class="toolbar"><input type="file" id="arq" accept=".xlsx,.xls,.xlsm,.csv"><button class="btn" id="modelo">Baixar modelo</button></div>
      <div id="prev" style="margin-top:12px"></div></div>` : ''}
    ${adm ? `<div class="card"><h2>Importar base completa (migração da planilha)</h2>
      <p class="muted small" style="margin-top:0">Carrega um arquivo <strong>.json</strong> gerado a partir da planilha Fluxo de Caixa (cadastros, lançamentos, budget/forecast e FIDC).
      Só funciona em empresa <strong>sem lançamentos</strong>. Plano de contas, contas, centros de custo e grupos são atualizados pelo arquivo; os <strong>beneficiários já cadastrados são preservados</strong> (só o que estiver vazio é completado) e os novos são incluídos. Budget/forecast, base FIDC e autorizações são substituídos.</p>
      <div class="toolbar"><input type="file" id="arq-base" accept=".json"></div><div id="base-log" class="small" style="margin-top:10px"></div></div>` : ''}`;
  if (adm) $('#arq-base', root).onchange = (ev) => importarBase(ev.target.files[0], root);

  if (adm) $('#esave', root).onclick = async () => {
    const d = formData($('#ef', root));
    try {
      const row = await q(sb.from('empresas').update({ nome: d.nome, cnpj: d.cnpj, ano_inicio: +d.ano_inicio, elaborado_por: d.elaborado_por, ...Object.fromEntries(['razao_social', 'ie', 'cep', 'logradouro', 'municipio', 'uf', 'responsavel_nome', 'responsavel_cpf', 'avalista_nome', 'avalista_cpf'].map(k => [k, (d[k] || '').trim() || null])) }).eq('id', e.id).select().single());
      Object.assign(state.empresa, row); document.querySelector('#empresa-switch').textContent = row.nome + ' ▾'; toast('Dados salvos');
    } catch (err) { fail(err); }
  };
  await membros(root);
  if (adm) $('#mf', root).onsubmit = async (ev) => {
    ev.preventDefault(); const d = formData(ev.target);
    try { await q(sb.rpc('adicionar_membro', { p_empresa: e.id, p_email: d.email, p_papel: d.papel })); toast('Usuário adicionado'); ev.target.reset(); membros(root); } catch (err) { fail(err); }
  };
  if (podeEditar()) {
    $('#modelo', root).onclick = () => exportXLSX([['Data', 'Plano de contas', 'Descrição', 'Favorecido', 'Centro de Custo', 'Status', 'Conta', 'Valor', 'Opcional 1'],
      [new Date().toISOString().slice(0, 10), state.cad.contasPlano[0]?.label || '', 'Exemplo', '', state.cad.cc[0]?.nome || '', 'Pago', state.cad.contas[0]?.nome || '', 100, '']], 'modelo_importacao');
    $('#arq', root).onchange = (ev) => importar(ev.target.files[0], root);
  }
}

async function membros(root) {
  const el = $('#mem', root);
  try {
    const rows = await q(sb.rpc('listar_membros', { p_empresa: state.empresa.id }));
    const adm = isAdmin();
    el.innerHTML = `<table><thead><tr><th>E-mail</th><th>Papel</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr data-u="${r.user_id}"><td>${esc(r.email)}</td>
        <td>${adm && r.user_id !== state.user.id ? `<select class="pap">${options(PAPEIS.map(([id]) => ({ id, nome: id })), { selected: r.papel })}</select>` : esc(r.papel)}</td>
        <td>${adm && r.user_id !== state.user.id ? '<button class="btn small danger rm">Remover</button>' : ''}</td></tr>`).join('')}</tbody></table>`;
    el.onchange = async (ev) => {
      if (!ev.target.matches('.pap')) return;
      try { await q(sb.from('membros').update({ papel: ev.target.value }).eq('empresa_id', state.empresa.id).eq('user_id', ev.target.closest('tr').dataset.u)); toast('Papel alterado'); } catch (err) { fail(err); }
    };
    el.onclick = async (ev) => {
      if (!ev.target.matches('.rm') || !confirm('Remover acesso deste usuário?')) return;
      try { await q(sb.from('membros').delete().eq('empresa_id', state.empresa.id).eq('user_id', ev.target.closest('tr').dataset.u)); membros(root); } catch (err) { fail(err); }
    };
  } catch (err) { fail(err); }
}

// ------------------------------------------------------------------
// Importação de lançamentos
// ------------------------------------------------------------------
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function toISO(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
  const s = String(v || '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  return null;
}

async function importar(file, root) {
  const prev = $('#prev', root); if (!file) return;
  prev.innerHTML = '<div class="loading">Lendo arquivo…</div>';
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    const c = state.cad;
    const pick = (r, ...names) => { for (const k of Object.keys(r)) if (names.includes(norm(k))) return r[k]; return null; };
    const planoByCod = Object.fromEntries(c.contasPlano.map(p => [p.codigo, p]));
    const contaByNome = Object.fromEntries(c.contas.map(x => [norm(x.nome), x]));
    const ccByNome = Object.fromEntries(c.cc.map(x => [norm(x.nome), x]));
    const favByLabel = {}; c.favorecidos.forEach(f => { favByLabel[norm(f.label)] = f; favByLabel[norm(f.nome)] ||= f; });
    const ok = [], erros = [], novosFav = new Map();
    raw.forEach((r, i) => {
      const linha = i + 2;
      const data = toISO(pick(r, 'data', 'dia', 'vencimento'));
      const pl = String(pick(r, 'plano de contas', 'plano', 'conta contabil') || '').trim();
      const plano = planoByCod[pl.split(' ')[0]];
      const valor = Math.abs(parseNum(pick(r, 'valor')));
      if (!data || !plano || !valor) { erros.push(`Linha ${linha}: ${!data ? 'data inválida' : !plano ? `plano "${pl}" não encontrado` : 'valor vazio'}`); return; }
      const contaN = pick(r, 'conta', 'banco'); const conta = contaN ? contaByNome[norm(contaN)] : null;
      if (contaN && !conta) { erros.push(`Linha ${linha}: conta "${contaN}" não cadastrada`); return; }
      const favN = pick(r, 'favorecido', 'favorecidos', 'cliente/fornecedor');
      let fav = favN ? favByLabel[norm(favN)] : null;
      if (favN && !fav) { const nome = String(favN).replace(/^[A-ZÁÉÍÓÚÇ]{3}\s*-\s*/i, '').trim().toUpperCase(); novosFav.set(nome, plano.tipo === 'E' ? 'CLIENTES' : 'FORNECEDORES'); }
      const st = norm(pick(r, 'status')) === 'em aberto' ? 'Em aberto' : 'Pago';
      ok.push({ data, plano_id: plano.id, valor, status: st, conta_id: conta?.id || null, favN, fav_id: fav?.id || null,
        descricao: pick(r, 'descricao', 'historico'), centro_custo_id: ccByNome[norm(pick(r, 'centro de custo', 'c. custo', 'cc'))]?.id || null,
        opc1: pick(r, 'opcional 1', 'opcional'), opc2: pick(r, 'opcional 2'), opc3: pick(r, 'opcional 3'), opc4: pick(r, 'opcional 4') });
    });
    const tot = ok.reduce((s, x) => s + x.valor, 0);
    prev.innerHTML = `<div class="kpis"><div class="kpi"><div class="k-label">Linhas válidas</div><div class="k-value">${ok.length}</div><div class="k-sub">soma ${money(tot)}</div></div>
      <div class="kpi"><div class="k-label">Com erro</div><div class="k-value ${erros.length ? 'neg' : ''}">${erros.length}</div></div>
      <div class="kpi"><div class="k-label">Beneficiários novos</div><div class="k-value">${novosFav.size}</div></div></div>
      ${erros.length ? `<details style="margin-top:10px"><summary class="neg">Ver erros</summary><div class="small">${erros.slice(0, 200).map(esc).join('<br>')}</div></details>` : ''}
      ${ok.length ? `<p class="small muted">Período: ${dateBR(ok.map(x => x.data).sort()[0])} a ${dateBR(ok.map(x => x.data).sort().pop())}</p><button class="btn primary" id="imp">Importar ${ok.length} lançamentos</button>` : ''}`;
    if (ok.length) $('#imp', root).onclick = async () => {
      $('#imp', root).disabled = true;
      try {
        if (novosFav.size) {
          const ins = [...novosFav].map(([nome, tipo]) => ({ empresa_id: state.empresa.id, nome, tipo, sigla: tipo === 'CLIENTES' ? 'CLI' : 'FOR' }));
          for (let i = 0; i < ins.length; i += 500) await q(sb.from('favorecidos').upsert(ins.slice(i, i + 500), { onConflict: 'empresa_id,tipo,nome', ignoreDuplicates: true }));
          await loadCadastros(true);
          state.cad.favorecidos.forEach(f => { favByLabel[norm(f.label)] = f; favByLabel[norm(f.nome)] ||= f; });
        }
        const rows = ok.map(({ favN, fav_id, ...x }) => ({ ...x, empresa_id: state.empresa.id, origem: `import:${file.name}`,
          favorecido_id: fav_id || (favN ? (favByLabel[norm(favN)] || favByLabel[norm(String(favN).replace(/^[A-ZÁÉÍÓÚÇ]{3}\s*-\s*/i, ''))])?.id : null) || null }));
        for (let i = 0; i < rows.length; i += 500) {
          await q(sb.from('lancamentos').insert(rows.slice(i, i + 500)));
          $('#imp', root).textContent = `Importando… ${Math.min(i + 500, rows.length)}/${rows.length}`;
        }
        toast(`${rows.length} lançamentos importados`); prev.innerHTML = '';
      } catch (err) { fail(err); $('#imp', root).disabled = false; }
    };
  } catch (err) { fail(err); prev.innerHTML = ''; }
}

// ------------------------------------------------------------------
// Importação da base completa (JSON gerado da planilha)
// ------------------------------------------------------------------
async function importarBase(file, root) {
  const log = $('#base-log', root); if (!file) return;
  const say = (m) => { log.innerHTML += esc(m) + '<br>'; };
  log.innerHTML = '';
  try {
    const d = JSON.parse(await file.text());
    if (d.formato !== 'fluxo-caixa-base-v1') throw new Error('Arquivo não reconhecido (formato esperado: fluxo-caixa-base-v1)');
    const e = state.empresa.id;
    const { count } = await sb.from('lancamentos').select('id', { count: 'exact', head: true }).eq('empresa_id', e);
    if (count) throw new Error(`Esta empresa já tem ${count} lançamentos. Crie uma empresa nova para importar a base.`);
    if (!confirm(`Importar ${d.lancamentos.length.toLocaleString('pt-BR')} lançamentos, ${d.plano_contas.length} contas do plano, ${d.favorecidos.length} favorecidos e ${d.fidc_operacoes?.length || 0} borderôs FIDC em "${state.empresa.nome}"?`)) return;
    $('#arq-base', root).disabled = true;
    say('Limpando budget, forecast, base FIDC e autorizações…');
    for (const t of ['orcamentos', 'forecast_status', 'fidc_titulos', 'fidc_operacoes', 'autorizacao_itens', 'autorizacoes']) await q(sb.from(t).delete().eq('empresa_id', e));
    const map = new Map(); const nid = (old) => { if (!old) return null; if (!map.has(old)) map.set(old, crypto.randomUUID()); return map.get(old); };
    // Cadastros são MESCLADOS (não apagados): o que já existe é reaproveitado pelo mesmo id, preservando o que foi
    // cadastrado na plataforma (parâmetros dos beneficiários, endereços, fundos, beneficiários de endosso etc.).
    //  - 'sobrescrever': a planilha manda (plano, contas, centros, grupos) — atualiza os campos que vierem preenchidos;
    //  - 'completar': a plataforma manda (beneficiários) — só preenche o que estiver vazio.
    const normN = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
    const mesclar = async (t, rows, chave, prep, modo, label) => {
      const ex = await fetchAll(() => sb.from(t).select('*').eq('empresa_id', e));
      const porChave = new Map(ex.map(r => [chave(r), r])); const lote = []; let nNovos = 0, nAtual = 0;
      for (const r0 of rows) {
        const r = prep(r0); const old = porChave.get(chave(r));
        if (old) {
          map.set(r0.id, old.id); const m = { ...old };
          for (const [k, v] of Object.entries(r)) if (k !== 'id' && v != null && v !== '' && (modo === 'sobrescrever' || old[k] == null || old[k] === '')) m[k] = v;
          lote.push(m); nAtual++;
        } else { const n = { ...r, id: nid(r0.id) }; lote.push(n); porChave.set(chave(n), n); nNovos++; }
      }
      for (let i = 0; i < lote.length; i += 500) await q(sb.from(t).upsert(lote.slice(i, i + 500), { onConflict: 'id' }));
      say(`✓ ${label || t}: ${nAtual} existente(s) mantido(s)/atualizado(s), ${nNovos} novo(s)`);
    };
    const ins = async (t, rows, label) => {
      for (let i = 0; i < rows.length; i += 1000) {
        await q(sb.from(t).insert(rows.slice(i, i + 1000)));
      }
      say(`✓ ${label || t}: ${rows.length}`);
    };
    const E = (r) => ({ ...r, empresa_id: e });
    await mesclar('grupos', d.grupos, r => normN(r.nome), r => E({ ...r }), 'sobrescrever', 'grupos');
    await mesclar('centros_custo', d.centros_custo, r => normN(r.nome), r => E({ ...r }), 'sobrescrever', 'centros de custo');
    await mesclar('plano_contas', d.plano_contas.filter(r => r.nivel === 1), r => r.codigo, r => E({ ...r, pai_id: null }), 'sobrescrever', 'classificações');
    await mesclar('plano_contas', d.plano_contas.filter(r => r.nivel === 2), r => r.codigo, r => E({ ...r, pai_id: nid(r.pai_id) }), 'sobrescrever', 'contas do plano');
    await mesclar('favorecidos', d.favorecidos, r => `${r.tipo}|${normN(r.nome)}`, r => E({ ...r }), 'completar', 'beneficiários');
    await mesclar('contas', d.contas, r => normN(r.nome), r => E({ ...r, grupo_id: nid(r.grupo_id) }), 'sobrescrever', 'contas bancárias');
    const prog = document.createElement('div'); log.appendChild(prog);
    const L = d.lancamentos.map(r => E({ ...r, plano_id: nid(r.plano_id), favorecido_id: nid(r.favorecido_id), centro_custo_id: nid(r.centro_custo_id), conta_id: nid(r.conta_id) }));
    for (let i = 0; i < L.length; i += 1000) {
      await q(sb.from('lancamentos').insert(L.slice(i, i + 1000)));
      prog.textContent = `Enviando lançamentos (pode levar 1–2 minutos)… ${Math.min(i + 1000, L.length)}/${L.length}`;
    }
    prog.remove(); say(`✓ lançamentos: ${L.length}`);
    if (d.orcamentos?.length) await ins('orcamentos', d.orcamentos.map(r => E({ ...r, plano_id: nid(r.plano_id), centro_custo_id: nid(r.centro_custo_id) })), 'budget/forecast');
    if (d.forecast_status?.length) { await q(sb.from('forecast_status').upsert(d.forecast_status.map(E))); say('✓ status do forecast'); }
    if (d.fidc_operacoes?.length) await ins('fidc_operacoes', d.fidc_operacoes.map(r => E({ ...r, id: nid(r.id), conta_id: nid(r.conta_id) })), 'borderôs FIDC');
    if (d.fidc_titulos?.length) await ins('fidc_titulos', d.fidc_titulos.map(r => E({ ...r, operacao_id: nid(r.operacao_id) })), 'títulos FIDC');
    if (d.empresa) {
      const up = { ano_inicio: d.empresa.ano_inicio, mes_inicio_fiscal: d.empresa.mes_inicio_fiscal, elaborado_por: d.empresa.elaborado_por };
      Object.assign(state.empresa, await q(sb.from('empresas').update(up).eq('id', e).select().single()));
    }
    await loadCadastros(true);
    say('Importação concluída.'); toast('Base importada com sucesso');
  } catch (err) { fail(err); say('Erro: ' + (err.message || err)); }
  finally { const i = $('#arq-base', root); if (i) i.disabled = false; }
}
