// Produção › Importar do Iniflex: OPs e apontamentos por planilha (Excel/CSV), enquanto o Iniflex for o sistema principal.
import { sb, state, q } from '../lib/data.js';
import { $, esc, fail, toast } from '../lib/ui.js';
import { lerPlanilha, mapearColunas } from '../lib/importador.js';
import { podePCP } from '../lib/producao.js';

export const title = 'Importar produção do Iniflex';
const OPS = [
  { k: 'numero_iniflex', t: 'Nº da OP', re: /^(op|n[º°o.]?\s*op|ordem|n[úu]mero)/i, obrig: true },
  { k: 'codigo_produto', t: 'Código do produto', re: /(c[óo]d.*prod|^produto$|^c[óo]digo$|^item$)/i, obrig: true },
  { k: 'descricao', t: 'Descrição', re: /(descri|nome)/i },
  { k: 'quantidade', t: 'Quantidade', re: /(qtd|quant|peso|kg)/i, obrig: true, tipo: 'numero' },
  { k: 'unidade', t: 'Unidade', re: /^(un|und|unid)/i },
  { k: 'cliente', t: 'Cliente', re: /(cliente|raz[ãa]o)/i },
  { k: 'cliente_doc', t: 'CNPJ do cliente', re: /(cnpj|cpf)/i },
  { k: 'pedido', t: 'Pedido', re: /pedido/i },
  { k: 'emissao', t: 'Emissão', re: /(emiss|abertura|data op|^data$)/i, tipo: 'data' },
  { k: 'entrega', t: 'Entrega', re: /(entrega|previs|prazo)/i, tipo: 'data' },
  { k: 'status', t: 'Situação', re: /(situa|status)/i },
];
const APS = [
  { k: 'numero_iniflex', t: 'Nº da OP', re: /^(op|n[º°o.]?\s*op|ordem)/i, obrig: true },
  { k: 'maquina', t: 'Máquina', re: /(m[áa]quina|equip|recurso|linha)/i, obrig: true },
  { k: 'operador', t: 'Operador', re: /(operador|funcion)/i },
  { k: 'inicio', t: 'Início', re: /(in[íi]cio|data.*ini|hora.*ini|^data$)/i, obrig: true, tipo: 'datahora' },
  { k: 'fim', t: 'Fim', re: /(fim|t[ée]rmino|data.*fim|hora.*fim)/i, tipo: 'datahora' },
  { k: 'qtd_boa', t: 'Produzido (bom)', re: /(produz|bom|boa|qtd|peso l[íi]q|kg)/i, obrig: true, tipo: 'numero' },
  { k: 'refugo', t: 'Refugo / apara', re: /(refugo|apara|perda|sucata)/i, tipo: 'numero' },
  { k: 'turno', t: 'Turno', re: /turno/i },
];
const ST = { aberta: 'liberada', liberada: 'liberada', 'em producao': 'em_producao', 'em produção': 'em_producao', producao: 'em_producao', encerrada: 'concluida', finalizada: 'concluida', concluida: 'concluida', 'concluída': 'concluida', cancelada: 'cancelada' };

export async function render(root) {
  if (!podePCP()) { root.innerHTML = '<div class="card"><p>Só admin, financeiro ou diretor importa dados de produção.</p></div>'; return; }
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Importar produção do Iniflex</h2><div class="muted small">Exporte do Iniflex o relatório de ordens de produção e o de apontamentos (Excel ou CSV). Importe primeiro as OPs; os apontamentos se ligam à OP pelo número do Iniflex e à máquina pelo código. Reimportar não duplica.</div></div></div>
    <div class="grid2">
      <div class="card"><h2>1. Ordens de produção</h2><input type="file" id="im-op" accept=".xlsx,.xls,.csv,.txt"><div id="im-op-map" style="margin-top:10px"></div><button class="btn primary" id="im-op-ok" hidden style="margin-top:8px">Importar OPs</button><div id="im-op-res" class="small"></div></div>
      <div class="card"><h2>2. Apontamentos</h2><input type="file" id="im-ap" accept=".xlsx,.xls,.csv,.txt"><div id="im-ap-map" style="margin-top:10px"></div><button class="btn primary" id="im-ap-ok" hidden style="margin-top:8px">Importar apontamentos</button><div id="im-ap-res" class="small"></div></div>
    </div>
    <p class="small muted">OP nova: entra como "liberada", com as etapas do roteiro do produto. OP já importada: atualiza quantidade, entrega e situação (concluída/cancelada). Apontamento sem OP importada é ignorado e contado no resultado.</p>`;
  const prep = (inp, mapEl, btn, campos, rpc, resEl, ajuste) => {
    $(inp, root).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const aoa = await lerPlanilha(f); const M = mapearColunas($(mapEl, root), aoa, campos); $(btn, root).hidden = false;
        $(btn, root).onclick = async (ev) => {
          if (!M.ok()) return toast('Escolha as colunas obrigatórias', true);
          const itens = M.linhas().map(ajuste).filter(x => x.numero_iniflex);
          if (!itens.length) return toast('Nenhuma linha com número de OP', true);
          ev.target.disabled = true;
          try { let tot = {}; for (let i = 0; i < itens.length; i += 500) { const r = await q(sb.rpc(rpc, { p_empresa: state.empresa.id, p_itens: itens.slice(i, i + 500) })); for (const [k, v] of Object.entries(r)) tot[k] = (tot[k] || 0) + v; }
            $(resEl, root).innerHTML = `<p class="pos">Importado: ${Object.entries(tot).map(([k, v]) => `${esc(k.replace('_', ' '))} ${v}`).join(' · ')}.</p>`; toast('Importação concluída');
          } catch (err) { fail(err); } finally { ev.target.disabled = false; }
        };
      } catch (err) { fail(err); }
    };
  };
  prep('#im-op', '#im-op-map', '#im-op-ok', OPS, 'prod_importar_ordens', '#im-op-res', (x) => ({ ...x, numero_iniflex: x.numero_iniflex ? String(x.numero_iniflex) : null,
    codigo_produto: x.codigo_produto ? String(x.codigo_produto) : null, status: ST[String(x.status || '').toLowerCase().trim()] || null }));
  prep('#im-ap', '#im-ap-map', '#im-ap-ok', APS, 'prod_importar_apontamentos', '#im-ap-res', (x) => ({ ...x, numero_iniflex: x.numero_iniflex ? String(x.numero_iniflex) : null, maquina: x.maquina ? String(x.maquina) : null }));
}
