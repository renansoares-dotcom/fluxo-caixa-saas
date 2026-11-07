// Avisos (SQL 090) — regras puras: horário de silêncio (a mesma regra da função "notificar") e o tipo de cada aviso.
export const PADRAO = { silencio: true, inicio: '20:00', fim: '07:00', fim_de_semana: true, fuso: 'America/Sao_Paulo' };
const min = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };

/** está no horário de silêncio da pessoa agora? */
export function emSilencio(h = PADRAO, agora = new Date()) {
  if (!h?.silencio) return false;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: h.fuso || PADRAO.fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(agora).map((x) => [x.type, x.value]));
  if (h.fim_de_semana && (p.weekday === 'Sat' || p.weekday === 'Sun')) return true;
  const m = (Number(p.hour) % 24) * 60 + Number(p.minute), i = min(h.inicio), f = min(h.fim);
  return i === f ? false : i > f ? m >= i || m < f : m >= i && m < f;
}

/** o código do catálogo para um tipo de notificação (paraquedas_novo → paraquedas) */
export function codigoDo(tipo, catalogo = []) {
  return [...catalogo].sort((a, b) => b.codigo.length - a.codigo.length).find((c) => tipo === c.codigo || String(tipo).startsWith(c.codigo + '_'))?.codigo || null;
}

/** texto curto do horário */
export function resumoHorario(h = PADRAO) {
  if (!h.silencio) return 'Sem horário de silêncio: os avisos chegam a qualquer hora.';
  const hh = (t) => String(t).slice(0, 5).replace(':00', 'h').replace(/:(\d\d)/, 'h$1');
  return `Silêncio das ${hh(h.inicio)} às ${hh(h.fim)}${h.fim_de_semana ? ' e no fim de semana' : ''}. Nesse horário o aviso fica no sino e vai para o celular depois; urgente chega sempre.`;
}

export const SITUACAO_PUSH = { enviado: 'Enviado ao celular', sem_aparelho: 'Sem aparelho ativo', desligado: 'Desligado por você', silencio: 'Aguardando o fim do silêncio' };
