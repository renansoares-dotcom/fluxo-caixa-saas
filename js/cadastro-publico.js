// Página pública da atualização cadastral da reforma tributária (COM010, SQL 198): o cliente abre o link recebido, sem
// login, confere os dados que já temos, preenche o questionário e envia. Tudo passa por funções do banco que só aceitam o
// token do link (cadq_link_abrir / cadq_link_responder).
import { createClient } from '../vendor/supabase-2.117.2.esm.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { $, $$, esc, dateBR, toast, fail } from './lib/ui.js';
import { DESTINACOES, REGIMES, CONTRIB, SIM_NAO, SIMPLES_REGULAR, REDUCOES, conferir, tipoPelaDestinacao } from './lib/cadastro-reforma.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const q = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const token = new URLSearchParams(location.search).get('t') || '';
const main = $('#cq-main');
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

async function iniciar() {
  if (!/^[0-9a-f]{64}$/.test(token)) { main.innerHTML = '<div class="card"><h2 style="margin-top:0">Link inválido</h2><p>Confira se o link foi copiado inteiro. Se o problema continuar, peça um novo link a quem enviou.</p></div>'; return; }
  let C; try { C = await q(sb.rpc('cadq_link_abrir', { p_token: token })); } catch (err) { main.innerHTML = `<div class="card"><h2 style="margin-top:0">Não foi possível abrir</h2><p>${esc(err.message)}</p></div>`; return; }
  $('#cq-emp').textContent = C.empresa || '';
  document.title = `Atualização cadastral — ${C.empresa}`;
  pintar(C);
}

const radios = (nome, L, sel, dis) => `<div class="cq-op">${L.map(([v, t]) => `<label><input type="radio" name="${nome}" value="${v}" ${String(sel ?? '') === v ? 'checked' : ''} ${dis}> ${esc(t)}</label>`).join('')}</div>`;
const checks = (nome, L, sel, dis) => `<div class="cq-op">${L.map(([v, t]) => `<label><input type="checkbox" name="${nome}" value="${v}" ${(sel || []).includes(v) ? 'checked' : ''} ${dis}> ${esc(t)}</label>`).join('')}</div>`;
const campo = (rot, nome, v, extra = '', cls = '') => `<label class="${cls}">${rot}<input name="${nome}" value="${esc(v ?? '')}" ${extra}></label>`;

function pintar(C) {
  const a = C.atual || {}, fechado = C.vencido || ['cancelado', 'aplicado', 'descartado'].includes(C.situacao), dis = fechado ? 'disabled' : '';
  const e = a.especiais || {}, cf = a.contato_fiscal || {}, ct = a.contador || {}, dc = a.declarante || {};
  const aviso = C.situacao === 'cancelado' ? '<div class="cq-aviso">Este questionário foi cancelado. Se precisar, peça um novo link.</div>'
    : ['aplicado', 'descartado'].includes(C.situacao) ? '<div class="cq-ok">Recebemos e conferimos as suas informações. Obrigado!</div>'
    : C.vencido ? `<div class="cq-aviso">O prazo deste link terminou em ${dateBR(C.expira_em)}. Peça um novo link a quem enviou.</div>`
    : C.situacao === 'respondido' ? `<div class="cq-ok">Recebemos as suas respostas em ${new Date(C.respondido_em).toLocaleString('pt-BR').slice(0, 17)}. Você pode corrigir e enviar de novo até ${dateBR(C.expira_em)}.</div>`
    : `<div class="small muted">Leva uns 5 minutos. Preencha até <b>${dateBR(C.expira_em)}</b>. Os campos já preenchidos são os que temos hoje: confira e corrija o que estiver diferente.</div>`;
  main.innerHTML = `<div class="card"><h2 style="margin:0">${esc(C.cliente)}</h2>
      <p style="margin:8px 0 0">${esc(C.empresa)} está atualizando o cadastro dos clientes para a <b>reforma tributária</b> (o IBS e a CBS, que vão substituir o ICMS, o ISS, o PIS e a COFINS; a transição começou em 2026). Com estas informações, as nossas notas fiscais saem certas para a sua empresa e você aproveita os créditos a que tem direito.</p>
      ${C.mensagem ? `<p style="white-space:pre-wrap;margin:10px 0 0">${esc(C.mensagem)}</p>` : ''}<div style="margin-top:10px">${aviso}</div></div>
    <form id="cq-f" novalidate>
    <div class="card" style="margin-top:12px"><h3>1. Dados da empresa</h3><div class="grid-form">
      ${campo('Razão social', 'razao_social', a.razao_social, 'readonly', 'span2')}${campo('CNPJ/CPF', 'documento', a.documento, 'readonly')}
      ${campo('Nome fantasia', 'nome_fantasia', a.nome_fantasia, `maxlength="120" ${dis}`, 'span2')}${campo('Inscrição estadual', 'ie', a.ie, `maxlength="20" ${dis} placeholder="ou ISENTO"`)}
      ${campo('Inscrição municipal', 'im', a.im, `maxlength="20" ${dis}`)}${campo('CEP', 'cep', a.cep, `maxlength="9" inputmode="numeric" ${dis}`)}
      ${campo('Logradouro', 'logradouro', a.logradouro, `maxlength="120" ${dis}`, 'span2')}${campo('Número', 'numero', a.numero, `maxlength="10" ${dis}`)}
      ${campo('Complemento', 'complemento', a.complemento, `maxlength="60" ${dis}`)}${campo('Bairro', 'bairro', a.bairro, `maxlength="60" ${dis}`)}
      ${campo('Município', 'municipio', a.municipio, `maxlength="60" ${dis}`)}
      <label>UF<select name="uf" ${dis}><option value=""></option>${UFS.map(u => `<option ${u === a.uf ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
      ${campo('E-mail para receber a NF-e e o XML', 'email_nfe', a.email_nfe, `type="email" maxlength="120" ${dis}`, 'span2')}${campo('Telefone', 'telefone', a.telefone, `maxlength="20" inputmode="tel" ${dis}`)}</div>
      <div class="cq-q">Quem cuida da parte fiscal na sua empresa</div><div class="grid-form">
      ${campo('Nome', 'cf_nome', cf.nome, `maxlength="80" ${dis}`)}${campo('E-mail', 'cf_email', cf.email, `type="email" maxlength="120" ${dis}`)}${campo('Telefone', 'cf_tel', cf.telefone, `maxlength="20" ${dis}`)}</div>
      <div class="cq-q">Escritório de contabilidade (opcional)</div><div class="grid-form">
      ${campo('Nome', 'ct_nome', ct.nome, `maxlength="80" ${dis}`)}${campo('E-mail', 'ct_email', ct.email, `type="email" maxlength="120" ${dis}`)}${campo('Telefone', 'ct_tel', ct.telefone, `maxlength="20" ${dis}`)}</div></div>
    <div class="card" style="margin-top:12px"><h3>2. ICMS</h3>
      <div class="cq-q">A empresa é contribuinte do ICMS? *</div>${radios('contribuinte_icms', CONTRIB, a.contribuinte_icms, dis)}
      <div class="cq-q">Para que a empresa usa o que compra de nós? *</div><div class="cq-dica">Pode marcar mais de um.</div>${checks('destinacao', DESTINACOES, a.destinacao, dis)}
      <div class="grid-form">${campo('CNAE principal (opcional)', 'cnae', a.cnae, `maxlength="12" ${dis} placeholder="ex.: 2222-6/00"`)}</div></div>
    <div class="card" style="margin-top:12px"><h3>3. Regime tributário e créditos</h3>
      <div class="cq-q">Regime tributário *</div>${radios('regime', REGIMES, a.regime, dis)}
      <div id="cq-cred"><div class="cq-q">A empresa aproveita o crédito do ICMS das compras?</div>${radios('cred_icms', SIM_NAO, a.cred_icms, dis)}</div>
      <div id="cq-pc"><div class="cq-q">A empresa aproveita o crédito de PIS/COFINS das compras (não cumulativo)?</div>${radios('cred_pc', SIM_NAO, a.cred_pc, dis)}</div>
      <div id="cq-sn"><div class="cq-q">Na reforma, a empresa vai recolher o IBS e a CBS pelo regime regular, fora do Simples?</div>
        <div class="cq-dica">A partir de 2027, a empresa do Simples pode escolher recolher o IBS e a CBS por fora do Simples. Com isso, quem compra dela aproveita o crédito integral.</div>${radios('simples_regular', SIMPLES_REGULAR, a.simples_regular, dis)}</div></div>
    <div class="card" style="margin-top:12px"><h3>4. Situações especiais</h3><div class="cq-dica">Preencha só o que se aplica à sua empresa.</div>
      <div class="grid-form">${campo('Benefício fiscal de ICMS (qual?)', 'beneficio_icms', e.beneficio_icms, `maxlength="200" ${dis}`, 'span2')}
      <label>Redução de alíquota na reforma<select name="reducao" ${dis}><option value=""></option>${REDUCOES.map(([v, t]) => `<option value="${v}" ${v === e.reducao ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${campo('Imunidade ou isenção (qual?)', 'imunidade', e.imunidade, `maxlength="200" ${dis}`, 'span2')}</div>
      <div class="cq-op"><label><input type="checkbox" name="zfm" ${e.zfm ? 'checked' : ''} ${dis}> Estabelecida na Zona Franca de Manaus ou em Área de Livre Comércio</label>
        <label><input type="checkbox" name="orgao_publico" ${e.orgao_publico ? 'checked' : ''} ${dis}> Órgão público, autarquia ou fundação pública</label>
        <label><input type="checkbox" name="produtor_rural" ${e.produtor_rural ? 'checked' : ''} ${dis}> Produtor rural</label></div>
      <label>Observações<textarea name="observacao" rows="2" maxlength="1000" ${dis}>${esc(e.observacao || '')}</textarea></label></div>
    <div class="card" style="margin-top:12px"><h3>5. Quem está respondendo</h3><div class="grid-form">
      ${campo('Seu nome *', 'dc_nome', dc.nome, `maxlength="100" ${dis}`, 'span2')}${campo('Cargo', 'dc_cargo', dc.cargo, `maxlength="60" ${dis}`)}
      ${campo('Seu e-mail', 'dc_email', dc.email, `type="email" maxlength="120" ${dis}`, 'span2')}</div>
      <div class="cq-op"><label><input type="checkbox" name="aceite" ${dis}> Declaro que as informações acima são verdadeiras e autorizo o uso delas no cadastro e na emissão das notas fiscais.</label></div>
      ${fechado ? '' : `<div style="display:flex;justify-content:flex-end;margin-top:10px"><button type="submit" class="btn primary">${C.situacao === 'respondido' ? 'Enviar a correção' : 'Enviar as respostas'}</button></div>`}</div></form>
    <p class="small muted" style="margin-top:12px">As respostas vão direto para ${esc(C.empresa)}. Esta página não pede cadastro nem senha.</p>`;
  const f = $('#cq-f'), val = (n) => f.querySelector(`[name="${n}"]:checked`)?.value || '';
  const mostrar = () => { const r = val('regime'), c = val('contribuinte_icms');
    $('#cq-cred').style.display = c === '9' || r === 'simples' || r === 'mei' ? 'none' : '';
    $('#cq-pc').style.display = r === 'real' ? '' : 'none';
    $('#cq-sn').style.display = r === 'simples' || r === 'mei' ? '' : 'none'; };
  f.onchange = mostrar; mostrar();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const t = (n) => (f.elements[n]?.value || '').trim(), r = val('regime'), c = val('contribuinte_icms');
    const destinacao = $$('[name=destinacao]:checked', f).map(x => x.value);
    const d = { nome_fantasia: t('nome_fantasia'), ie: t('ie'), im: t('im'), cep: t('cep'), logradouro: t('logradouro'), numero: t('numero'), complemento: t('complemento'),
      bairro: t('bairro'), municipio: t('municipio'), uf: t('uf'), email_nfe: t('email_nfe').toLowerCase(), telefone: t('telefone'),
      contato_fiscal: { nome: t('cf_nome'), email: t('cf_email'), telefone: t('cf_tel') }, contador: { nome: t('ct_nome'), email: t('ct_email'), telefone: t('ct_tel') },
      contribuinte_icms: c, destinacao, tipo: tipoPelaDestinacao(destinacao, c), cnae: t('cnae'), regime: r,
      cred_icms: c === '9' || r === 'simples' || r === 'mei' ? 'nao' : val('cred_icms'), cred_pc: r === 'real' ? val('cred_pc') : 'nao',
      simples_regular: r === 'simples' || r === 'mei' ? val('simples_regular') : '',
      especiais: { beneficio_icms: t('beneficio_icms'), reducao: t('reducao'), imunidade: t('imunidade'), zfm: f.zfm.checked, orgao_publico: f.orgao_publico.checked,
        produtor_rural: f.produtor_rural.checked, observacao: t('observacao') },
      declarante: { nome: t('dc_nome'), cargo: t('dc_cargo'), email: t('dc_email') }, aceite: f.aceite.checked };
    const P = conferir(d);
    if (P.length) return toast(P[0], true);
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      await q(sb.rpc('cadq_link_responder', { p_token: token, p_dados: d }));
      sb.functions.invoke('notificar', { body: {} }).catch(() => {});
      toast('Respostas enviadas. Obrigado!'); scrollTo(0, 0); iniciar();
    } catch (err) { fail(err); btn.disabled = false; }
  };
}
iniciar();
