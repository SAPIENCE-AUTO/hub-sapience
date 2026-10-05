"""Uso: python revisar.py contenido.json
Revisa el contenido de una propuesta contra las reglas de Sapience antes de construirla.
Imprime cada problema con la lámina donde aparece. Sale con código 1 si encuentra algo."""
import json, math, os, re, sys

C = json.load(open(sys.argv[1], encoding='utf-8'))
problemas = []

PROHIBIDAS = ['completitud', 'operacionalizar', 'operacionaliza', 'trazabilidad', 'salida esperada',
              'elegibilidad', 'unidad de decisión', 'por cotizar', 'convencidos que', 'es percibido',
              'son percibidos', 'leverage', 'insightful']
LETRA = re.compile(r'^[A-ZÁÉÍÓÚ][a-záéíóúñ ]+ (pesos mexicanos|dólares)( \+ IVA)?$')
ANCHO = 12.13  # ancho útil de la lámina en pulgadas


def renglones_texto(t, w, sz, k):
    # renglones palabra por palabra, igual que el constructor (anchos medidos con Montserrat)
    maximo = (w - 0.05) * 72
    total = 0
    for l in str(t).split('\n'):
        r, ancho = 1, 0
        for p in l.split():
            pw, esp = len(p) * k * sz, (0.28 * sz if ancho else 0)
            if ancho and ancho + esp + pw > maximo:
                r += 1; ancho = pw
            else:
                ancho += esp + pw
            while ancho > maximo:
                r += 1; ancho -= maximo
        total += r
    return total


def renglones_b(t, w, sz, mayus=False):
    return renglones_texto(t, w, sz, 0.70 if mayus else 0.55)


def renglones(t, w, sz):
    return renglones_texto(t, w, sz, 0.54)


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
    if ruta.endswith(('archivo', 'fuente', 'foto', 'estilo', 'portada', 'tipo', 'icono', 'acomodo', 'etapa')) or 'fotos_portada' in ruta:
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
    if re.search(r'\b(en cuáles|cuándo|dónde) no\b', low) and not ruta.endswith(('nota', 'notas')):
        problemas.append((ruta, f'Pregunta binaria o absoluta: «{t}». Se pregunta para entender desde el consumidor (cuándo la eligen y qué los lleva a dejarla fuera), no para clasificar.'))
    if re.search(r'\bel brief\b', low):
        problemas.append((ruta, 'Menciona «el brief». La propuesta le habla al cliente; se dice lo que el cliente nos compartió o se plantea directo.'))
    if re.search(r'<\s*\d+\s*>', t):
        problemas.append((ruta, f'Número suelto entre corchetes angulares: «{t}». La aclaración operativa lleva texto: «<6 participantes cada una>».'))
    if re.search(r'\w:\s', t):
        problemas.append((ruta, f'Dos puntos como bisagra: «{t}». Se reescribe con conector (porque, para, en el que) o se parte en dos oraciones.'))
    if re.search(r'\d+\s*\n\s*(g|ml|kg|min|años|%)', t):
        problemas.append((ruta, 'Número separado de su unidad por un salto de línea.'))

nf = len(C.get('fases', []))
try:
    TS = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'estilos', f'estilo_{C.get("estilo", "A")}.json'), encoding='utf-8'))['TS']
except Exception:
    TS = 54
ILU = bool(C.get('ilustraciones'))
for i, l in enumerate(C.get('laminas', [])):
    tipo = l.get('tipo')
    if l.get('titulo') and renglones_b(l['titulo'].upper(), ANCHO, TS, True) > 1:
        problemas.append((f'laminas[{i}].titulo', f'El título de la lámina «{l["titulo"]}» no cabe en un renglón. Acórtalo.'))
    if tipo == 'contexto' and l.get('entrada'):
        ent = ' '.join(r if isinstance(r, str) else r.get('texto', '') for r in l['entrada'])
        if renglones_b(ent, ANCHO, 15) > 3:
            problemas.append((f'laminas[{i}].entrada', 'La entrada del contexto pasa de 3 renglones. Déjala en lo esencial.'))
    if tipo == 'contexto' and l.get('columnas'):
        n = len(l['columnas']); w = (ANCHO - 0.25 * (n - 1)) / n
        rs = [renglones_b(c.get('titulo', '').upper(), w - (0.7 if c.get('icono') and not ILU else 0.2), 14, True) for c in l['columnas']]
        if max(rs) > 2:
            problemas.append((f'laminas[{i}].columnas', 'Un encabezado de color del contexto pasa de 2 renglones. Acórtalo.'))
        elif len(set(rs)) > 1:
            problemas.append((f'laminas[{i}].columnas', f'Los encabezados de color ocupan distinto número de renglones ({rs}). Todos van en 1 o todos en 2.'))
    if tipo == 'objetivos' and l.get('especificos'):
        E = l['especificos']; n = len(E); pf = n if n <= 3 else (2 if n == 4 else 3)
        w = (ANCHO - 0.2 * (pf - 1)) / pf - 0.4 - (0.85 if ILU else 0); z = 13 if n <= 3 else 12
        rs = [renglones_b(e.get('titulo', ''), w, z + 2) for e in E]
        if max(rs) > 2:
            problemas.append((f'laminas[{i}].especificos', f'Hay títulos de objetivos de más de 2 renglones ({rs}). Acórtalos.'))
        elif len(set(rs)) > 1:
            problemas.append((f'laminas[{i}].especificos', f'Los títulos de los objetivos ocupan distinto número de renglones ({rs}). Todos van en 1 o todos en 2.'))
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
            elif not LETRA.match(pq['letra']):
                problemas.append((f'laminas[{i}].paquete.letra', f'Cantidad en letra con formato distinto: «{pq["letra"]}». Va así y sin agregados: «Seiscientos diez mil pesos mexicanos + IVA».'))
        partidas = l.get('partidas', [])
        if partidas:
            w = (ANCHO - 0.18 * (len(partidas) - 1)) / len(partidas)
            for k, pa in enumerate(partidas):
                nombre = (C.get('fases', [{}] * (pa['fase'] + 1))[pa['fase']].get('nombre') or '') if pa['fase'] < nf else ''
                if nombre and pa['descripcion'].lower().startswith(nombre.lower()):
                    problemas.append((f'laminas[{i}].partidas[{k}]', f'La descripción repite el nombre de la fase «{nombre}», que ya va en la píldora.'))
                if renglones(pa['descripcion'], w, 13) > 2:
                    problemas.append((f'laminas[{i}].partidas[{k}]', 'La descripción de la partida no cabe en dos líneas. Acórtala.'))
        if l.get('nota') and renglones(l['nota'], ANCHO, 10) > 1:
            problemas.append((f'laminas[{i}].nota', 'La nota de inversión no cabe en una línea. Acórtala.'))
    if tipo in ('tiempos',):
        for b in l['barras']:
            if b.get('fase') is not None and b['fase'] >= nf:
                problemas.append((f'laminas[{i}]', 'Barra del cronograma apunta a una fase que no existe.'))
            if b['fin'] > len(l['semanas']):
                problemas.append((f'laminas[{i}]', 'Barra del cronograma se sale de las semanas.'))
        if l.get('nota') and renglones(l['nota'], ANCHO, 12) > 1:
            problemas.append((f'laminas[{i}].nota', 'La nota de tiempos no cabe en una línea. Deja solo aprobación y entrega.'))
    if tipo == 'muestra' and not l.get('notas'):
        problemas.append((f'laminas[{i}]', 'La muestra no lleva notas. Debajo van siempre los criterios comunes y la definición de cada perfil.'))
    if tipo == 'muestra':
        nombres = [f.get('nombre', '').lower() for f in C.get('fases', []) if f.get('nombre')]
        if not l.get('grupos') and any(n in c.lower() for c in l.get('columnas', []) for n in nombres):
            problemas.append((f'laminas[{i}].columnas', 'Las columnas de la muestra mezclan fase y corte. Agrupa por fase con «grupos» y deja en columnas solo los cortes (ciudad, edad).'))
        if any(f.get('participantes') == 'nuevos' for f in C.get('fases', [])[1:]) and not l.get('grupos') and nf > 1:
            problemas.append((f'laminas[{i}]', 'Hay fases con participantes nuevos y la muestra no se agrupa por fase con «grupos».'))
        for k, g in enumerate(l.get('grupos', [])):
            if not isinstance(g.get('fase'), int):
                problemas.append((f'laminas[{i}].grupos[{k}]', f'«fase» en grupos va como índice desde 0 (0, 1…), no «{g.get("fase")}».'))
            if not g.get('detalle'):
                problemas.append((f'laminas[{i}].grupos[{k}]', 'El grupo no dice cuántos participantes son ni qué hacen («16 participantes con diario y entrevista»).'))
        if l.get('grupos') and sum(g.get('columnas', 0) for g in l['grupos']) != len(l.get('columnas', [])):
            problemas.append((f'laminas[{i}].grupos', 'Los grupos de la muestra no suman el número de columnas.'))
        for f in l.get('filas', []):
            for c in f.get('celdas', []):
                if '·' in c:
                    problemas.append((f'laminas[{i}]', f'Celda de muestra con punto medio: «{c}». Escríbela en español: «6 en 1 sesión».'))
        edades = ' '.join(l['columnas'] + [f['nombre'] for f in l['filas']])
        if re.search(r'\b1[0-7]\b', edades) and not any('consentimiento' in n.lower() for n in l.get('notas', [])):
            problemas.append((f'laminas[{i}]', 'La muestra incluye menores y no menciona consentimiento de padres o tutores.'))
    if tipo == 'enfoque':
        for k, vs in enumerate(l.get('verbos', [])):
            for v in vs:
                if len(v.split()) < 2:
                    problemas.append((f'laminas[{i}].verbos[{k}]', f'«{v}» es un verbo suelto. Cada fase lleva frases cortas de verbo con objeto («Entrar a la cocina»).'))
    if tipo == 'detalle_fase':
        if nf > 1 and any(f.get('participantes') for f in C.get('fases', [])) and not l.get('quienes'):
            problemas.append((f'laminas[{i}]', 'El detalle de fase no dice quiénes participan («quienes»: «24 participantes nuevos»).'))
        for k, c in enumerate(l.get('como', [])):
            if renglones(c.get('texto', ''), 6.6, 11.5) > 2:
                problemas.append((f'laminas[{i}].como[{k}]', f'La descripción de «{c.get("titulo")}» pasa de 2 renglones. Acórtala.'))
    if tipo == 'detalle_fase' and not isinstance(l.get('fase'), int):
        problemas.append((f'laminas[{i}]', f'«fase» en detalle de fase va como índice desde 0 (0, 1…), no «{l.get("fase")}».'))
    elif tipo == 'detalle_fase' and l['fase'] >= nf:
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
        cierre = ' '.join(r if isinstance(r, str) else r.get('texto', '') for r in l.get('cierre', []))
        if re.search(r'\bpropon(emos|er)\b', cierre.lower()):
            problemas.append((f'laminas[{i}].cierre', 'El cierre del contexto adelanta el método. Dice qué necesitamos entender o resolver («Por eso necesitamos…»); la propuesta va en el enfoque.'))
        for ci, col in enumerate(l.get('columnas', [])):
            for pi, p in enumerate(col.get('puntos', [])):
                tx = (p.get('texto') if isinstance(p, dict) else p) or ''
                if re.match(r'(falta|necesitamos|hay que|queremos) (entender|saber|conocer|explorar|identificar)', tx.lower()):
                    problemas.append((f'laminas[{i}].columnas[{ci}].puntos[{pi}]', f'«{tx}» es un objetivo, no contexto. El contexto lleva datos del brief; si no los hay, se pregunta.'))
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
if 'muestra' in tipos and 'inversion' in tipos:
    a, b = tipos.index('muestra'), tipos.index('inversion')
    for k in range(a + 1, b):
        if tipos[k] != 'tiempos':
            problemas.append((f'laminas[{k}]', f'Lámina «{tipos[k]}» entre muestra e inversión. Lo que necesitamos del cliente, valor agregado o escenarios van después de la inversión.'))
for req in ('objetivos', 'inversion'):
    if req not in tipos:
        problemas.append(('laminas', f'Falta la lámina de {req}.'))

if problemas:
    for r, p in problemas:
        print(f'[{r}] {p}')
    sys.exit(1)
print('Sin problemas.')
