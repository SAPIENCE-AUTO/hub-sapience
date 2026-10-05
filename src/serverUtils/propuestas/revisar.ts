// Port a TypeScript de scripts/revisar.py de la skill sapience-propuestas.
// MISMAS reglas y MISMOS mensajes, en el mismo orden — la skill es la versión
// maestra y no se rediseña aquí. Cualquier cambio debe pasar
// server/scripts/test-propuestas.ts, que compara esta versión contra el
// revisar.py de la skill sobre el ejemplo, sobre contenidos con errores y sobre
// assets/prueba_victoria_con_errores.json (24 problemas exactos).
//
// Notas de fidelidad con Python (no son decisiones nuevas, son las mismas
// semánticas): \w y \b de Python 3 son Unicode, los de JS son ASCII — aquí se
// reescriben con \p{L}\p{N}_; `$` de Python también cierra antes de un \n
// final (de ahí `\n?$`); len() cuenta puntos de código, no unidades UTF-16.
import fs from 'node:fs';
import path from 'node:path';

export interface Problema { ruta: string; problema: string }

const PROHIBIDAS = ['completitud', 'operacionalizar', 'operacionaliza', 'trazabilidad', 'salida esperada',
  'elegibilidad', 'unidad de decisión', 'por cotizar', 'convencidos que', 'es percibido',
  'son percibidos', 'leverage', 'insightful'];
const LETRA = /^[A-ZÁÉÍÓÚ][a-záéíóúñ ]+ (pesos mexicanos|dólares)( \+ IVA)?\n?$/;
const ANCHO = 12.13;   // ancho útil de la lámina en pulgadas
const PRECIO = /^(MXN \$\d{1,3}(,\d{3})*\.\d{2}( \+ IVA)?|USD \$\d{1,3}(,\d{3})*\.\d{2})\n?$/;
const W = '[\\p{L}\\p{N}_]';
const NUM_CERO = /(?<![\d$,.])0[1-9](?![\d,.:])/;
const LETRAS_ESPACIADAS = new RegExp(`(?:(?<!${W})${W} ){5,}`, 'u');
const PREGUNTA_BINARIA = new RegExp(`(?<!${W})(en cuáles|cuándo|dónde) no(?!${W})`, 'u');
const ENFASIS_MAYUS = new RegExp(`(?<!${W})(NO|NUNCA|SOLO|SÓLO|SIN|SIEMPRE)(?!${W})`, 'u');
const PORQUE = new RegExp(`(?<!${W})porque(?!${W})`, 'u');
const EL_BRIEF = new RegExp(`(?<!${W})el brief(?!${W})`, 'u');
const CORCHETE_SUELTO = /<\s*\d+\s*>/;
const DOS_PUNTOS = new RegExp(`${W}:\\s`, 'u');
const NUM_UNIDAD = /\d+\s*\n\s*(g|ml|kg|min|años|%)/;
const INFINITIVO = /(ar|er|ir)\n?$/;
const MENOR = new RegExp(`(?<!${W})1[0-7](?!${W})`, 'u');
const CIFRA_VERBO_CUANTI = /^(medir|cuantificar|dimensionar)/;
const PROPONEMOS = new RegExp(`(?<!${W})propon(emos|er)(?!${W})`, 'u');
const CONTEXTO_OBJETIVO = /^(falta|necesitamos|hay que|queremos) (entender|saber|conocer|explorar|identificar)/;

const largo = (s: string) => [...s].length;
const pyStr = (v: unknown) => (v === undefined || v === null ? 'None' : String(v));
const pyList = (a: number[]) => `[${a.join(', ')}]`;

// Renglones palabra por palabra, igual que el constructor (anchos medidos con
// Montserrat: regular 0.54, negritas 0.55, mayúsculas en negritas 0.70). Se
// exporta para que encaje.ts mida igual.
export const K_REGULAR = 0.54, K_NEGRITAS = 0.55, K_MAYUS = 0.70;
export function renglonesTexto(t: unknown, w: number, sz: number, k: number): number {
  const maximo = (w - 0.05) * 72;
  let total = 0;
  for (const l of String(t).split('\n')) {
    let r = 1, ancho = 0;
    for (const p of l.split(/\s+/).filter(Boolean)) {
      const pw = largo(p) * k * sz, esp = ancho ? 0.28 * sz : 0;
      if (ancho && ancho + esp + pw > maximo) { r++; ancho = pw; } else ancho += esp + pw;
      while (ancho > maximo) { r++; ancho -= maximo; }
    }
    total += r;
  }
  return total;
}
export const renglonesB = (t: unknown, w: number, sz: number, mayus = false) => renglonesTexto(t, w, sz, mayus ? K_MAYUS : K_NEGRITAS);
export const renglones = (t: unknown, w: number, sz: number) => renglonesTexto(t, w, sz, K_REGULAR);

function* textos(obj: any, ruta = ''): Generator<[string, string]> {
  if (typeof obj === 'string') yield [ruta, obj];
  else if (Array.isArray(obj)) for (let i = 0; i < obj.length; i++) yield* textos(obj[i], `${ruta}[${i}]`);
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) yield* textos(v, ruta ? `${ruta}.${k}` : k);
  }
}

const SKILL = path.join(import.meta.dirname, 'skill');
function tamanoTitulo(estilo: string): number {
  try { return JSON.parse(fs.readFileSync(path.join(SKILL, 'assets', 'estilos', `estilo_${estilo}.json`), 'utf8')).TS; } catch { return 54; }
}

const unir = (arr: any[]) => arr.map(r => (typeof r === 'string' ? r : r?.texto ?? '')).join(' ');

export function revisarContenido(C: any): Problema[] {
  const problemas: Problema[] = [];
  const add = (ruta: string, problema: string) => problemas.push({ ruta, problema });

  for (const [ruta, t] of textos(C)) {
    if (['archivo', 'fuente', 'foto', 'estilo', 'portada', 'tipo', 'icono', 'acomodo', 'etapa'].some(s => ruta.endsWith(s)) || ruta.includes('fotos_portada')) continue;
    const low = t.toLowerCase();
    if (NUM_CERO.test(t)) add(ruta, `Numeración con cero a la izquierda: «${t}». Se cuenta 1, 2, 3.`);
    for (const p of PROHIBIDAS) if (low.includes(p)) add(ruta, `Expresión que no se usa: «${p}».`);
    if (low.split('realiza').length - 1 > 1) add(ruta, 'Más de un «realizar» en la misma frase.');
    if (LETRAS_ESPACIADAS.test(t)) add(ruta, 'Texto con letras espaciadas (versalitas espaciadas).');
    if (PREGUNTA_BINARIA.test(low) && !ruta.endsWith('nota') && !ruta.endsWith('notas')) {
      add(ruta, `Pregunta binaria o absoluta: «${t}». Se pregunta para entender desde el consumidor (cuándo la eligen y qué los lleva a dejarla fuera), no para clasificar.`);
    }
    if (ENFASIS_MAYUS.test(t) && !(t === t.toUpperCase() && t !== t.toLowerCase())) {
      add(ruta, `Palabra en mayúsculas para enfatizar: «${t}». Los criterios van en minúsculas.`);
    }
    if (EL_BRIEF.test(low)) add(ruta, 'Menciona «el brief». La propuesta le habla al cliente; se dice lo que el cliente nos compartió o se plantea directo.');
    if (CORCHETE_SUELTO.test(t)) add(ruta, `Número suelto entre corchetes angulares: «${t}». La aclaración operativa lleva texto: «<6 participantes cada una>».`);
    if (DOS_PUNTOS.test(t)) add(ruta, `Dos puntos como bisagra: «${t}». Se reescribe con conector (porque, para, en el que) o se parte en dos oraciones.`);
    if (NUM_UNIDAD.test(t)) add(ruta, 'Número separado de su unidad por un salto de línea.');
  }

  const fases: any[] = C.fases ?? [];
  const nf = fases.length;
  if (C.cliente && C.proyecto && String(C.proyecto).toLowerCase().includes(String(C.cliente).toLowerCase())) {
    add('proyecto', `El nombre del proyecto «${C.proyecto}» lleva el cliente; la portada ya pone «para ${C.cliente}» y sale repetido.`);
  }
  const TS = tamanoTitulo(C.estilo ?? 'A');
  const ILU = !!C.ilustraciones;
  const laminas: any[] = C.laminas ?? [];
  laminas.forEach((l, i) => {
    const tipo = l.tipo;
    if (l.titulo && renglonesB(String(l.titulo).toUpperCase(), ANCHO, TS, true) > 1) {
      add(`laminas[${i}].titulo`, `El título de la lámina «${l.titulo}» no cabe en un renglón. Acórtalo.`);
    }
    if (tipo === 'contexto' && l.entrada) {
      if (renglonesB(unir(l.entrada), ANCHO, 15) > 3) add(`laminas[${i}].entrada`, 'La entrada del contexto pasa de 3 renglones. Déjala en lo esencial.');
    }
    if (tipo === 'contexto' && l.columnas) {
      const n = l.columnas.length, w = (ANCHO - 0.25 * (n - 1)) / n;
      const rs: number[] = l.columnas.map((c: any) => renglonesB(String(c.titulo ?? '').toUpperCase(), w - (c.icono && !ILU ? 0.7 : 0.2), 14, true));
      if (Math.max(...rs) > 2) add(`laminas[${i}].columnas`, 'Un encabezado de color del contexto pasa de 2 renglones. Acórtalo.');
      else if (new Set(rs).size > 1) add(`laminas[${i}].columnas`, `Los encabezados de color ocupan distinto número de renglones (${pyList(rs)}). Todos van en 1 o todos en 2.`);
    }
    if (tipo === 'objetivos' && l.especificos) {
      const E: any[] = l.especificos, n = E.length, pf = n <= 3 ? n : (n === 4 ? 2 : 3);
      const w = (ANCHO - 0.2 * (pf - 1)) / pf - 0.4 - (ILU ? 0.85 : 0), z = n <= 3 ? 13 : 12;
      const rs = E.map(e => renglonesB(e.titulo ?? '', w, z + 2));
      if (Math.max(...rs) > 2) add(`laminas[${i}].especificos`, `Hay títulos de objetivos de más de 2 renglones (${pyList(rs)}). Acórtalos.`);
      else if (new Set(rs).size > 1) add(`laminas[${i}].especificos`, `Los títulos de los objetivos ocupan distinto número de renglones (${pyList(rs)}). Todos van en 1 o todos en 2.`);
    }
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
        else if (!LETRA.test(pq.letra)) add(`laminas[${i}].paquete.letra`, `Cantidad en letra con formato distinto: «${pq.letra}». Va así y sin agregados: «Seiscientos diez mil pesos mexicanos + IVA».`);
      }
      const partidas: any[] = l.partidas ?? [];
      if (partidas.length) {
        const w = (ANCHO - 0.18 * (partidas.length - 1)) / partidas.length;
        partidas.forEach((pa, k) => {
          const nombre = pa.fase < nf ? (fases[pa.fase]?.nombre || '') : '';
          if (nombre && pa.descripcion.toLowerCase().startsWith(nombre.toLowerCase())) add(`laminas[${i}].partidas[${k}]`, `La descripción repite el nombre de la fase «${nombre}», que ya va en la píldora.`);
          if (renglones(pa.descripcion, w, 13) > 2) add(`laminas[${i}].partidas[${k}]`, 'La descripción de la partida no cabe en dos líneas. Acórtala.');
        });
      }
      if (l.nota && renglones(l.nota, ANCHO, 10) > 1) add(`laminas[${i}].nota`, 'La nota de inversión no cabe en una línea. Acórtala.');
    }
    if (tipo === 'tiempos') {
      for (const b of l.barras) {
        if (b.fase !== undefined && b.fase !== null && b.fase >= nf) add(`laminas[${i}]`, 'Barra del cronograma apunta a una fase que no existe.');
        if (b.fin > l.semanas.length) add(`laminas[${i}]`, 'Barra del cronograma se sale de las semanas.');
      }
      if (l.nota && renglones(l.nota, ANCHO, 12) > 1) add(`laminas[${i}].nota`, 'La nota de tiempos no cabe en una línea. Deja solo aprobación y entrega.');
    }
    if (tipo === 'muestra' && !(l.notas && l.notas.length)) {
      add(`laminas[${i}]`, 'La muestra no lleva notas. Debajo van siempre los criterios comunes y la definición de cada perfil.');
    }
    if (tipo === 'muestra') {
      const nombres: string[] = fases.map(f => String(f.nombre ?? '').toLowerCase()).filter(Boolean);
      const grupos = l.grupos && l.grupos.length ? l.grupos : null;
      if (!grupos && (l.columnas ?? []).some((c: string) => nombres.some(n => c.toLowerCase().includes(n)))) {
        add(`laminas[${i}].columnas`, 'Las columnas de la muestra mezclan fase y corte. Agrupa por fase con «grupos» y deja en columnas solo los cortes (ciudad, edad).');
      }
      if (fases.slice(1).some(f => f.participantes === 'nuevos') && !grupos && nf > 1) {
        add(`laminas[${i}]`, 'Hay fases con participantes nuevos y la muestra no se agrupa por fase con «grupos».');
      }
      (l.grupos ?? []).forEach((g: any, k: number) => {
        if (!Number.isInteger(g?.fase)) add(`laminas[${i}].grupos[${k}]`, `«fase» en grupos va como índice desde 0 (0, 1…), no «${pyStr(g?.fase)}».`);
        if (!g?.detalle) add(`laminas[${i}].grupos[${k}]`, 'El grupo no dice cuántos participantes son ni qué hacen («16 participantes con diario y entrevista»).');
      });
      if (grupos && grupos.reduce((a: number, g: any) => a + (g.columnas ?? 0), 0) !== (l.columnas ?? []).length) {
        add(`laminas[${i}].grupos`, 'Los grupos de la muestra no suman el número de columnas.');
      }
      if (fases.some(f => f.participantes) && PORQUE.test(String(l.bisagra || '').toLowerCase())) {
        add(`laminas[${i}].bisagra`, 'La bisagra de la muestra explica la decisión de participantes. El porqué va en el enfoque; aquí solo se dice con quién vamos a hablar.');
      }
      (l.notas ?? []).forEach((n: any, k: number) => {
        if ((String(n).match(/</g) ?? []).length > 1) add(`laminas[${i}].notas[${k}]`, 'La nota trae más de una definición. Va una definición por renglón.');
      });
      for (const f of l.filas ?? []) for (const c of f.celdas ?? []) {
        if (c.includes('·')) add(`laminas[${i}]`, `Celda de muestra con punto medio: «${c}». Escríbela en español: «6 en 1 sesión».`);
      }
      const edades = [...l.columnas, ...l.filas.map((f: any) => f.nombre)].join(' ');
      if (MENOR.test(edades) && !(l.notas ?? []).some((n: string) => n.toLowerCase().includes('consentimiento'))) {
        add(`laminas[${i}]`, 'La muestra incluye menores y no menciona consentimiento de padres o tutores.');
      }
    }
    if (tipo === 'enfoque') {
      (l.verbos ?? []).forEach((vs: string[], k: number) => {
        for (const v of vs) if (v.split(/\s+/).filter(Boolean).length < 2) add(`laminas[${i}].verbos[${k}]`, `«${v}» es un verbo suelto. Cada fase lleva frases cortas de verbo con objeto («Entrar a la cocina»).`);
      });
    }
    if (tipo === 'detalle_fase') {
      if (nf > 1 && fases.some(f => f.participantes) && !l.quienes) add(`laminas[${i}]`, 'El detalle de fase no dice quiénes participan («quienes»: «24 participantes nuevos»).');
      (l.como ?? []).forEach((c: any, k: number) => {
        if (renglones(c.texto ?? '', 6.6, 11.5) > 2) add(`laminas[${i}].como[${k}]`, `La descripción de «${pyStr(c.titulo)}» pasa de 2 renglones. Acórtala.`);
      });
    }
    if (tipo === 'detalle_fase' && !Number.isInteger(l.fase)) add(`laminas[${i}]`, `«fase» en detalle de fase va como índice desde 0 (0, 1…), no «${pyStr(l.fase)}».`);
    else if (tipo === 'detalle_fase' && l.fase >= nf) add(`laminas[${i}]`, 'Detalle de fase apunta a una fase que no existe.');

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
      const cierre = unir(l.cierre ?? []);
      if (PROPONEMOS.test(cierre.toLowerCase())) {
        add(`laminas[${i}].cierre`, 'El cierre del contexto adelanta el método. Dice qué necesitamos entender o resolver («Por eso necesitamos…»); la propuesta va en el enfoque.');
      }
      (l.columnas ?? []).forEach((col: any, ci: number) => {
        (col.puntos ?? []).forEach((p: any, pi: number) => {
          const tx = (p && typeof p === 'object' && !Array.isArray(p) ? p.texto : p) || '';
          if (CONTEXTO_OBJETIVO.test(String(tx).toLowerCase())) add(`laminas[${i}].columnas[${ci}].puntos[${pi}]`, `«${tx}» es un objetivo, no contexto. El contexto lleva datos del brief; si no los hay, se pregunta.`);
        });
      });
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
  if (tipos.includes('muestra') && tipos.includes('inversion')) {
    const a = tipos.indexOf('muestra'), b = tipos.indexOf('inversion');
    for (let k = a + 1; k < b; k++) {
      if (tipos[k] !== 'tiempos') add(`laminas[${k}]`, `Lámina «${tipos[k]}» entre muestra e inversión. Lo que necesitamos del cliente, valor agregado o escenarios van después de la inversión.`);
    }
  }
  for (const req of ['objetivos', 'inversion']) if (!tipos.includes(req)) add('laminas', `Falta la lámina de ${req}.`);

  return problemas;
}
