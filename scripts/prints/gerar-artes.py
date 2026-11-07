#!/usr/bin/env python3
"""Gera artes de embalagem FICTÍCIAS (SVG) para as figuras do manual da pré-impressão.
Marcas, produtos e códigos são inventados. Saída: scripts/prints/artes/*.svg"""
import os, math

OUT = os.path.join(os.path.dirname(__file__), 'artes')
os.makedirs(OUT, exist_ok=True)
W, H = 1500, 1050

L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
G = [''.join('1' if c == '0' else '0' for c in x)[::-1] for x in L]
R = [''.join('1' if c == '0' else '0' for c in x) for x in L]
PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

def dv(d12):
    s = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(d12))
    return str((10 - s % 10) % 10)

def ean13(cod, x, y, mod=2.6, h=110):
    d = cod[:12] + dv(cod[:12])
    bits = '101' + ''.join((L if PAR[int(d[0])][i] == 'L' else G)[int(c)] for i, c in enumerate(d[1:7])) + '01010' + ''.join(R[int(c)] for c in d[7:]) + '101'
    out = [f'<rect x="{x - 14}" y="{y - 8}" width="{len(bits) * mod + 28}" height="{h + 40}" fill="#fff"/>']
    for i, b in enumerate(bits):
        if b == '1':
            guard = i < 3 or 45 <= i < 50 or i >= 92
            out.append(f'<rect x="{x + i * mod:.1f}" y="{y}" width="{mod:.1f}" height="{h + (10 if guard else 0)}" fill="#111"/>')
    out.append(f'<text x="{x - 10}" y="{y + h + 24}" font-size="17" font-family="Arial">{d[0]}</text>')
    out.append(f'<text x="{x + 6 * mod}" y="{y + h + 24}" font-size="17" font-family="Arial" letter-spacing="5.2">{d[1:7]}</text>')
    out.append(f'<text x="{x + 52 * mod}" y="{y + h + 24}" font-size="17" font-family="Arial" letter-spacing="5.2">{d[7:]}</text>')
    return '\n'.join(out), d

def marcas():
    s = []
    for (x, y) in [(18, 18), (W - 18, 18), (18, H - 18), (W - 18, H - 18)]:
        s.append(f'<g stroke="#111" stroke-width="1.2" fill="none"><circle cx="{x}" cy="{y}" r="9"/><path d="M{x-14} {y}h28M{x} {y-14}v28"/></g>')
    cores = ['#00a0e3', '#e5007e', '#ffed00', '#1d1d1b']
    for i, c in enumerate(cores):
        s.append(f'<rect x="{W/2 - 120 + i * 60}" y="{H - 30}" width="50" height="16" fill="{c}"/>')
    return '\n'.join(s)

def tabela(x, y, linhas, cor='#111', w=330):
    s = [f'<rect x="{x}" y="{y}" width="{w}" height="{40 + 28 * len(linhas)}" fill="#fff" stroke="{cor}" stroke-width="2"/>',
         f'<text x="{x + 12}" y="{y + 27}" font-size="17" font-weight="700" font-family="Arial" fill="{cor}">INFORMAÇÃO NUTRICIONAL — porção 30 g</text>']
    for i, (a, b) in enumerate(linhas):
        yy = y + 40 + 28 * i
        s.append(f'<line x1="{x}" x2="{x + w}" y1="{yy}" y2="{yy}" stroke="{cor}" stroke-width="1"/>')
        s.append(f'<text x="{x + 12}" y="{yy + 20}" font-size="15" font-family="Arial" fill="{cor}">{a}</text><text x="{x + w - 12}" y="{yy + 20}" font-size="15" font-family="Arial" text-anchor="end" fill="{cor}">{b}</text>')
    return '\n'.join(s)

def texto(x, y, linhas, tam=14, cor='#222', peso='400'):
    return '\n'.join(f'<text x="{x}" y="{y + i * (tam + 5)}" font-size="{tam}" font-family="Arial" font-weight="{peso}" fill="{cor}">{t}</text>' for i, t in enumerate(linhas))

def recicla(x, y, cor='#111'):
    return f'<g transform="translate({x} {y})" fill="none" stroke="{cor}" stroke-width="4"><path d="M0 -26 L22 12 L-22 12 Z"/></g><text x="{x}" y="{y + 8}" text-anchor="middle" font-size="14" font-weight="700" font-family="Arial" fill="{cor}">5</text><text x="{x}" y="{y + 36}" text-anchor="middle" font-size="12" font-family="Arial" fill="{cor}">PP</text>'

def svg(corpo):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">\n<rect width="{W}" height="{H}" fill="#fff"/>\n{corpo}\n{marcas()}\n</svg>\n'

def biscoito(v2=False):
    s = ['<defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d7262e"/><stop offset="1" stop-color="#a5121b"/></linearGradient>'
         '<radialGradient id="bi" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#f7d28b"/><stop offset="1" stop-color="#d79a3d"/></radialGradient></defs>',
         f'<rect x="40" y="40" width="{W - 80}" height="{H - 110}" fill="url(#g1)"/>',
         '<rect x="40" y="40" width="40" height="940" fill="#8d0f17"/><rect x="1420" y="40" width="40" height="940" fill="#8d0f17"/>',
         '<line x1="750" y1="40" x2="750" y2="980" stroke="#fff" stroke-dasharray="8 8" stroke-opacity=".35"/>']
    # frente (direita)
    s.append('<g transform="translate(790 80)">')
    s.append('<rect x="0" y="0" width="590" height="880" rx="0" fill="none"/>')
    s.append('<ellipse cx="295" cy="110" rx="190" ry="64" fill="#fff"/><text x="295" y="128" text-anchor="middle" font-size="54" font-weight="900" font-family="Georgia" fill="#c41922" font-style="italic">Vila Doce</text>')
    s.append('<text x="295" y="250" text-anchor="middle" font-size="76" font-weight="900" font-family="Arial" fill="#fff">Crocantíssimo</text>')
    s.append(f'<text x="295" y="318" text-anchor="middle" font-size="{46 if v2 else 52}" font-weight="700" font-family="Arial" fill="#ffe08a">{"Maria Tradicional" if v2 else "Maria"}</text>')
    for i, (cx, cy) in enumerate([(170, 560), (330, 520), (430, 650), (240, 700)]):
        s.append(f'<circle cx="{cx}" cy="{cy}" r="120" fill="url(#bi)" stroke="#b77a2a" stroke-width="5"/>')
        for k in range(9):
            a = k / 9 * math.tau
            s.append(f'<circle cx="{cx + 62 * math.cos(a):.1f}" cy="{cy + 62 * math.sin(a):.1f}" r="5" fill="#b77a2a"/>')
        s.append(f'<text x="{cx}" y="{cy + 10}" text-anchor="middle" font-size="26" font-weight="700" font-family="Georgia" fill="#b77a2a">MARIA</text>')
    s.append('<rect x="20" y="800" width="170" height="60" rx="30" fill="#fff"/><text x="105" y="842" text-anchor="middle" font-size="34" font-weight="800" font-family="Arial" fill="#c41922">200 g</text>')
    if v2:
        pts = ' '.join(f'{500 + (78 if k % 2 == 0 else 60) * math.cos(k / 24 * math.tau):.1f},{420 + (78 if k % 2 == 0 else 60) * math.sin(k / 24 * math.tau):.1f}' for k in range(24))
        s.append(f'<polygon points="{pts}" fill="#ffd400"/><text x="500" y="412" text-anchor="middle" font-size="30" font-weight="900" font-family="Arial" fill="#c41922">NOVA</text><text x="500" y="444" text-anchor="middle" font-size="22" font-weight="700" font-family="Arial" fill="#c41922">receita</text>')
    s.append('</g>')
    # verso (esquerda)
    s.append('<g transform="translate(110 90)"><rect x="0" y="0" width="610" height="860" fill="#fff" rx="14"/>')
    s.append('<text x="24" y="52" font-size="30" font-weight="800" font-family="Arial" fill="#c41922">Crocantíssimo Maria' + (' Tradicional' if v2 else '') + '</text>')
    s.append(texto(24, 92, ['INGREDIENTES: farinha de trigo enriquecida com ferro e ácido fólico, açúcar,', 'gordura vegetal, açúcar invertido, amido, sal, fermentos químicos', '(bicarbonato de sódio e de amônio), emulsificante lecitina de soja e aroma.', 'ALÉRGICOS: CONTÉM TRIGO E DERIVADOS DE SOJA. PODE CONTER LEITE.', 'CONTÉM GLÚTEN.'], 15, '#222'))
    s.append(tabela(24, 220, [('Valor energético', '133 kcal' if not v2 else '128 kcal'), ('Carboidratos', '22 g' if not v2 else '21 g'), ('Açúcares totais', '6,8 g' if not v2 else '5,9 g'), ('Proteínas', '2,3 g'), ('Gorduras totais', '3,9 g'), ('Sódio', '96 mg')], '#111', 420))
    s.append('<rect x="460" y="220" width="130" height="190" fill="#111"/><text x="525" y="262" text-anchor="middle" font-size="22" font-weight="800" fill="#fff" font-family="Arial">ALTO EM</text><text x="525" y="300" text-anchor="middle" font-size="20" fill="#fff" font-family="Arial">AÇÚCAR</text><text x="525" y="330" text-anchor="middle" font-size="20" fill="#fff" font-family="Arial">ADICIONADO</text>' if True else '')
    b, d = ean13('789912345012', 50, 520)
    s.append(b)
    s.append(texto(330, 540, ['Fabricado por: Vila Doce Alimentos Ltda.', 'CNPJ 00.000.000/0001-00', 'Rua das Palmeiras, 100 — Cidade Exemplo', 'SAC 0800 000 0000', 'Lote e validade: ver na lateral.'], 14))
    s.append(recicla(560, 760))
    s.append('<text x="24" y="820" font-size="13" font-family="Arial" fill="#666">Conservar em local seco e fresco. Após aberto, consumir em até 5 dias.</text>')
    s.append('</g>')
    return svg('\n'.join(s))

def cafe():
    s = ['<defs><linearGradient id="c1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f2a4a"/><stop offset="1" stop-color="#1d4f86"/></linearGradient></defs>',
         f'<rect x="40" y="40" width="{W - 80}" height="{H - 110}" fill="url(#c1)"/>']
    s.append('<g transform="translate(800 90)"><g transform="translate(0 50)"><path d="M90 380 L200 230 L270 300 L370 170 L520 380 Z" fill="#2f6aa8"/><path d="M200 230 L230 270 L250 255 L270 300 Z M370 170 L400 215 L420 200 L450 240 Z" fill="#fff" opacity=".85"/></g>')
    s.append('<text x="300" y="100" text-anchor="middle" font-size="40" letter-spacing="10" font-family="Georgia" fill="#e7c36a">CAFÉ</text><text x="300" y="180" text-anchor="middle" font-size="86" font-weight="700" font-family="Georgia" fill="#fff">Serra Azul</text>')
    s.append('<rect x="120" y="440" width="360" height="70" fill="#e7c36a"/><text x="300" y="488" text-anchor="middle" font-size="36" font-weight="800" font-family="Arial" fill="#0f2a4a">TORRADO E MOÍDO</text>')
    s.append('<text x="300" y="590" text-anchor="middle" font-size="30" font-family="Arial" fill="#fff">Extraforte · 100% arábica</text>')
    for k in range(5): s.append(f'<ellipse cx="{180 + k * 60}" cy="690" rx="24" ry="34" fill="#6b3d1f" transform="rotate(25 {180 + k * 60} 690)"/><path d="M{180 + k * 60 - 6} 662 q12 28 0 56" stroke="#3b1f0d" stroke-width="4" fill="none" transform="rotate(25 {180 + k * 60} 690)"/>')
    s.append('<text x="300" y="840" text-anchor="middle" font-size="44" font-weight="800" font-family="Arial" fill="#e7c36a">500 g</text></g>')
    s.append('<g transform="translate(110 90)"><rect width="600" height="860" fill="#fff" rx="14"/>')
    s.append(texto(24, 54, ['Café Serra Azul Extraforte', ''], 28, '#0f2a4a', '800'))
    s.append(texto(24, 110, ['Grãos selecionados das montanhas, torra escura e aroma intenso.', 'Modo de preparo: 1 colher de sopa para 100 mL de água quente.', 'INGREDIENTE: café torrado e moído. NÃO CONTÉM GLÚTEN.'], 15))
    s.append(tabela(24, 220, [('Valor energético', '0 kcal'), ('Carboidratos', '0 g'), ('Proteínas', '0 g'), ('Sódio', '0 mg')], '#0f2a4a', 420))
    b, _ = ean13('789912345029', 50, 520); s.append(b)
    s.append(texto(330, 540, ['Torrefação Serra Azul Ltda.', 'CNPJ 00.000.000/0002-00', 'Selo de pureza (fictício)'], 14))
    s.append(recicla(560, 760, '#0f2a4a')); s.append('</g>')
    return svg('\n'.join(s))

def suco():
    s = ['<defs><linearGradient id="s1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb12b"/><stop offset="1" stop-color="#f26b1d"/></linearGradient></defs>',
         f'<rect x="40" y="40" width="{W - 80}" height="{H - 110}" fill="url(#s1)"/>']
    s.append('<g transform="translate(790 80)"><text x="300" y="120" text-anchor="middle" font-size="72" font-weight="900" font-family="Arial" fill="#fff">Pomar</text><text x="300" y="190" text-anchor="middle" font-size="44" font-family="Georgia" font-style="italic" fill="#3c7a1e">do Vale</text>')
    for (cx, cy, r) in [(210, 460, 150), (400, 520, 120)]:
        s.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#ff8c00" stroke="#fff" stroke-width="10"/>')
        for k in range(10): a = k / 10 * math.tau; s.append(f'<line x1="{cx}" y1="{cy}" x2="{cx + (r - 18) * math.cos(a):.1f}" y2="{cy + (r - 18) * math.sin(a):.1f}" stroke="#ffd27a" stroke-width="6"/>')
    s.append('<path d="M200 300 q40 -60 100 -40 q-30 50 -100 40" fill="#3c7a1e"/>')
    s.append('<text x="300" y="760" text-anchor="middle" font-size="54" font-weight="800" font-family="Arial" fill="#fff">LARANJA</text><text x="300" y="830" text-anchor="middle" font-size="32" font-family="Arial" fill="#fff">integral · 1 L</text></g>')
    s.append('<g transform="translate(110 90)"><rect width="600" height="860" fill="#fff" rx="14"/>')
    s.append(texto(24, 54, ['Suco de laranja integral'], 28, '#f26b1d', '800'))
    s.append(texto(24, 100, ['Sem adição de açúcar. Pasteurizado. Agite antes de beber.', 'Após aberto, conservar em geladeira e consumir em até 3 dias.'], 15))
    s.append(tabela(24, 200, [('Valor energético', '94 kcal'), ('Carboidratos', '21 g'), ('Açúcares totais', '18 g'), ('Vitamina C', '96 mg')], '#f26b1d', 420))
    b, _ = ean13('789912345036', 50, 520); s.append(b)
    s.append(recicla(560, 760, '#f26b1d')); s.append('</g>')
    return svg('\n'.join(s))

def racao():
    s = [f'<rect x="40" y="40" width="{W - 80}" height="{H - 110}" fill="#2e8b57"/>', '<rect x="40" y="700" width="1420" height="280" fill="#246d44"/>']
    s.append('<g transform="translate(800 90)"><text x="300" y="120" text-anchor="middle" font-size="88" font-weight="900" font-family="Arial" fill="#ffe14d">Patinhas</text>')
    for (x, y) in [(220, 380), (300, 330), (380, 380), (300, 470)]:
        s.append(f'<ellipse cx="{x}" cy="{y}" rx="{38 if y != 470 else 70}" ry="{48 if y != 470 else 56}" fill="#fff"/>')
    s.append('<text x="300" y="640" text-anchor="middle" font-size="40" font-weight="700" font-family="Arial" fill="#fff">Cães adultos · carne e vegetais</text><text x="300" y="820" text-anchor="middle" font-size="60" font-weight="900" font-family="Arial" fill="#ffe14d">1 kg</text></g>')
    s.append('<g transform="translate(110 90)"><rect width="600" height="860" fill="#fff" rx="14"/>')
    s.append(texto(24, 54, ['Patinhas — alimento completo'], 28, '#2e8b57', '800'))
    s.append(texto(24, 100, ['Composição básica: farinha de carne, milho integral moído, farelo de soja,', 'óleo de frango, vegetais desidratados e premix vitamínico.', 'Produto isento de registro (fictício).'], 15))
    s.append(tabela(24, 200, [('Proteína bruta (mín.)', '21%'), ('Extrato etéreo (mín.)', '8%'), ('Matéria fibrosa (máx.)', '4%'), ('Umidade (máx.)', '12%')], '#2e8b57', 420))
    b, _ = ean13('789912345043', 50, 520); s.append(b)
    s.append(recicla(560, 760, '#2e8b57')); s.append('</g>')
    return svg('\n'.join(s))

for nome, f in [('biscoito-v1', lambda: biscoito(False)), ('biscoito-v2', lambda: biscoito(True)), ('cafe-v1', cafe), ('suco-v1', suco), ('racao-v1', racao)]:
    open(os.path.join(OUT, nome + '.svg'), 'w').write(f())
print('artes geradas em', OUT, '| EAN do biscoito:', '789912345012' + dv('789912345012'))
