// Receita Federal — APIs da Apuração Assistida da CBS (docs.receitafederal.gov.br/apuracao-cbs) e DARF do RAD.
// A tela (CPD › Fiscal › Apuração de Impostos › Apuração da CBS) chama esta função com o token do usuário; a função confere
// a permissão (rfb_pode), obtém o token da Receita com a credencial guardada em segredo e grava o retorno no banco.
// A credencial e o token da Receita nunca vão para o navegador, para o banco nem para os logs.
// Segredos: RFB_CBS_CHAVE (Client Id) e RFB_CBS_SEGREDO (Client Secret), gerados em Serviços da Receita Federal ›
// Gerar Credencial de Acesso para API › Chaves Secretas. Para uma empresa específica, acrescente _<CNPJ só dígitos>.
// Fluxo da consulta: POST /{serviço}/{cnpj8} -> tíquete · GET /situacao/{tíquete} · GET /download/{tíquete} -> urlAssinada · GET na urlAssinada (sem token).
// Ações: testar · solicitar (debitos | creditos | pagamentos | recolhimentos) · atualizar (situação + importação) · rad_gerar (DARF).
// rad_gerar está TRAVADA (18/11/2026): só funciona com o segredo RFB_CBS_PERMITIR_DARF = sim. Sem ele, a função só testa e consulta.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const BASE = 'https://api.receitafederal.gov.br/apuracao-cbs/v2', TOKEN_URL = 'https://api.receitafederal.gov.br/token';
const APIS = ['debitos', 'creditos', 'pagamentos', 'recolhimentos'];
const so = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const segredo = (nome: string, cnpj: string) => (Deno.env.get(`${nome}_${cnpj}`) || Deno.env.get(nome) || '').trim();

// token OAuth2 (Client Credentials). Guardado em memória enquanto a função fica viva; nunca sai daqui.
const cache = new Map<string, { tok: string; ate: number }>();
async function obterToken(cnpj: string): Promise<{ tok?: string; motivo?: string; http?: number }> {
  const id = segredo('RFB_CBS_CHAVE', cnpj), sec = segredo('RFB_CBS_SEGREDO', cnpj);
  if (!id || !sec) return { motivo: `Falta o segredo ${!id ? 'RFB_CBS_CHAVE' : 'RFB_CBS_SEGREDO'} na função (Supabase › Edge Functions › Secrets).` };
  const c = cache.get(id); if (c && c.ate > Date.now() + 30000) return { tok: c.tok };
  // 1ª forma: credencial no cabeçalho (Basic); 2ª: no corpo. As duas são do padrão OAuth2; a Receita aceita uma delas.
  const tentativas: [Record<string, string>, string][] = [
    [{ Authorization: 'Basic ' + btoa(`${id}:${sec}`), 'Content-Type': 'application/x-www-form-urlencoded' }, 'grant_type=client_credentials'],
    [{ 'Content-Type': 'application/x-www-form-urlencoded' }, `grant_type=client_credentials&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(sec)}`]];
  let ultimo = { http: 0, motivo: '' };
  for (const [headers, body] of tentativas) {
    try {
      const r = await fetch(TOKEN_URL, { method: 'POST', headers, body }); const txt = await r.text(); let d: any = null; try { d = JSON.parse(txt); } catch { /* resposta não é JSON */ }
      if (r.ok && d?.access_token) { cache.set(id, { tok: d.access_token, ate: Date.now() + Math.max(60, num(d.expires_in) || 300) * 1000 }); return { tok: d.access_token }; }
      ultimo = { http: r.status, motivo: String(d?.error_description || d?.error || d?.mensagem || d?.message || `HTTP ${r.status}`).slice(0, 200) };
    } catch (e) { ultimo = { http: 0, motivo: 'Receita Federal inacessível: ' + (e as Error).message.slice(0, 150) }; }
  }
  return { http: ultimo.http, motivo: `A Receita recusou a credencial ao pedir o token (${ultimo.motivo}). Confira os segredos RFB_CBS_CHAVE e RFB_CBS_SEGREDO.` };
}
async function rfb(tok: string, metodo: string, caminho: string, corpo?: unknown) {
  try {
    const r = await fetch(BASE + caminho, { method: metodo, headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
    const txt = await r.text(); let d: any = null; try { d = JSON.parse(txt); } catch { d = { mensagemErro: txt.slice(0, 300) }; }
    return { http: r.status, d };
  } catch (e) { return { http: 0, d: { codigoErro: 'SEM_CONEXAO', mensagemErro: 'Receita Federal inacessível: ' + (e as Error).message.slice(0, 150) } }; }
}
// procura a URL assinada do arquivo em qualquer campo conhecido do retorno (a documentação não fixa o nome do campo na consulta de situação)
const urlAssinadaDe = (d: any): string => d?.urlAssinada || d?.urlDownload || d?.download?.urlAssinada || d?.arquivo?.urlAssinada || '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const adm = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const b = await req.json().catch(() => ({}));
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = jwt ? await adm.auth.getUser(jwt) : { data: { user: null } };
    if (!u?.user) return json({ erro: 'não autorizado' }, 401);
    const usr = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const empresa = String(b.empresa_id || '');
    const { data: pode } = empresa ? await usr.rpc('rfb_pode', { p_empresa: empresa }) : { data: false };
    if (!pode) return json({ erro: 'Sem permissão para falar com a Receita Federal nesta empresa (administrador ou financeiro).' }, 403);
    const { data: emp } = await adm.from('empresas').select('cnpj').eq('id', empresa).single();
    const cnpj = so(emp?.cnpj); if (cnpj.length !== 14) return json({ erro: 'O CNPJ da empresa não está cadastrado com 14 dígitos (Cadastros › Empresa).' }, 400);
    const { data: mb } = await adm.from('membros').select('nome').eq('empresa_id', empresa).eq('user_id', u.user.id).maybeSingle();

    const t = await obterToken(cnpj);
    if (b.acao === 'testar') return json(t.tok ? { ok: true, motivo: 'Credencial aceita pela Receita Federal: token de acesso obtido.' } : { ok: false, http: t.http ?? null, motivo: t.motivo });
    if (!t.tok) return json({ erro: t.motivo }, 400);
    const tok = t.tok;

    // ---- abre uma consulta assíncrona (a Receita aceita 4 por dia por serviço e por credencial) ----
    if (b.acao === 'solicitar') {
      const api = String(b.api || ''); if (!APIS.includes(api)) return json({ erro: 'Serviço inválido.' }, 400);
      const { data: aberta } = await adm.from('rfb_cbs_solicitacoes').select('id').eq('empresa_id', empresa).eq('api', api).in('situacao', ['PENDENTE', 'EM_PROCESSAMENTO']).limit(1);
      if (aberta?.length) return json({ erro: 'Já existe uma consulta deste serviço em andamento. Atualize a situação dela antes de pedir outra.' }, 409);
      const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);   // dia no horário de Brasília
      const { count } = await adm.from('rfb_cbs_solicitacoes').select('id', { count: 'exact', head: true }).eq('empresa_id', empresa).eq('api', api).neq('situacao', 'RECUSADA').gte('solicitada_em', hoje + 'T03:00:00Z');
      if ((count || 0) >= 4) return json({ erro: 'A Receita aceita 4 consultas por dia para cada serviço. O limite de hoje já foi usado.' }, 429);
      const r = await rfb(tok, 'POST', `/${api}/${cnpj.slice(0, 8)}`, { urlRetorno: '' });
      const ok = r.http === 201 && r.d?.tiqueteSolicitacao;
      const { data: s } = await adm.from('rfb_cbs_solicitacoes').insert({ empresa_id: empresa, api, tiquete: ok ? r.d.tiqueteSolicitacao : null, situacao: ok ? 'PENDENTE' : 'RECUSADA', tea_segundos: ok ? num(r.d.tEASegundos) : null,
        codigo_erro: ok ? null : (r.d?.codigoErro || `HTTP_${r.http}`), mensagem_erro: ok ? null : String(r.d?.mensagemErro || '').slice(0, 300), solicitada_por: u.user.id, solicitada_por_nome: mb?.nome || u.user.email || null }).select('id').single();
      return json({ ok: !!ok, id: s?.id, http: r.http, tea_segundos: ok ? num(r.d.tEASegundos) : null, erro: ok ? undefined : (r.d?.mensagemErro || r.d?.codigoErro || `HTTP ${r.http}`) }, ok ? 200 : 502);
    }

    // ---- consulta a situação do tíquete; concluída, baixa o arquivo e importa ----
    if (b.acao === 'atualizar') {
      const { data: s } = await adm.from('rfb_cbs_solicitacoes').select('*').eq('id', b.solicitacao_id).eq('empresa_id', empresa).maybeSingle();
      if (!s?.tiquete) return json({ erro: 'Consulta não encontrada.' }, 404);
      if (s.importada_em) return json({ ok: true, situacao: s.situacao, registros: s.registros, ja: true });
      // tentar de novo depois de uma falha no download: quem já está CONCLUIDA não consulta a situação outra vez
      const r = s.situacao === 'CONCLUIDA' ? { http: 200, d: { situacao: 'CONCLUIDA' } as any } : await rfb(tok, 'GET', `/situacao/${encodeURIComponent(s.tiquete)}`);
      const valida = ['PENDENTE', 'EM_PROCESSAMENTO', 'CONCLUIDA', 'ERRO', 'EXPIRADA'].includes(r.d?.situacao);
      if (!valida) {   // resposta fora do padrão (HTTP diferente de 200 ou sem o campo situacao): não muda a situação; guarda o HTTP e os NOMES dos campos
        const msg = String(r.d?.mensagemErro || r.d?.message || r.d?.mensagem || `HTTP ${r.http}`).slice(0, 200);
        await adm.from('rfb_cbs_solicitacoes').update({ atualizada_em: new Date().toISOString(), codigo_erro: r.d?.codigoErro || `HTTP_${r.http}`, mensagem_erro: 'Consulta da situação falhou: ' + msg, resumo: { http_situacao: r.http, campos_da_situacao: Object.keys(r.d || {}) } }).eq('id', s.id);
        return json({ ok: false, situacao: s.situacao, erro: `A Receita não informou a situação agora (${msg}). Tente atualizar de novo em instantes.` });
      }
      const sit = r.d.situacao;
      const base: Record<string, unknown> = { situacao: sit, atualizada_em: new Date().toISOString(), codigo_erro: r.d?.codigoErro || null, mensagem_erro: r.d?.mensagemErro ? String(r.d.mensagemErro).slice(0, 300) : null };
      if (sit !== 'CONCLUIDA') { await adm.from('rfb_cbs_solicitacoes').update(base).eq('id', s.id); return json({ ok: sit !== 'ERRO' && sit !== 'EXPIRADA', situacao: sit, erro: r.d?.mensagemErro }); }
      // concluída: o link do arquivo vem de outro serviço — GET /download/{tíquete} devolve a urlAssinada (docs.receitafederal.gov.br/apuracao-cbs/download.html)
      const dl = await rfb(tok, 'GET', `/download/${encodeURIComponent(s.tiquete)}`);
      const link = urlAssinadaDe(dl.d);
      if (dl.http !== 200 || !link) {   // sem link: continua CONCLUIDA para poder tentar de novo; guarda o HTTP e os NOMES dos campos (sem valores)
        const msg = String(dl.d?.mensagemErro || dl.d?.message || `HTTP ${dl.http}`).slice(0, 200);
        await adm.from('rfb_cbs_solicitacoes').update({ ...base, codigo_erro: dl.d?.codigoErro || `HTTP_${dl.http}`, mensagem_erro: 'Link do arquivo não obtido: ' + msg, resumo: { http_download: dl.http, campos_do_download: Object.keys(dl.d || {}) } }).eq('id', s.id);
        return json({ ok: false, situacao: sit, erro: `A consulta foi concluída, mas a Receita não liberou o link do arquivo (${msg}). Tente atualizar de novo em instantes.` });
      }
      let arq: any = null;
      try { const g = await fetch(link); if (!g.ok) throw new Error('HTTP ' + g.status); arq = await g.json(); } catch (e) { await adm.from('rfb_cbs_solicitacoes').update({ ...base, mensagem_erro: 'Falha ao baixar o arquivo: ' + (e as Error).message.slice(0, 120) }).eq('id', s.id); return json({ ok: false, situacao: sit, erro: 'Falha ao baixar o arquivo da Receita. Tente atualizar de novo.' }); }
      const ap: any[] = Array.isArray(arq?.apuracao) ? arq.apuracao : []; let n = 0; const erros: string[] = [];
      if (s.api === 'creditos') {
        const L: Record<string, unknown>[] = [];
        for (const a of ap) for (const c of a.creditos || []) { const cb = c.cbs || {}, apz = cb.apropriacao || {}, ut = apz.utilizacao || cb.utilizacao || {}, nu = ut.naoUtilizado || cb.naoUtilizado || {};
          L.push({ empresa_id: empresa, chave: String(c.chave || ''), pa: String(a.pa || ''), origem: num(c.origem), documento: c.documento ?? null, emissao: c.emissao || null, registro: c.registro || null, atualizacao: c.atualizacao || null,
            apurado: num(cb.apurado), excedente: num(cb.excedente), a_apropriar: num(apz.aApropriar), apropriado: num(apz.apropriado), inapropriavel: num(apz.inapropriavel), suspenso: num(apz.suspenso), prescrito: num(apz.prescrito),
            utilizado: num(ut.utilizado), saldo_credor: num(nu.saldoCredor), dados: cb, solicitacao_id: s.id, recebido_em: new Date().toISOString() }); }
        for (let i = 0; i < L.length; i += 500) { const { error } = await adm.from('rfb_cbs_creditos').upsert(L.slice(i, i + 500).filter(x => x.chave), { onConflict: 'empresa_id,chave,pa,origem' }); if (error) erros.push(error.message); }
        n = L.length;
      } else if (s.api === 'recolhimentos') {
        const L: Record<string, unknown>[] = [];
        for (const a of ap) for (const p of a.pagamentos || []) for (const c of p.composicao || [])
          L.push({ empresa_id: empresa, numero_darf: String(p.numeroDARF || ''), sequencial: num(c.sequencial), tipo: p.tipo ?? null, data_arrecadacao: a.dataArrecadacao || null, pa: c.pa || null, vencimento: c.vencimento || null,
            ni_fornecedor: c.niFornecedor || null, chave: c.chaveDFE || null, principal: num(c.principal), multa: num(c.multa), juros: num(c.juros), total: num(c.total), solicitacao_id: s.id, recebido_em: new Date().toISOString() });
        for (let i = 0; i < L.length; i += 500) { const { error } = await adm.from('rfb_cbs_recolhimentos').upsert(L.slice(i, i + 500).filter(x => x.numero_darf), { onConflict: 'empresa_id,numero_darf,sequencial' }); if (error) erros.push(error.message); }
        n = L.length; if (n) await adm.rpc('rad_confirmar_recolhidos', { p_empresa: empresa });
      } else n = ap.length;   // débitos e pagamentos: por enquanto só o resumo (a importação detalhada entra na conferência da apuração)
      const resumo = { geradoEm: arq?.geradoEm || null, periodos: [...new Set(ap.map(a => a.pa || a.dataArrecadacao).filter(Boolean))].slice(0, 24), apuracoes: ap.length, registros: n, erros: erros.slice(0, 3) };
      await adm.from('rfb_cbs_solicitacoes').update({ ...base, importada_em: erros.length ? null : new Date().toISOString(), registros: n, resumo, mensagem_erro: erros.length ? ('Falha ao gravar: ' + erros[0]).slice(0, 300) : null }).eq('id', s.id);
      return json({ ok: !erros.length, situacao: sit, registros: n, resumo });
    }

    // ---- gera o DARF do recolhimento pelo adquirente para as notas marcadas (uma chamada por nota, para o retorno ser inequívoco) ----
    if (b.acao === 'rad_gerar') {
      // 18/11/2026 (pedido do Renan): por enquanto só teste e consulta. Gerar DARF fica travado aqui até o segredo RFB_CBS_PERMITIR_DARF = sim existir.
      if (Deno.env.get('RFB_CBS_PERMITIR_DARF') !== 'sim') return json({ erro: 'A geração de DARF está desligada nesta plataforma. Por enquanto, só o teste de conexão e as consultas estão liberados.' }, 403);
      const ids: string[] = Array.isArray(b.recolhimento_ids) ? b.recolhimento_ids.slice(0, 20) : [];
      if (!ids.length) return json({ erro: 'Nenhuma nota informada.' }, 400);
      const { data: cfg } = await adm.from('rad_config').select('ativo').eq('empresa_id', empresa).maybeSingle();
      if (!cfg?.ativo) return json({ erro: 'O recolhimento pelo adquirente está desligado nos parâmetros.' }, 400);
      const { data: R } = await adm.from('rad_recolhimentos').select('id, chave, situacao, valor_cbs').eq('empresa_id', empresa).in('id', ids);
      const parcial: Record<string, number> = b.parcial && typeof b.parcial === 'object' ? b.parcial : {};
      const out: unknown[] = [];
      for (const r of R || []) {
        if (!['marcado', 'darf_gerado'].includes(r.situacao)) { out.push({ id: r.id, ok: false, cdRetorno: 'SITUACAO', mensagem: 'A nota não está marcada.' }); continue; }
        if (so(r.chave).length !== 44) { out.push({ id: r.id, ok: false, cdRetorno: 'SEM_CHAVE', mensagem: 'A nota não tem a chave de 44 dígitos.' }); continue; }
        const vp = num(parcial[r.id]), opcao = vp > 0 ? 'PAGAMENTO_PARCIAL' : 'PAGAMENTO_TOTAL';
        const x = await rfb(tok, 'POST', `/rad/${cnpj}`, [{ chaveDFE: so(r.chave), opcaoPagamento: opcao, ...(vp > 0 ? { valorDarfParcial: Math.round(vp * 100) / 100 } : {}) }]);
        const d = Array.isArray(x.d) ? x.d[0] : x.d, dados = { ...(d || {}), opcaoPagamento: opcao, cdRetorno: d?.cdRetorno || d?.codigoErro || `HTTP_${x.http}`, mensagem: d?.mensagem || d?.mensagemErro || (d?.dadosInvalidos ? 'Dados inválidos: ' + d.dadosInvalidos.join(', ') : null) };
        const { data: g, error } = await adm.rpc('rad_darf_registrar', { p_id: r.id, p_usuario: u.user.id, p_dados: dados });
        out.push({ id: r.id, ok: !error && !!g?.ok, cdRetorno: dados.cdRetorno, mensagem: error?.message || dados.mensagem, valor: g?.valor ?? null, lancamento_id: g?.lancamento_id ?? null });
      }
      return json({ ok: out.every((o: any) => o.ok), resultados: out });
    }
    return json({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) { return json({ erro: 'Falha na função: ' + (e as Error).message.slice(0, 200) }, 500); }
});
