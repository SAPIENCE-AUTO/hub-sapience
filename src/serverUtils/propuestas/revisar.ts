// Port a TypeScript de scripts/revisar.py de la skill sapience-propuestas.
// MISMAS reglas y MISMOS mensajes, en el mismo orden — la skill ya está
// validada con propuestas reales y no se rediseña. Cualquier cambio aquí debe
// pasar server/scripts/test-propuestas.ts, que compara esta versión contra el
// revisar.py original sobre el ejemplo y sobre contenidos con errores.
//
// Notas de fidelidad con Python (no son decisiones nuevas, son las mismas
// semánticas): \w y \b de Python 3 son Unicode, los de JS son ASCII — aquí se
// reescriben con \p{L}\p{N}_; `$` de Python también cierra antes de un \n
// final (de ahí `\n?$`); len() cuenta puntos de código, no unidades UTF-16.

export interface Problema { ruta: string; problema: string }

const PROHIBIDAS = ['completitud', 'operacionalizar', 'operacionaliza', 'trazabilidad', 'salida esperada',
  'elegibilidad', 'unidad de decisión', 'por cotizar', 'convencidos que', 'es percibido',
  'son percibidos', 'leverage', 'insightful'];
const PRECIO = /^(MXN \$\d{1,3}(,\d{3})*\.\d{2}( \+ IVA)?|USD \$\d{1,3}(,\d{3})*\.\d{2})\n?$/;
const W = '[\\p{L}\\p{N}_]';
const NUM_CERO = /(?<![\d$,.])0[1-9](?![\d,.:])/;
const LETRAS_ESPACIADAS = new RegExp(`(?:(?<!${W})${W} ){5,}`, 'u');
const DOS_PUNTOS = new RegExp(`${W}:\\s`, 'u');
const NUM_UNIDAD = /\d+\s*\n\s*(g|ml|kg|min|años|%)/;
const INFINITIVO = /(ar|er|ir)\n?$/;
const MENOR = new RegExp(`(?<!${W})1[0-7](?!${W})`, 'u');
const CIFRA_VERBO_CUANTI = /^(medir|cuantificar|dimensionar)/;

const largo = (s: string) => [...s].length;
const pyStr = (v: unknown) => (v === undefined || v === null ? 'None' : String(v));
const pyList = (a: number[]) => `[${a.join(', ')}]`;

function* textos(obj: any, ruta = ''): Generator<[string, string]> {
  if (typeof obj === 'string') yield [ruta, obj];
  else if (Array.isArray(obj)) for (let i = 0; i < obj.length; i++) yield* textos(obj[i], `${ruta}[${i}]`);
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) yield* textos(v, ruta ? `${ruta}.${k}` : k);
  }
}

export function revisarContenido(C: any): Problema[] {
  const problemas: Problema[] = [];
  const add = (ruta: string, problema: string) => problemas.push({ ruta, problema });

  for (const [ruta, t] of textos(C)) {
    if (['archivo', 'fuente', 'foto', 'estilo', 'portada', 'tipo', 'icono', 'acomodo'].some(s => ruta.endsWith(s)) || ruta.includes('fotos_portada')) continue;
    const low = t.toLowerCase();
    if (NUM_CERO.test(t)) add(ruta, `Numeración con cero a la izquierda: «${t}». Se cuenta 1, 2, 3.`);
    for (const p of PROHIBIDAS) if (low.includes(p)) add(ruta, `Expresión que no se usa: «${p}».`);
    if (low.split('realiza').length - 1 > 1) add(ruta, 'Más de un «realizar» en la misma frase.');
    if (LETRAS_ESPACIADAS.test(t)) add(ruta, 'Texto con letras espaciadas (versalitas espaciadas).');
    if ((ruta.endsWith('bisagra') || ruta.endsWith('titulo')) && DOS_PUNTOS.test(t)) add(ruta, `Dos puntos como bisagra: «${t}».`);
    if (NUM_UNIDAD.test(t)) add(ruta, 'Número separado de su unidad por un salto de línea.');
  }

  const nf = (C.fases ?? []).length;
  const laminas: any[] = C.laminas ?? [];
  laminas.forEach((l, i) => {
    const tipo = l.tipo;
    if (tipo === 'inversion') {
      for (const pa of l.partidas ?? []) {
        if (!(PRECIO.test(pa.precio) || pa.precio.toLowerCase().startsWith('sin costo') || pa.precio.toLowerCase().startsWith('incluido'))) {
          add(`laminas[${i}]`, `Precio con formato distinto al de Sapience: «${pa.precio}».`);
        }
        if (pa.fase >= nf) add(`laminas[${i}]`, 'Partida apunta a una fase que no existe.');
      }
      const pq = l.paquete;
      if (!pq) add(`laminas[${i}]`, 'La inversión no tiene precio final.');
      else {
        if (!PRECIO.test(pq.precio)) add(`laminas[${i}]`, `Precio final con formato distinto: «${pq.precio}».`);
        if (!pq.letra) add(`laminas[${i}]`, 'Falta la cantidad en letra.');
      }
    }
    if (tipo === 'tiempos') {
      for (const b of l.barras) {
        if (b.fase !== undefined && b.fase !== null && b.fase >= nf) add(`laminas[${i}]`, 'Barra del cronograma apunta a una fase que no existe.');
        if (b.fin > l.semanas.length) add(`laminas[${i}]`, 'Barra del cronograma se sale de las semanas.');
      }
    }
    if (tipo === 'muestra') {
      const edades = [...l.columnas, ...l.filas.map((f: any) => f.nombre)].join(' ');
      if (MENOR.test(edades) && !(l.notas ?? []).some((n: string) => n.toLowerCase().includes('consentimiento'))) {
        add(`laminas[${i}]`, 'La muestra incluye menores y no menciona consentimiento de padres o tutores.');
      }
    }
    if (tipo === 'detalle_fase' && l.fase >= nf) add(`laminas[${i}]`, 'Detalle de fase apunta a una fase que no existe.');

    if (tipo === 'objetivos') {
      const g0 = (l.general || ' ').split(' ')[0].toLowerCase();
      if (l.general && !INFINITIVO.test(g0)) add(`laminas[${i}]`, 'El objetivo general empieza con verbo en infinitivo.');
      if (!l.general) add(`laminas[${i}]`, 'Falta el objetivo general.');
      const es: any[] = l.especificos ?? [];
      if (!(es.length >= 2 && es.length <= 6)) add(`laminas[${i}]`, `Los objetivos específicos deben ser entre 2 y 6; hay ${es.length}.`);
      es.forEach((e, k) => {
        const t0 = (e.titulo || '').split(' ')[0].toLowerCase();
        if (!INFINITIVO.test(t0)) {
          add(`laminas[${i}].especificos[${k}]`, `El objetivo específico «${pyStr(e.titulo)}» es un tema, no un objetivo. Empieza con verbo en infinitivo (entender, explorar, identificar, co-crear, evaluar).`);
        }
        if (CIFRA_VERBO_CUANTI.test(t0) && C.metodo === 'cualitativo') add(`laminas[${i}].especificos[${k}]`, 'Verbo cuantitativo en un estudio cualitativo.');
        const desagregado = (e.puntos && e.puntos.length) || (e.preguntas && e.preguntas.length) || e.texto;
        if (!e.titulo || !desagregado) add(`laminas[${i}].especificos[${k}]`, 'Cada objetivo específico lleva título y su desagregado (puntos, preguntas o texto).');
      });
    }
    if (tipo === 'contexto') {
      (l.columnas ?? []).forEach((col: any, ci: number) => {
        (col.puntos ?? []).forEach((p: any, pi: number) => {
          const f = p && typeof p === 'object' && !Array.isArray(p) ? p.fuente : null;
          if (!['brief', 'persona', 'hipotesis'].includes(f)) {
            add(`laminas[${i}].columnas[${ci}].puntos[${pi}]`, 'Afirmación de contexto sin fuente. Cada punto lleva fuente: brief, persona (lo dijo quien pide la propuesta) o hipotesis (y entonces se redacta como hipótesis).');
          }
        });
      });
    }

    // cajas de una misma fila: mismo número de puntos y largo parecido
    let grupos: [string, any[][]][] = [];
    const lista = (x: any) => (x && x.length ? x : null);
    if (tipo === 'contexto') grupos = [['columnas', (l.columnas ?? []).map((c: any) => lista(c.puntos) ?? [c.texto ?? ''])]];
    if (tipo === 'objetivos') grupos = [['especificos', (l.especificos ?? []).map((e: any) => lista(e.puntos) ?? lista(e.preguntas) ?? [e.texto ?? ''])]];
    if (tipo === 'seccion' && l.columnas && l.columnas.length) grupos = [['columnas', l.columnas.map((c: any) => c.puntos ?? [])]];
    if (tipo === 'punto_partida') grupos = [['bloques', (l.bloques ?? []).map((b: any) => [b.texto ?? ''])]];
    for (const [nombre, listas] of grupos) {
      if (listas.length < 2) continue;
      const cuentas = new Set(listas.map(x => x.length));
      if (cuentas.size > 1) {
        add(`laminas[${i}].${nombre}`, `Las cajas de la misma fila tienen distinto número de puntos (${pyList(listas.map(x => x.length).sort((a, b) => a - b))}). Deben llevar los mismos.`);
      }
      const largos = listas.map(x => x.reduce((s, p) => s + largo(typeof p === 'object' && p !== null && !Array.isArray(p) ? p.texto : p), 0));
      const m = largos.reduce((a, b) => a + b, 0) / largos.length;
      if (m && (Math.max(...largos) > 1.45 * m || Math.min(...largos) < 0.6 * m)) {
        add(`laminas[${i}].${nombre}`, `Las cajas de la misma fila tienen textos de largo muy distinto (${pyList(largos)} caracteres). Empáralos para que se vean uniformes.`);
      }
    }
  });

  const tipos = laminas.map(l => l.tipo);
  for (const req of ['objetivos', 'inversion']) if (!tipos.includes(req)) add('laminas', `Falta la lámina de ${req}.`);

  return problemas;
}
