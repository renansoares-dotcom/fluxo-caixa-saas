// Seletor "Colunas" (05/11/2026, padrão em docs/design-system.md › 5): botão na toolbar que abre uma lista de caixas
// para mostrar ou ocultar colunas da tabela. A escolha fica guardada por usuário e por tela (localStorage) e tem
// "Restaurar padrão". Só esconde na tela: o Excel exportado continua com todas as colunas.
//
// Uso:
//   const cols = seletorColunas({ tela: 'abertos', colunas: [{ id: 'conta', nome: 'Conta' }, { id: 'cc', nome: 'C. Custo', padrao: false }] });
//   root.innerHTML = `<div data-colunas="abertos">…<th data-col="conta">…<td data-col="conta">…<div class="small muted" data-col="conta">…`;
//   $('#acoes', root).prepend(cols.botao);
// Tudo o que tem data-col="<id>" dentro de [data-colunas="<tela>"] some quando a coluna é desmarcada (célula inteira
// ou só a 2ª linha da célula). Como a regra vai num <style>, a tabela pode ser redesenhada à vontade.
import { state } from './data.js';
import { esc } from './ui.js';

const chave = (tela) => `colunas:${tela}:${state.user?.id || 'anon'}`;
const ler = (tela) => { try { const v = JSON.parse(localStorage.getItem(chave(tela)) || 'null'); return Array.isArray(v) ? v : null; } catch { return null; } };
const gravar = (tela, v) => { try { v ? localStorage.setItem(chave(tela), JSON.stringify(v)) : localStorage.removeItem(chave(tela)); } catch { /* sem armazenamento */ } };
const seguro = (s) => String(s).replace(/[^a-z0-9_-]/gi, '');

/**
 * @param {object} o
 * @param {string} o.tela  identificador da tela (vai na chave do localStorage e no atributo data-colunas)
 * @param {{id:string,nome:string,padrao?:boolean,sub?:boolean}[]} o.colunas  colunas que podem ser ocultadas (padrao: true se omitido;
 *        sub: true para a informação que fica na 2ª linha da coluna anterior; aparece recuada na lista)
 * @param {{nome:string,colunas:string[]}[]} [o.atalhos]  conjuntos prontos (ex.: 1º semestre), mostrados como botões
 * @param {string} [o.rotulo]  texto do botão (padrão "Colunas")
 * @param {string} [o.titulo]  título da lista (padrão "Mostrar colunas")
 * @param {string} [o.classe]  classes do botão (padrão "btn small", o tamanho da toolbar da tabela)
 * @param {(visiveis:Set<string>)=>void} [o.aoMudar]
 */
export function seletorColunas({ tela, colunas, atalhos = [], rotulo = 'Colunas', titulo = 'Mostrar colunas', classe = 'btn small', aoMudar } = {}) {
  const t = seguro(tela);
  const padrao = () => colunas.filter(c => c.padrao !== false).map(c => c.id);
  const ids = new Set(colunas.map(c => c.id));
  let vis = new Set((ler(t) || padrao()).filter(id => ids.has(id)));

  // regra de CSS da tela (uma por tela; recriada a cada mudança)
  const pintar = () => {
    let st = document.getElementById(`colunas-${t}`);
    if (!st) { st = document.createElement('style'); st.id = `colunas-${t}`; document.head.appendChild(st); }
    const ocultas = colunas.filter(c => !vis.has(c.id)).map(c => `[data-colunas="${t}"] [data-col="${seguro(c.id)}"]`);
    st.textContent = ocultas.length ? `${ocultas.join(',')}{display:none!important}` : '';
    const n = colunas.length - vis.size;
    botao.querySelector('.col-n').textContent = n ? ` (${n} oculta${n > 1 ? 's' : ''})` : '';
  };
  const mudar = (novo, guardar = true) => {
    vis = new Set(novo);
    const ehPadrao = vis.size === padrao().length && padrao().every(id => vis.has(id));
    if (guardar) gravar(t, ehPadrao ? null : [...vis]);
    pintar(); marcar(); aoMudar?.(new Set(vis));
  };

  const caixa = document.createElement('span'); caixa.className = 'col-sel';
  caixa.innerHTML = `<button type="button" class="${esc(classe)}" aria-haspopup="true" aria-expanded="false" title="Mostrar ou ocultar colunas da tabela">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg>${esc(rotulo)}<span class="col-n"></span></button>
    <div class="col-pop" role="dialog" aria-label="Colunas da tabela" hidden>
      <div class="col-pop-tit">${esc(titulo)}</div>
      ${atalhos.length ? `<div class="col-atalhos">${atalhos.map((a, i) => `<button type="button" class="btn small" data-atalho="${i}">${esc(a.nome)}</button>`).join('')}</div>` : ''}
      <div class="col-lista${colunas.length > 8 ? ' duas' : ''}">${colunas.map(c => `<label class="chk${c.sub ? ' sub' : ''}"><input type="checkbox" value="${esc(c.id)}"> ${esc(c.nome)}</label>`).join('')}</div>
      <div class="col-pop-pe"><button type="button" class="btn small ghost" data-restaurar>Restaurar padrão</button></div>
    </div>`;
  const botao = caixa.querySelector('button'), pop = caixa.querySelector('.col-pop');
  const marcar = () => pop.querySelectorAll('input[type=checkbox]').forEach(i => { i.checked = vis.has(i.value); });
  const abrir = (on) => { pop.hidden = !on; botao.setAttribute('aria-expanded', String(on)); if (on) { marcar(); pop.querySelector('input')?.focus(); } };
  botao.onclick = (e) => { e.stopPropagation(); abrir(pop.hidden); };
  pop.addEventListener('click', (e) => e.stopPropagation());
  pop.addEventListener('change', (e) => { if (e.target.matches('input[type=checkbox]')) { const n = new Set(vis); e.target.checked ? n.add(e.target.value) : n.delete(e.target.value); mudar(n); } });
  pop.querySelector('[data-restaurar]').onclick = () => mudar(padrao());
  pop.querySelectorAll('[data-atalho]').forEach(b => { b.onclick = () => mudar(atalhos[+b.dataset.atalho].colunas.filter(id => ids.has(id))); });
  // fecha ao clicar fora ou no Esc; some sozinho quando a tela sai do documento
  const fora = () => { if (!caixa.isConnected) { document.removeEventListener('click', fora); document.removeEventListener('keydown', esc_); return; } abrir(false); };
  const esc_ = (e) => { if (e.key === 'Escape' && !pop.hidden) { abrir(false); botao.focus(); } };
  document.addEventListener('click', fora); document.addEventListener('keydown', esc_);

  pintar();
  return { botao: caixa, visiveis: () => new Set(vis), visivel: (id) => vis.has(id) };
}
