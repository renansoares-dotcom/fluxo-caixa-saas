// Estilos da pré-impressão, usados na plataforma e no Portal do Cliente (sem dependências).
export const CSS = `<style>
  .pi-sel{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;background:var(--primary-soft);white-space:nowrap}
  .pi-sel.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.pi-sel.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
  .pi-sel.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}.pi-sel.info{background:color-mix(in srgb,var(--brand-cyan) 14%,transparent);color:var(--brand-cyan)}.pi-sel.muted{color:var(--muted)}
  .mm-topo .pi-acoes{display:flex;gap:8px;align-items:end;flex-wrap:nowrap;white-space:nowrap}
  .card label.chk,.modal label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400;color:var(--text);font-size:13px}.card label.chk input,.modal label.chk input{width:auto;min-height:0}
  .pi-kpis6{grid-template-columns:repeat(6,minmax(0,1fr))!important}@media(max-width:1100px){.pi-kpis6{grid-template-columns:repeat(3,minmax(0,1fr))!important}}@media(max-width:600px){.pi-kpis6{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
  .pi-passos{display:flex;gap:0;margin:2px 0 14px;counter-reset:p}
  .pi-passos div{flex:1;position:relative;text-align:center;font-size:11.5px;color:var(--muted);padding-top:26px}
  .pi-passos div::before{counter-increment:p;content:counter(p);position:absolute;top:0;left:50%;margin-left:-11px;width:22px;height:22px;border-radius:50%;background:var(--bg);border:2px solid var(--border);
    display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;z-index:1;box-sizing:border-box}
  .pi-passos div::after{content:'';position:absolute;top:10px;left:-50%;width:100%;height:2px;background:var(--border)}
  .pi-passos div:first-child::after{display:none}
  .pi-passos div.feito{color:var(--text)}.pi-passos div.feito::before{content:'✓';background:var(--pos);border-color:var(--pos);color:#fff}.pi-passos div.feito::after,.pi-passos div.atual::after{background:var(--pos)}
  .pi-passos div.atual{color:var(--text);font-weight:600}.pi-passos div.atual::before{background:var(--primary);border-color:var(--primary);color:#fff}
  .pi-passos div.atual.alerta::before{background:var(--neg);border-color:var(--neg)}
  .pi-arte{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:14px;align-items:start}
  .pi-lado{display:flex;flex-direction:column;gap:10px;max-height:calc(62vh + 46px);overflow:auto;padding-right:2px}
  .pi-bloco{border:1px solid var(--border);border-radius:10px;padding:10px 12px}
  .pi-bloco h3{margin:0 0 6px;font-size:13px}
  .pi-vers{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
  .pi-vers .spacer{flex:1}.pi-vers label.chk,.pi-bloco label.chk{display:flex;flex-direction:row;align-items:center;gap:6px;font-weight:400;font-size:13px}.pi-vers label.chk input,.pi-bloco label.chk input{width:auto;min-height:0}.pi-vers .chip b{font-weight:700}.pi-vers .chip.ap{border-color:var(--pos)}
  .pi-com{display:flex;gap:8px;padding:7px 0;border-top:1px solid var(--border);cursor:pointer}.pi-com:first-of-type{border-top:0}
  .pi-com .n{flex:0 0 22px;height:22px;border-radius:50%;background:var(--neg);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
  .pi-com .n.eq{background:var(--primary)}.pi-com .n.int{background:#7c3aed}.pi-com .n.ger{background:var(--muted)}.pi-com.ok{opacity:.6}.pi-com.ok .t{text-decoration:line-through}
  .pi-com .t{font-size:13px;white-space:pre-wrap;word-break:break-word}.pi-com .q{font-size:11px;color:var(--muted)}
  .pi-tl{border-left:2px solid var(--border);margin-left:6px;padding-left:14px}
  .pi-tl div{position:relative;padding:4px 0 8px;font-size:13px}.pi-tl div::before{content:'';position:absolute;left:-20px;top:9px;width:10px;height:10px;border-radius:50%;background:var(--primary)}
  .pi-tl div.int::before{background:var(--muted)}.pi-tl small{color:var(--muted);display:block}
  .pi-desb{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
  .pi-desb button{border:1px solid var(--border);border-radius:8px;background:var(--surface);padding:4px;cursor:pointer;color:var(--text)}
  .pi-desb button.on{border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-soft);color:var(--primary)}
  .pi-cores{display:flex;flex-direction:column;gap:6px}
  .pi-cor{display:grid;grid-template-columns:28px minmax(0,1fr) minmax(0,1fr) 40px 32px;gap:6px;align-items:center}
  .pi-cor input[type=color]{width:40px;height:34px;padding:2px;min-height:0}
  .pi-chip-cor{display:inline-flex;align-items:center;gap:4px;margin:0 6px 4px 0;font-size:12px}.pi-chip-cor i{width:14px;height:14px;border-radius:3px;border:1px solid var(--border);display:inline-block}
  .pi-ean{font-size:12px;margin-top:3px}.pi-ean.ok{color:var(--pos)}.pi-ean.erro{color:var(--neg)}
  .pi-drop{border:2px dashed var(--border);border-radius:12px;padding:22px;text-align:center;cursor:pointer;transition:.15s}
  .pi-drop.sobre{border-color:var(--primary);background:var(--primary-soft)}
  .pi-prev{display:grid;grid-template-columns:200px minmax(0,1fr);gap:14px;align-items:start;margin-top:12px}.pi-prev img{width:100%;border-radius:8px;border:1px solid var(--border);background:#fff}
  .pi-hash{font-family:ui-monospace,Menlo,monospace;font-size:11px;word-break:break-all;color:var(--muted)}
  .pi-dados{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 14px}.pi-dados>div>span:first-child{display:block;font-size:11.5px;color:var(--muted)}.pi-dados .w2{grid-column:span 2}
  .pi-kan{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
  .pi-col{background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:8px;min-height:120px;min-width:0}
  .pi-col h3{font-size:12.5px;margin:2px 4px 8px;display:flex;justify-content:space-between}
  .pi-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;cursor:pointer;overflow:hidden;transition:box-shadow .15s}
  .pi-card:hover{box-shadow:0 4px 14px rgba(0,0,0,.12)}
  .pi-card .im{height:92px;background:repeating-conic-gradient(var(--bg) 0 25%,var(--surface) 0 50%) 0 0/14px 14px;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .pi-card .im img{max-width:100%;max-height:92px;object-fit:contain}
  .pi-card .tx{padding:7px 9px;font-size:12px}.pi-card .tx b{font-size:12.5px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pi-card .tx .r{display:flex;justify-content:space-between;gap:4px;margin-top:3px;color:var(--muted)}
  .pi-card.atr{border-color:var(--neg)}
  .pi-mini{width:46px;height:34px;object-fit:contain;border:1px solid var(--border);border-radius:4px;background:#fff;vertical-align:middle}
  @media(max-width:1000px){.pi-arte{grid-template-columns:1fr}.pi-lado{max-height:none}.pi-kan{grid-template-columns:repeat(5,240px);overflow-x:auto}}
  @media(max-width:700px){.pi-dados{grid-template-columns:1fr 1fr}.pi-prev{grid-template-columns:1fr}.pi-desb{grid-template-columns:repeat(2,minmax(0,1fr))}.pi-passos div{font-size:10px}}
</style>`;
