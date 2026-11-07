// Nota de confiança (0 a 100) das sugestões da Conciliação Bancária (melhoria 3.2). Cada critério soma ou tira pontos;
// os pontos e as faixas (alta / média / baixa) são configuráveis em Conciliação › Parâmetros (tabela conc_config).
// Função pura, sem acesso ao banco: usada pela tela e pelos testes.

export const PESOS_PADRAO = {
  base_exato: 55,      // um lançamento pago com o mesmo valor
  base_grupo: 40,      // vários lançamentos (ou movimentos) cuja soma fecha no centavo
  base_relatorio: 60,  // grupo vindo de relatório (ERP / VExpenses), em que a soma exata é a regra
  base_baixa: 35,      // título em aberto com o mesmo valor (a conciliação baixa o título)
  mesmo_dia: 20,       // mesma data do extrato
  por_dia: 6,          // desconto por dia de distância entre o extrato e o lançamento
  texto_1: 12,         // uma palavra do histórico do banco aparece no lançamento (favorecido, descrição, plano)
  texto_2: 20,         // duas ou mais palavras
  documento: 20,       // número do documento bate
  unico: 10,           // é o único candidato com esse valor na janela de dias
  ambiguo: -25,        // há outro lançamento ou movimento de mesmo valor e nada distingue
  varios_mov: -15,     // vários movimentos do extrato num grupo só (fora dos relatórios)
};
export const FAIXAS_PADRAO = { alta: 85, media: 60 };
export const DIAS_PADRAO = { exato: 3, baixa: 7 };

export const PESOS_ROTULOS = {
  base_exato: 'Base: lançamento pago de mesmo valor', base_grupo: 'Base: soma de vários lançamentos', base_relatorio: 'Base: soma no relatório do ERP / VExpenses',
  base_baixa: 'Base: título em aberto de mesmo valor (baixa)', mesmo_dia: 'Mesma data do extrato', por_dia: 'Desconto por dia de distância',
  texto_1: 'Uma palavra do histórico bate', texto_2: 'Duas ou mais palavras batem', documento: 'Número do documento bate',
  unico: 'Único candidato com esse valor', ambiguo: 'Outro candidato de mesmo valor (ambíguo)', varios_mov: 'Vários movimentos do extrato num grupo',
};

/** junta a configuração gravada com os padrões */
export function configConc(cfg = {}) {
  return {
    pesos: { ...PESOS_PADRAO, ...(cfg?.pesos || {}) },
    alta: Number.isFinite(+cfg?.conf_alta) && cfg?.conf_alta != null ? +cfg.conf_alta : FAIXAS_PADRAO.alta,
    media: Number.isFinite(+cfg?.conf_media) && cfg?.conf_media != null ? +cfg.conf_media : FAIXAS_PADRAO.media,
    diasExato: cfg?.dias_exato != null ? +cfg.dias_exato : DIAS_PADRAO.exato,
    diasBaixa: cfg?.dias_baixa != null ? +cfg.dias_baixa : DIAS_PADRAO.baixa,
    alertaDias: cfg?.alerta_dias != null ? +cfg.alerta_dias : 5,
    semAlerta: new Set(cfg?.contas_sem_alerta || []),
  };
}

/**
 * nota de confiança de uma sugestão
 * @param {{tipo:'exato'|'grupo'|'baixa', relatorio?:boolean, dd?:number, af?:number, doc?:boolean, unico?:boolean, variosMov?:boolean}} s
 * @returns {{nota:number, faixa:'alta'|'media'|'baixa', motivos:string[]}}
 */
export function confianca(s, cfg = configConc()) {
  const p = cfg.pesos, m = [];
  const add = (v, t) => { if (v) m.push(`${v > 0 ? '+' : ''}${v} ${t}`); return v; };
  let n = s.tipo === 'baixa' ? add(p.base_baixa, 'título em aberto de mesmo valor')
    : s.tipo === 'grupo' ? (s.relatorio ? add(p.base_relatorio, 'soma exata no relatório') : add(p.base_grupo, 'soma de vários lançamentos'))
    : add(p.base_exato, 'mesmo valor');
  const dd = Math.abs(s.dd || 0);
  n += dd === 0 ? add(p.mesmo_dia, 'mesma data') : add(Math.max(0, p.mesmo_dia - dd * p.por_dia), `${dd} dia(s) de distância`);
  if ((s.af || 0) >= 2) n += add(p.texto_2, 'histórico bate (2+ palavras)'); else if (s.af === 1) n += add(p.texto_1, 'histórico bate (1 palavra)');
  if (s.doc) n += add(p.documento, 'documento bate');
  if (s.unico === true) n += add(p.unico, 'único candidato'); else if (s.unico === false && !(s.af > 0) && !s.doc) n += add(p.ambiguo, 'há outro de mesmo valor');
  if (s.variosMov) n += add(p.varios_mov, 'vários movimentos no grupo');
  const nota = Math.max(0, Math.min(100, Math.round(n)));
  return { nota, faixa: nota >= cfg.alta ? 'alta' : nota >= cfg.media ? 'media' : 'baixa', motivos: m };
}

export const ROT_FAIXA = { alta: 'confiança alta', media: 'confiança média', baixa: 'conferir' };
