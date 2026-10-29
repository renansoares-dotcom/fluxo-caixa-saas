// MDF-e 3.00 (leiaute PL_MDFe_300b) — XML a partir da ficha do frete. Biblioteca pura: sem banco, sem tela.
// O XML sai SEM assinatura: a assinatura (certificado A1 da empresa) e o envio à SEFAZ ficam com o emissor que for
// contratado. A estrutura é conferida contra os esquemas oficiais em tests/mdfe-xml.test.js (xmllint).
import { montarMDFe, soDig, ehAutonomo, limparPlaca } from './mdfe.js';

export const VERSAO = '3.00';
export const UF_IBGE = { RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29,
  MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53 };
const QR = 'https://dfe-portal.svrs.rs.gov.br/mdfe/qrCode';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// texto do MDF-e: sem quebra de linha nem espaços repetidos, cortado no tamanho do campo
const txt = (s, max = 60) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const dec = (v, casas = 2) => (+v || 0).toFixed(casas);
const vazio = (v) => v === undefined || v === null || v === '';
/** elemento: some quando o valor é vazio; filhos podem ser string já montada */
function el(nome, valor) { return vazio(valor) ? '' : `<${nome}>${typeof valor === 'object' ? valor.xml : esc(valor)}</${nome}>`; }
const grupo = (nome, ...filhos) => { const x = filhos.join(''); return x ? `<${nome}>${x}</${nome}>` : ''; };
const doc = (d) => { const x = soDig(d); return x.length === 11 ? el('CPF', x) : el('CNPJ', x); };

/** dígito da chave (módulo 11, pesos 2 a 9) */
export function dvChave(c43) {
  let s = 0, p = 2;
  for (let i = c43.length - 1; i >= 0; i--) { s += +c43[i] * p; p = p === 9 ? 2 : p + 1; }
  return s % 11 < 2 ? 0 : 11 - (s % 11);
}
/** chave de acesso do MDF-e (44 dígitos) */
export function chaveMDFe({ uf, dhEmi, cnpj, serie, nMDF, tpEmis = 1, cMDF }) {
  const b = String(UF_IBGE[uf]).padStart(2, '0') + dhEmi.slice(2, 4) + dhEmi.slice(5, 7) + soDig(cnpj).padStart(14, '0') + '58'
    + String(serie).padStart(3, '0') + String(nMDF).padStart(9, '0') + String(tpEmis) + String(cMDF).padStart(8, '0');
  return b + dvChave(b);
}
/** número aleatório de 8 dígitos do MDF-e, diferente do número do documento */
export function codigoNumerico(nMDF) {
  for (;;) { const c = String(Math.floor(Math.random() * 1e8)).padStart(8, '0'); if (+c !== +nMDF) return c; }
}
/** data e hora no fuso de Brasília, no formato do MDF-e (2026-11-23T08:30:00-03:00) */
export function dataHoraBR(d = new Date()) {
  const b = new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 19);
  return b + '-03:00';
}
/** tipo do transportador no MDF-e de carga própria: 1 ETC, 2 TAC, 3 CTC */
export const tpTransp = (t) => !t ? null : t.tipo === 'ctc' ? 3 : ehAutonomo(t) ? 2 : 1;

/**
 * Monta o XML do MDF-e.
 * @param f  frete (com f.mdfe e f.ciot)        @param t transportador (null = frota própria)
 * @param emp {cnpj, ie, razao_social, nome}      @param ender endereço do emitente {xLgr, nro, xCpl, xBairro, cMun, xMun, CEP, UF, fone}
 * @param o  {tpAmb: 1 produção | 2 homologação, serie, nMDF, cMDF, dhEmi, padrao, respTec: {CNPJ, xContato, email, fone}}
 * @returns {{ xml: string, chave: string }}
 */
export function gerarXMLMDFe(f, t, emp, ender, o = {}) {
  const m = montarMDFe(f, t, emp, o.padrao || {});
  const tpAmb = o.tpAmb ?? 2, serie = o.serie ?? 1, nMDF = o.nMDF ?? 1, dhEmi = o.dhEmi || dataHoraBR(), cMDF = o.cMDF || codigoNumerico(nMDF);
  const ufEmit = ender?.UF || m.ide.UFIni;
  const chave = chaveMDFe({ uf: ufEmit, dhEmi, cnpj: m.emit.CNPJ, serie, nMDF, cMDF });
  const tt = m.ide.tpEmit === 2 ? tpTransp(t) : null;
  const ide = grupo('ide', el('cUF', String(UF_IBGE[ufEmit])), el('tpAmb', tpAmb), el('tpEmit', m.ide.tpEmit), el('tpTransp', tt), el('mod', 58), el('serie', serie),
    el('nMDF', nMDF), el('cMDF', cMDF), el('cDV', chave[43]), el('modal', 1), el('dhEmi', dhEmi), el('tpEmis', 1), el('procEmi', 0), el('verProc', o.verProc || 'fluxo-caixa 1.0'),
    el('UFIni', m.ide.UFIni), el('UFFim', m.ide.UFFim),
    m.ide.infMunCarrega.map(c => grupo('infMunCarrega', el('cMunCarrega', c.cMunCarrega), el('xMunCarrega', txt(c.xMunCarrega)))).join(''),
    m.ide.infPercurso.map(p => grupo('infPercurso', el('UFPer', p.UFPer))).join(''),
    el('dhIniViagem', o.dhIniViagem));
  const emit = grupo('emit', el('CNPJ', m.emit.CNPJ), el('IE', m.emit.IE), el('xNome', txt(m.emit.xNome)),
    grupo('enderEmit', el('xLgr', txt(ender?.xLgr)), el('nro', txt(ender?.nro || 'S/N')), el('xCpl', txt(ender?.xCpl)), el('xBairro', txt(ender?.xBairro)),
      el('cMun', ender?.cMun), el('xMun', txt(ender?.xMun)), el('CEP', soDig(ender?.CEP) || null), el('UF', ender?.UF), el('fone', soDig(ender?.fone) || null)));
  // modal rodoviário
  const r = m.infModal.rodo, a = r.infANTT;
  const prop = (p) => !p ? '' : grupo('prop', doc(p.CPF || p.CNPJ), el('RNTRC', p.RNTRC), el('xNome', txt(p.xNome)), el('IE', soDig(t?.ie) || 'ISENTO'), el('UF', p.UF), el('tpProp', p.tpProp));
  const antt = grupo('infANTT',
    a.infCIOT.map(c => grupo('infCIOT', el('CIOT', c.CIOT), doc(c.CPF || c.CNPJ))).join(''),
    a.valePed ? grupo('valePed', a.valePed.disp.map(v => grupo('disp', el('CNPJForn', soDig(v.CNPJForn)), el('CNPJPg', v.CNPJPg), el('nCompra', txt(v.nCompra, 20)), el('vValePed', dec(v.vValePed)))).join('')) : '',
    a.infContratante.map(c => grupo('infContratante', el('xNome', txt(c.xNome)), el('CNPJ', c.CNPJ))).join(''),
    a.infPag.map(p => grupo('infPag', el('xNome', txt(p.xNome)), doc(p.CPF || p.CNPJ),
      p.Comp.map(c => grupo('Comp', el('tpComp', c.tpComp), el('vComp', dec(c.vComp)), c.tpComp === '99' ? el('xComp', txt(c.xComp)) : '')).join(''),
      el('vContrato', dec(p.vContrato)), el('indPag', p.indPag),
      (p.infPrazo || []).map(z => grupo('infPrazo', el('nParcela', z.nParcela), el('dVenc', z.dVenc), el('vParcela', dec(z.vParcela)))).join(''),
      grupo('infBanc', p.infBanc.CNPJIPEF ? el('CNPJIPEF', p.infBanc.CNPJIPEF) : p.infBanc.PIX ? el('PIX', txt(p.infBanc.PIX, 60)) : el('codBanco', p.infBanc.codBanco) + el('codAgencia', p.infBanc.codAgencia)))).join(''));
  const vt = r.veicTracao;
  const tracao = grupo('veicTracao', el('placa', limparPlaca(vt.placa)), el('RENAVAM', soDig(vt.RENAVAM) || null), el('tara', vt.tara), el('capKG', vt.capKG), prop(vt.prop),
    vt.condutor.map(c => grupo('condutor', el('xNome', txt(c.xNome)), el('CPF', c.CPF))).join(''), el('tpRod', vt.tpRod), el('tpCar', vt.tpCar), el('UF', vt.UF));
  const reboques = r.veicReboque.map(x => grupo('veicReboque', el('placa', x.placa), el('RENAVAM', soDig(x.RENAVAM) || null), el('tara', x.tara), el('capKG', x.capKG), prop(x.prop),
    el('tpCar', x.tpCar), el('UF', x.UF))).join('');
  const rodo = `<rodo xmlns="http://www.portalfiscal.inf.br/mdfe">${antt}${tracao}${reboques}</rodo>`;
  const infDoc = grupo('infDoc', m.infDoc.infMunDescarga.map(x => grupo('infMunDescarga', el('cMunDescarga', x.cMunDescarga), el('xMunDescarga', txt(x.xMunDescarga)),
    x.infNFe.map(n => grupo('infNFe', el('chNFe', n.chNFe))).join(''))).join(''));
  const seg = m.seg.map(s => grupo('seg', grupo('infResp', el('respSeg', s.infResp.respSeg), el('CNPJ', s.infResp.CNPJ || m.emit.CNPJ)),
    grupo('infSeg', el('xSeg', txt(s.infSeg.xSeg, 30)), el('CNPJ', s.infSeg.CNPJ)), el('nApol', txt(s.nApol, 20)), s.nAver.map(n => el('nAver', txt(n, 40))).join(''))).join('');
  const prod = grupo('prodPred', el('tpCarga', m.prodPred.tpCarga), el('xProd', txt(m.prodPred.xProd, 120)), el('NCM', m.prodPred.NCM));
  const tot = grupo('tot', el('qNFe', m.tot.qNFe || null), el('vCarga', dec(m.tot.vCarga)), el('cUnid', m.tot.cUnid), el('qCarga', dec(m.tot.qCarga, 4)));
  const adic = grupo('infAdic', el('infCpl', txt(m.infAdic.infCpl, 5000)));
  const rt = o.respTec ? grupo('infRespTec', el('CNPJ', soDig(o.respTec.CNPJ)), el('xContato', txt(o.respTec.xContato)), el('email', txt(o.respTec.email)), el('fone', soDig(o.respTec.fone))) : '';
  const inf = `<infMDFe versao="${VERSAO}" Id="MDFe${chave}">${ide}${emit}<infModal versaoModal="${VERSAO}">${rodo}</infModal>${infDoc}${seg}${prod}${tot}${adic}${rt}</infMDFe>`;
  const supl = `<infMDFeSupl><qrCodMDFe><![CDATA[${QR}?chMDFe=${chave}&tpAmb=${tpAmb}]]></qrCodMDFe></infMDFeSupl>`;
  return { chave, xml: `<?xml version="1.0" encoding="UTF-8"?><MDFe xmlns="http://www.portalfiscal.inf.br/mdfe">${inf}${supl}</MDFe>` };
}
