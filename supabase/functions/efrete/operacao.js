// e-frete — montagem da operação de transporte (CIOT) a partir dos dados da plataforma. Biblioteca pura:
// não chama a internet nem o banco; usada pela função "efrete" (Deno) e pelos testes (Node).
// Tudo o que não vem da ficha do frete vem de efrete_config (parâmetros da empresa, SQL 082) — nada fixo aqui.

const dig = (s) => String(s ?? '').replace(/\D/g, '');
const r2 = (v) => Math.round((+v || 0) * 100) / 100;
const vazio = (s) => !String(s ?? '').trim();

/** CIOT do e-frete: "NNNNNNNNNNNN/VVVV" — o MDF-e usa só os 12 primeiros dígitos */
export const ciot12 = (c) => dig(String(c || '').split('/')[0]).slice(0, 12);

// rodado/carroceria do MDF-e (códigos) → e-frete
const RODADO = { '01': 'Truck', '02': 'Toco', '03': 'Cavalo' };
const CARROCERIA = { '00': 'NaoAplicavel', '01': 'Aberta', '02': 'FechadaOuBau', '03': 'Granelera', '04': 'PortaContainer', '05': 'Sider' };

/** data/hora local (UTC−3) no formato do e-frete: yyyy-MM-ddTHH:mm:ss */
export const dataLocal = (d) => new Date(new Date(d).getTime() - 3 * 3600e3).toISOString().slice(0, 19);
/** início e fim padrão: início = data do frete às 08:00 (ou daqui a 15 min, se já passou); fim = início + prazo */
export function periodoPadrao(dataFrete, prazoHoras, agora = Date.now()) {
  const base = dataFrete ? Date.parse(`${dataFrete}T08:00:00-03:00`) : agora;
  const ini = Math.max(base, agora + 15 * 60e3);
  return { inicio: new Date(ini).toISOString(), fim: new Date(ini + (+prazoHoras || 48) * 3600e3).toISOString() };
}

const endEfrete = (e) => e && !vazio(e.rua) ? { Rua: String(e.rua).slice(0, 100), Numero: String(e.numero || 'S/N'), ...(e.complemento ? { Complemento: String(e.complemento) } : {}),
  Bairro: String(e.bairro || ''), CEP: dig(e.cep), CodigoMunicipio: +dig(e.cmun) } : null;
const endFaltas = (e) => !e || vazio(e.rua) || vazio(e.bairro) || dig(e.cep).length !== 8 || !/^\d{7}$/.test(dig(e.cmun));
const celular = (ddd, n) => ({ DDD: +dig(ddd), Numero: +dig(n) });

/** tipo da chave Pix pelo formato */
export function tipoPix(p) {
  const s = String(p || '').trim(), d = dig(s);
  if (/@/.test(s)) return 'Email';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)) return 'ChaveAleatoria';
  if (/^\+55/.test(s) || /^\(\d{2}\)/.test(s)) return 'TelefoneCelular'; // telefone só com +55 ou (DDD); 11 dígitos puros = CPF
  if (d.length === 11 || d.length === 14) return 'CpfOuCnpj';
  return 'ChaveAleatoria';
}

/**
 * Monta a operação (sem Integrador/Token) e os cadastros que o e-frete exige antes (proprietário, veículos, motorista).
 * @param x {frete, transp, empresa:{cnpj, razao_social, nome}, config, tipos:{tipo_carga: codigo}, notas:[...], inicio, fim, idOperacao}
 *   notas: [{numero, serie, emissao, v_nf, peso_kg, ncm, emit_doc, dest_doc, dest_nome, dest_end:{rua,numero,bairro,cep,cmun}}]
 * @returns {{ faltas: {onde, txt}[], op, cadastros }}
 */
export function montarOperacao(x) {
  const { frete: f, transp: t, empresa: emp, config: cfg = {}, tipos = {}, notas = [] } = x;
  const faltas = [], falta = (onde, txt) => faltas.push({ onde, txt });
  const m = f?.mdfe || {};

  // contratado (proprietário) e motorista
  const docT = dig(t?.documento), rntrc = dig(t?.rntrc);
  if (![11, 14].includes(docT.length)) falta('transportador', 'CPF/CNPJ do transportador');
  if (rntrc.length < 8) falta('transportador', 'RNTRC do transportador');
  if (endFaltas(t?.endereco)) falta('transportador', 'endereço do transportador (rua, bairro, CEP e município IBGE)');
  const cpfMot = dig(m.condutor?.cpf);
  const mots = Array.isArray(t?.motoristas) ? t.motoristas : [];
  const mot = mots.find(z => dig(z.cpf) === cpfMot) || (!cpfMot && mots.length === 1 ? mots[0] : null);
  if (!mot) falta('transportador', cpfMot ? `motorista do CPF ${cpfMot} no cadastro do transportador (CNH, nascimento, celular)` : 'motorista do frete (Dados do MDF-e › condutor) cadastrado no transportador');
  else {
    if (dig(mot.cnh).length < 9) falta('transportador', `CNH do motorista ${mot.nome || ''}`.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mot.nascimento || '')) falta('transportador', `data de nascimento do motorista ${mot.nome || ''}`.trim());
    if (dig(mot.ddd).length !== 2 || ![8, 9].includes(dig(mot.celular).length)) falta('transportador', `celular do motorista ${mot.nome || ''} (DDD + número)`.trim());
    if (endFaltas(mot.endereco) && endFaltas(t?.endereco)) falta('transportador', 'endereço do motorista');
  }

  // veículos (cavalo/caminhão + reboques)
  const placas = [m.veiculo?.placa || f?.placa, ...(m.reboques || []).map(r => r.placa)].map(p => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean);
  if (!placas.length) falta('frete', 'placa do veículo');
  const veics = placas.map((placa, i) => {
    const vt = (t?.veiculos || []).find(v => v.placa === placa) || {};
    const fonte = i === 0 ? { ...vt, ...(m.veiculo || {}) } : { ...vt, ...((m.reboques || [])[i - 1] || {}) };
    const v = { placa, chassi: String(vt.chassi || fonte.chassi || '').toUpperCase().trim(), renavam: dig(fonte.renavam || vt.renavam), eixos: +(vt.eixos || fonte.eixos) || null,
      rodado: i === 0 ? (RODADO[fonte.tp_rod] || 'NaoAplicavel') : 'NaoAplicavel', carroceria: CARROCERIA[fonte.tp_car] || 'NaoAplicavel' };
    if (v.chassi.length !== 17) falta('transportador', `chassi do veículo ${placa} (17 caracteres)`);
    if (!v.renavam) falta('transportador', `RENAVAM do veículo ${placa}`);
    if (!v.eixos) falta('transportador', `eixos do veículo ${placa}`);
    return v;
  });

  // rota e notas
  const carga = (m.carregamento || [])[0] || {}, descargas = (m.descarga || []).filter(d => d.cmun);
  const cmunOrig = dig(carga.cmun), cmunDest = dig(descargas[descargas.length - 1]?.cmun);
  if (!/^\d{7}$/.test(cmunOrig)) falta('frete', 'município de carregamento (Dados do MDF-e)');
  if (!/^\d{7}$/.test(cmunDest)) falta('frete', 'município de descarga (Dados do MDF-e)');
  if (!(+f?.km > 0)) falta('frete', 'distância (km)');
  if (!notas.length) falta('frete', 'NF-e da viagem (Dados do MDF-e › Buscar NF-e)');
  const pesoTotal = r2(notas.reduce((s, n) => s + (+n.peso_kg || 0), 0)) || +m.peso_kg || 0;
  if (!(pesoTotal > 0)) falta('frete', 'peso da carga');
  const ncm4 = (n) => dig(n).slice(0, 4);
  const principal = [...notas].sort((a, b) => (+b.v_nf || 0) - (+a.v_nf || 0))[0];
  const ncmPrincipal = ncm4(principal?.ncm) || ncm4(m.prod?.ncm) || ncm4(cfg.ncm_padrao);
  if (ncmPrincipal.length !== 4) falta('frete', 'NCM da carga (na NF-e, no produto do MDF-e ou o NCM padrão nos parâmetros)');
  const dest = notas.find(n => [11, 14].includes(dig(n.dest_doc).length));
  if (!dest) falta('frete', 'CPF/CNPJ do destinatário (vem da NF-e)');

  // valores e pagamentos
  const valor = r2(f?.valor);
  if (!(valor > 0)) falta('frete', 'valor do frete');
  if (f?.lotacao && f?.piso != null && valor < r2(f.piso) - 0.005) falta('frete', `frete abaixo do piso mínimo (${r2(f.piso).toFixed(2)}): o e-frete não gera o CIOT de lotação`);
  const adiant = r2(valor * (+cfg.pct_adiantamento || 0) / 100), quit = r2(valor - adiant);
  const tp = cfg.tipo_pagamento || 'eFRETE';
  let banco = null;
  if (tp !== 'eFRETE') {
    if (!vazio(t?.conta_pix)) { const tpx = tipoPix(t.conta_pix); banco = { TipoChavePix: tpx, ValorChavePix: tpx === 'Email' || tpx === 'ChaveAleatoria' ? String(t.conta_pix).trim() : tpx === 'TelefoneCelular' ? dig(t.conta_pix).replace(/^55(?=\d{10,11}$)/, '') : dig(t.conta_pix) }; }
    else if (!vazio(t?.conta_numero) && !vazio(t?.conta_banco)) banco = { InformacoesBancarias: { InstituicaoBancaria: dig(t.conta_banco), Agencia: String(t.conta_agencia || ''), Conta: String(t.conta_numero), TipoConta: 'ContaCorrente' } };
    else falta('transportador', 'conta bancária ou Pix do transportador (forma de pagamento escolhida nos parâmetros)');
  }

  // contratante (esta empresa)
  if (endFaltas(cfg.contratante_endereco)) falta('parametros', 'endereço da empresa contratante (Parâmetros do e-frete)');
  const cnpj = dig(emp?.cnpj);
  if (cnpj.length !== 14) falta('parametros', 'CNPJ da empresa');
  const codTipo = tipos[f?.tipo_carga || 'geral'];
  if (!codTipo) falta('parametros', `código ANTT do tipo de carga "${f?.tipo_carga || 'geral'}" (Parâmetros do e-frete)`);
  if (tp === 'eFRETE' && !(cfg.docs_credenciado || []).some(d => String(d).trim().length >= 10)) falta('parametros', 'documentos que o posto retém na quitação (mínimo 10 caracteres)');

  const ini = x.inicio, fim = x.fim;
  if (!ini || !fim) falta('frete', 'início e fim previstos da viagem');
  else if (Date.parse(fim) <= Date.parse(ini)) falta('frete', 'o fim previsto tem de ser depois do início');
  else if (Date.parse(fim) - Date.parse(ini) > 90 * 864e5) falta('frete', 'a viagem pode ter no máximo 90 dias');

  const liberaQuit = fim ? dataLocal(Date.parse(fim) + (+cfg.dias_liberacao_quitacao || 0) * 864e5) : null;
  const docViagem = f?.cte_chave && dig(f.cte_chave).length === 44 ? `CTe-${+dig(f.cte_chave).slice(25, 34)}/${+dig(f.cte_chave).slice(22, 25)}` : `FRETE-${f?.numero ?? ''}`;
  const pag = (cat, v, quando, n) => ({ IdPagamentoCliente: `${x.idOperacao}-${cat === 'Adiantamento' ? 'A' : 'Q'}`, DataDeLiberacao: quando, Valor: v, TipoPagamento: tp, Categoria: cat,
    Documento: docViagem, IndicadorPagamento: 'AVista', NumeroParcela: n, CpfCnpjCreditado: docT, ...(banco || {}) });
  const tol = { Tipo: cfg.tipo_calculo === 'SemQuebra' || !cfg.tipo_calculo ? 'Nenhum' : (cfg.tolerancia_tipo || 'Nenhum'), Valor: cfg.tipo_calculo === 'SemQuebra' || !cfg.tipo_calculo ? 0 : +cfg.tolerancia_valor || 0 };
  const porTon = (cfg.unidade_medida || 'Kg') === 'Tonelada';

  const op = {
    Versao: 8, TipoViagem: cfg.tipo_viagem || 'Padrao', MatrizCNPJ: cnpj, IdOperacaoCliente: x.idOperacao,
    DataInicioViagem: ini ? dataLocal(ini) : null, DataFimViagem: fim ? dataLocal(fim) : null,
    CodigoNCMNaturezaCarga: ncmPrincipal, PesoCarga: pesoTotal, TipoEmbalagem: cfg.tipo_embalagem || 'Pallet',
    Viagens: [{
      DocumentoViagem: docViagem, CodigoMunicipioOrigem: +cmunOrig, CodigoMunicipioDestino: +cmunDest, DistanciaPercorrida: Math.round(+f?.km || 0),
      ...(dig(dest?.dest_end?.cep).length === 8 ? { CepDestino: dig(dest.dest_end.cep) } : {}),
      Valores: { TotalOperacao: valor, TotalViagem: valor, TotalDeAdiantamento: adiant, TotalDeQuitacao: quit, Combustivel: 0, Pedagio: 0, Seguro: 0 },
      TipoPagamento: tp,
      NotasFiscais: notas.map(n => {
        const q = porTon ? r2((+n.peso_kg || 0) / 1000) : r2(n.peso_kg);
        return { Numero: String(n.numero), Serie: String(n.serie || '1'), ...(n.emissao ? { Data: `${n.emissao}T00:00:00` } : {}), ...(dig(n.emit_doc).length === 14 ? { CnpjEmissor: dig(n.emit_doc) } : {}),
          ValorTotal: r2(n.v_nf), ValorDaMercadoriaPorUnidade: q > 0 ? Math.round((+n.v_nf || 0) / q * 100000) / 100000 : 0,
          CodigoNCMNaturezaCarga: ncm4(n.ncm) || ncmPrincipal, UnidadeDeMedidaDaMercadoria: cfg.unidade_medida || 'Kg', TipoDeCalculo: cfg.tipo_calculo || 'SemQuebra',
          QuantidadeDaMercadoriaNoEmbarque: q, ToleranciaDePerdaDeMercadoria: tol };
      }),
    }],
    Impostos: { IRRF: 0, SestSenat: 0, INSS: 0, ISSQN: 0, OutrosImpostos: 0 },
    Pagamentos: [...(adiant > 0 ? [pag('Adiantamento', adiant, ini ? dataLocal(ini) : null, 1)] : []), pag('Quitacao', quit, liberaQuit, adiant > 0 ? 2 : 1)],
    Contratado: { CpfOuCnpj: docT, RNTRC: rntrc },
    Motorista: mot ? { CpfOuCnpj: dig(mot.cpf), CNH: dig(mot.cnh), Celular: celular(mot.ddd, mot.celular) } : null,
    Destinatario: dest ? { NomeOuRazaoSocial: dest.dest_nome || '', CpfOuCnpj: dig(dest.dest_doc), ...(endFaltas(dest.dest_end) ? {} : { Endereco: endEfrete(dest.dest_end) }) } : null,
    Contratante: { NomeOuRazaoSocial: emp?.razao_social || emp?.nome || '', CpfOuCnpj: cnpj, ResponsavelPeloPagamento: true, Endereco: endEfrete(cfg.contratante_endereco) },
    Veiculos: placas.map(p => ({ Placa: p })),
    CodigoTipoCarga: codTipo || null, AltoDesempenho: ['C', 'D'].includes(f?.tabela), ComposicaoVeicular: placas.length > 1, RetornoVazio: !!f?.retorno_vazio,
    TipoPagamento: tp,
    ...(tp === 'eFRETE' ? { ObservacoesAoCredenciado: (cfg.docs_credenciado || []).filter(d => String(d).trim().length >= 10), EntregaDocumentacao: cfg.entrega_documentacao || 'RedeCredenciada' } : {}),
    ...((cfg.observacoes_transportador || []).length ? { ObservacoesAoTransportador: cfg.observacoes_transportador } : {}),
    ...(cfg.qtd_saques != null ? { QuantidadeSaques: +cfg.qtd_saques } : {}),
    ...(cfg.qtd_transferencias != null ? { QuantidadeTransferencias: +cfg.qtd_transferencias } : {}),
  };

  const endT = endEfrete(t?.endereco);
  const cadastros = {
    proprietario: { Versao: 4, CNPJ: docT, Endereco: endT, RNTRC: rntrc, RazaoSocial: t?.nome || '' },
    veiculos: veics.map(v => ({ Versao: 1, Veiculo: { Chassi: v.chassi, NumeroDeEixos: v.eixos, Placa: v.placa, RNTRC: +rntrc, Renavam: +v.renavam, TipoCarroceria: v.carroceria, TipoRodado: v.rodado } })),
    motorista: mot ? { Versao: 2, CNH: +dig(mot.cnh), CPF: +dig(mot.cpf), DataNascimento: `${mot.nascimento}T00:00:00`, Endereco: endEfrete(endFaltas(mot.endereco) ? t?.endereco : mot.endereco),
      Nome: mot.nome || '', Telefones: { Celular: celular(mot.ddd, mot.celular) } } : null,
  };
  return { faltas, op, cadastros, resumo: { contratado: t?.nome, motorista: mot?.nome, placas, origem: carga.xmun, destino: descargas[descargas.length - 1]?.xmun, valor, adiantamento: adiant, quitacao: quit,
    pagamento: tp, notas: notas.map(n => n.numero), peso: pesoTotal, tipo_carga: f?.tipo_carga, codigo_antt: codTipo || null, inicio: op.DataInicioViagem, fim: op.DataFimViagem } };
}

/** endereço do destinatário a partir do XML da NF-e (texto) */
export function enderecoDest(xml) {
  const sec = /<enderDest>([\s\S]*?)<\/enderDest>/.exec(String(xml || ''))?.[1] || '';
  const t = (tag) => (new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(sec)?.[1] || '').trim();
  return { rua: t('xLgr'), numero: t('nro') || 'S/N', complemento: t('xCpl'), bairro: t('xBairro'), cep: t('CEP'), cmun: t('cMun') };
}
/** peso bruto somado dos volumes da NF-e */
export const pesoNota = (xml) => r2([...String(xml || '').matchAll(/<pesoB>([\d.]+)<\/pesoB>/g)].reduce((s, m) => s + (+m[1] || 0), 0));
