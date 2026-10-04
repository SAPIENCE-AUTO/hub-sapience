"""Uso: python revisar.py contenido.json
Revisa el contenido de una propuesta contra las reglas de Sapience antes de construirla.
Imprime cada problema con la lámina donde aparece. Sale con código 1 si encuentra algo."""
import json, re, sys

C = json.load(open(sys.argv[1], encoding='utf-8'))
problemas = []

PROHIBIDAS = ['completitud', 'operacionalizar', 'operacionaliza', 'trazabilidad', 'salida esperada',
              'elegibilidad', 'unidad de decisión', 'por cotizar', 'convencidos que', 'es percibido',
              'son percibidos', 'leverage', 'insightful']
PRECIO = re.compile(r'^(MXN \$\d{1,3}(,\d{3})*\.\d{2}( \+ IVA)?|USD \$\d{1,3}(,\d{3})*\.\d{2})$')


def textos(obj, ruta=''):
    if isinstance(obj, str):
        yield ruta, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from textos(v, f'{ruta}.{k}' if ruta else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from textos(v, f'{ruta}[{i}]')


for ruta, t in textos(C):
    if ruta.endswith(('archivo', 'fuente', 'foto', 'estilo', 'portada', 'tipo', 'icono', 'acomodo')) or 'fotos_portada' in ruta:
        continue
    low = t.lower()
    if re.search(r'(?<![\d$,.])0[1-9](?![\d,.:])', t):
        problemas.append((ruta, f'Numeración con cero a la izquierda: «{t}». Se cuenta 1, 2, 3.'))
    for p in PROHIBIDAS:
        if p in low:
            problemas.append((ruta, f'Expresión que no se usa: «{p}».'))
    if low.count('realiza') > 1:
        problemas.append((ruta, 'Más de un «realizar» en la misma frase.'))
    if re.search(r'(\b\w ){5,}', t):
        problemas.append((ruta, 'Texto con letras espaciadas (versalitas espaciadas).'))
    if (ruta.endswith('bisagra') or ruta.endswith('titulo')) and re.search(r'\w:\s', t):
        problemas.append((ruta, f'Dos puntos como bisagra: «{t}».'))
    if re.search(r'\d+\s*\n\s*(g|ml|kg|min|años|%)', t):
        problemas.append((ruta, 'Número separado de su unidad por un salto de línea.'))

nf = len(C.get('fases', []))
for i, l in enumerate(C.get('laminas', [])):
    tipo = l.get('tipo')
    if tipo == 'inversion':
        for pa in l.get('partidas', []):
            if not (PRECIO.match(pa['precio']) or pa['precio'].lower().startswith(('sin costo', 'incluido'))):
                problemas.append((f'laminas[{i}]', f'Precio con formato distinto al de Sapience: «{pa["precio"]}».'))
            if pa['fase'] >= nf:
                problemas.append((f'laminas[{i}]', 'Partida apunta a una fase que no existe.'))
        pq = l.get('paquete')
        if not pq:
            problemas.append((f'laminas[{i}]', 'La inversión no tiene precio final.'))
        else:
            if not PRECIO.match(pq['precio']):
                problemas.append((f'laminas[{i}]', f'Precio final con formato distinto: «{pq["precio"]}».'))
            if not pq.get('letra'):
                problemas.append((f'laminas[{i}]', 'Falta la cantidad en letra.'))
    if tipo in ('tiempos',):
        for b in l['barras']:
            if b.get('fase') is not None and b['fase'] >= nf:
                problemas.append((f'laminas[{i}]', 'Barra del cronograma apunta a una fase que no existe.'))
            if b['fin'] > len(l['semanas']):
                problemas.append((f'laminas[{i}]', 'Barra del cronograma se sale de las semanas.'))
    if tipo == 'muestra':
        edades = ' '.join(l['columnas'] + [f['nombre'] for f in l['filas']])
        if re.search(r'\b1[0-7]\b', edades) and not any('consentimiento' in n.lower() for n in l.get('notas', [])):
            problemas.append((f'laminas[{i}]', 'La muestra incluye menores y no menciona consentimiento de padres o tutores.'))
    if tipo == 'detalle_fase' and l['fase'] >= nf:
        problemas.append((f'laminas[{i}]', 'Detalle de fase apunta a una fase que no existe.'))

    if tipo == 'objetivos':
        g0 = (l.get('general') or ' ').split(' ')[0].lower()
        if l.get('general') and not re.search(r'(ar|er|ir)$', g0):
            problemas.append((f'laminas[{i}]', 'El objetivo general empieza con verbo en infinitivo.'))
        if not l.get('general'):
            problemas.append((f'laminas[{i}]', 'Falta el objetivo general.'))
        es = l.get('especificos', [])
        if not 2 <= len(es) <= 6:
            problemas.append((f'laminas[{i}]', f'Los objetivos específicos deben ser entre 2 y 6; hay {len(es)}.'))
        for k, e in enumerate(es):
            t0 = (e.get('titulo') or '').split(' ')[0].lower()
            if not re.search(r'(ar|er|ir)$', t0):
                problemas.append((f'laminas[{i}].especificos[{k}]', f'El objetivo específico «{e.get("titulo")}» es un tema, no un objetivo. Empieza con verbo en infinitivo (entender, explorar, identificar, co-crear, evaluar).'))
            if re.search(r'^(medir|cuantificar|dimensionar)', t0) and C.get('metodo') == 'cualitativo':
                problemas.append((f'laminas[{i}].especificos[{k}]', 'Verbo cuantitativo en un estudio cualitativo.'))
            if not e.get('titulo') or not (e.get('puntos') or e.get('preguntas') or e.get('texto')):
                problemas.append((f'laminas[{i}].especificos[{k}]', 'Cada objetivo específico lleva título y su desagregado (puntos, preguntas o texto).'))
    if tipo == 'contexto':
        for ci, col in enumerate(l.get('columnas', [])):
            for pi, p in enumerate(col.get('puntos', [])):
                f = p.get('fuente') if isinstance(p, dict) else None
                if f not in ('brief', 'persona', 'hipotesis'):
                    problemas.append((f'laminas[{i}].columnas[{ci}].puntos[{pi}]', 'Afirmación de contexto sin fuente. Cada punto lleva fuente: brief, persona (lo dijo quien pide la propuesta) o hipotesis (y entonces se redacta como hipótesis).'))

    # cajas de una misma fila: mismo número de puntos y largo parecido
    grupos = []
    if tipo == 'contexto': grupos = [('columnas', [c.get('puntos') or [c.get('texto', '')] for c in l.get('columnas', [])])]
    if tipo == 'objetivos': grupos = [('especificos', [e.get('puntos') or e.get('preguntas') or [e.get('texto', '')] for e in l.get('especificos', [])])]
    if tipo == 'seccion' and l.get('columnas'): grupos = [('columnas', [c.get('puntos', []) for c in l['columnas']])]
    if tipo == 'punto_partida': grupos = [('bloques', [[b.get('texto', '')] for b in l.get('bloques', [])])]
    for nombre, listas in grupos:
        if len(listas) < 2: continue
        cuentas = {len(x) for x in listas}
        if len(cuentas) > 1:
            problemas.append((f'laminas[{i}].{nombre}', f'Las cajas de la misma fila tienen distinto número de puntos ({sorted(len(x) for x in listas)}). Deben llevar los mismos.'))
        largos = [sum(len(p['texto'] if isinstance(p, dict) else p) for p in x) for x in listas]
        m = sum(largos) / len(largos)
        if m and (max(largos) > 1.45 * m or min(largos) < 0.6 * m):
            problemas.append((f'laminas[{i}].{nombre}', f'Las cajas de la misma fila tienen textos de largo muy distinto ({largos} caracteres). Empáralos para que se vean uniformes.'))

tipos = [l.get('tipo') for l in C.get('laminas', [])]
for req in ('objetivos', 'inversion'):
    if req not in tipos:
        problemas.append(('laminas', f'Falta la lámina de {req}.'))

if problemas:
    for r, p in problemas:
        print(f'[{r}] {p}')
    sys.exit(1)
print('Sin problemas.')
