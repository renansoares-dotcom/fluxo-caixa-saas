// WhatsApp (melhoria 1.1b): monta a mensagem para a API oficial (WhatsApp Cloud API) a partir do modelo aprovado.
// A Meta só aceita, para iniciar a conversa, um MODELO aprovado com os campos na ordem {{1}}, {{2}}…
// Cópia em supabase/functions/whatsapp/index.ts (mudou aqui, mude lá). Testes em tests/whatsapp.test.js.

/** texto de um campo como a Meta aceita: sem quebra de linha nem tabulação, sem 4+ espaços seguidos, até 1024, nunca vazio */
export function limpar(v) {
  const t = String(v ?? '').replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').trim().slice(0, 1024);
  return t || '-';
}

/** número em formato internacional do Brasil (55 + DDD + número) ou null — mesma regra de _wa_numero */
export function numero(p) {
  const d = String(p ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (/^55\d{10,11}$/.test(d)) return d;
  if (/^\d{10,11}$/.test(d)) return '55' + d;
  return null;
}

/** corpo do POST /{phone_number_id}/messages */
export function mensagem(modelo, campos = {}, para, idioma = 'pt_BR') {
  const comps = [];
  const ps = (modelo.parametros || []).map(k => ({ type: 'text', text: limpar(campos[k]) }));
  if (ps.length) comps.push({ type: 'body', parameters: ps });
  if (modelo.botao_campo && campos[modelo.botao_campo]) comps.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(campos[modelo.botao_campo]).replace(/^\//, '').slice(0, 2000) }] });
  return { messaging_product: 'whatsapp', to: para, type: 'template', template: { name: modelo.template, language: { code: idioma }, ...(comps.length ? { components: comps } : {}) } };
}

/** prévia do texto: troca {{n}} pelo campo n da lista */
export function previa(texto, parametros = [], campos = {}) {
  return String(texto || '').replace(/\{\{(\d+)\}\}/g, (_, n) => limpar(campos[parametros[+n - 1]]));
}

export const SITUACAO = { pendente: ['Na fila', 'warn'], enviado: ['Enviado', 'pos'], erro: ['Erro', 'neg'], ignorado: ['Não enviado', 'muted'] };
