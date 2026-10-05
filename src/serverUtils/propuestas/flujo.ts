// Las 4 llamadas a Claude del spec §8 + el bucle de corrección con el revisor.
// Los textos de instrucción son los del spec, sin reescribir.
import { z } from 'zod';
import { llamarJSON, type Contenido as ContenidoMsg } from './claude';
import { Esqueleto, PaletasPropuestas, Contenido, type EsqueletoT } from './esquemas';
import type { Problema } from './revisar';
import { revisarTodo } from './revision';
import { tiemposALamina, precargarAnalisis } from './tiempos';

export interface BriefInput { texto?: string | null; pdfBase64?: string | null }
const bloqueBrief = (b: BriefInput): any[] => [
  ...(b.pdfBase64 ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b.pdfBase64 } }] : []),
  { type: 'text', text: `BRIEF:\n${b.texto?.trim() || (b.pdfBase64 ? '(ver el documento PDF adjunto)' : '(sin brief)')}` },
];

// Llamada 1
export async function proponerEsqueleto(args: { brief: BriefInput; notas?: string | null; metodo?: string | null; respuestas?: Record<string, string> | null; cliente?: string }): Promise<EsqueletoT> {
  const resp = args.respuestas && Object.keys(args.respuestas).length
    ? `\nRESPUESTAS A PREGUNTAS PENDIENTES:\n${Object.entries(args.respuestas).map(([q, a]) => `- ${q}\n  ${a}`).join('\n')}` : '';
  const usuario: ContenidoMsg = [
    ...bloqueBrief(args.brief),
    { type: 'text', text: `${args.cliente ? `CLIENTE: ${args.cliente}\n` : ''}NOTAS DE LA PERSONA: ${args.notas?.trim() || '(ninguna)'}\nMÉTODO INDICADO: ${args.metodo || '(a criterio)'}${resp}

Lee el brief y propone el esqueleto de la propuesta.

Si el brief no trae datos de contexto (situación del negocio, la marca, la categoría o el consumidor) suficientes para al menos dos bloques con sustancia, pregúntalos en "preguntas". El target y lo que falta investigar no cuentan como contexto. Para cada fase después de la primera, decide si trabaja con los mismos participantes de la fase anterior o con nuevos, y explica por qué en una frase. La primera fase va siempre en nuevos. Ordena el índice así: contexto, postura si aplica, objetivos, enfoque, detalle de fase, entregables, muestra, tiempos, inversión y, después de la inversión, lo que necesitamos del cliente, valor agregado, escenarios o siguiente paso; cierre al final.

Responde solo con JSON con este esquema:
{
  "resumen_brief": "2 a 4 oraciones con lo que pide el cliente, solo con lo que dice el brief",
  "preguntas": ["lo que falta y cambia la propuesta; vacío si no falta nada"],
  "metodo": "cualitativo | cuantitativo | mixto",
  "fases": [{"nombre": "", "etapa": null, "icono": "nombre de Feather Icon, ej. FiUsers", "goal": "", "tecnica": "", "muestra": "", "participantes": "nuevos | mismos", "razon_participantes": "una frase"}],
  "indice": [{"tipo": "contexto | punto_partida | objetivos | enfoque | detalle_fase | muestra | entregables | tiempos | inversion | seccion | cierre", "titulo": "", "resumen": "una línea de lo que dirá", "incluir": true, "razon": "por qué se incluye o se deja fuera"}],
  "precio": {"modo": "unico | por_fase", "partidas": [{"fase": 0, "descripcion": "", "precio": "MXN $000,000.00"}], "total": "MXN $000,000.00 + IVA", "letra": ""},
  "tiempos": {"fecha_inicio": "AAAA-MM-DD SOLO si el brief o la persona dan un día exacto; si dicen un mes o «mediados de…», null (la lámina mostrará Semana 1, Semana 2…)", "actividades": [{"nombre": "Reclutamiento", "fase": null, "inicio_semana": 0, "duracion_semanas": 1}]},
  "diseno": {"estilo": "A-G", "portada": "id de portadas.json", "razon": "una frase", "ilustraciones": false}
}

Cronograma: el análisis de cada fase dura mínimo 1 semana. Máximo 9 semanas en total y máximo 8 actividades, cada nombre de actividad en máximo 24 caracteres («Diario online», «Sesiones grupales»). No inventes fechas: ver «fecha_inicio».` },
  ];
  const esq = await llamarJSON({ usuario, esquema: Esqueleto, maxTokens: 16000 });
  // El análisis de una fase no baja de 1 semana (precarga 1.5, la persona lo ajusta en pantalla).
  // La primera fase siempre es de participantes nuevos.
  const fases = esq.fases.map((f, i) => (i === 0 ? { ...f, participantes: 'nuevos' as const } : f));
  return { ...esq, fases, tiempos: precargarAnalisis(esq.tiempos) };
}

// Llamada 4
export async function proponerPaletas(args: { tono: string; coloresMarca?: string; clienteYCategoria: string }) {
  const usuario = `Propón tres paletas para esta propuesta según el tono indicado y la categoría del cliente. Acentos saturados, nunca paletas apagadas. Responde solo con JSON:
[{"nombre": "", "tono": "", "acento": "HEX sin #", "secundario": "HEX", "fases": ["HEX", "HEX", "HEX", "HEX"]}]
TONO: ${args.tono}
COLORES DE MARCA: ${args.coloresMarca?.trim() || ''}
CLIENTE Y CATEGORÍA: ${args.clienteYCategoria}`;
  return llamarJSON({ usuario, esquema: PaletasPropuestas, maxTokens: 2000 });
}

// Llamada 2
export async function escribirContenido(args: { brief: BriefInput; notas?: string | null; esqueleto: EsqueletoT; archivosPorSlot: Record<string, string> }): Promise<any> {
  const usuario: ContenidoMsg = [
    ...bloqueBrief(args.brief),
    { type: 'text', text: `FECHA DE HOY (para el campo "fecha" del contenido): ${new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' })}
NOTAS DE LA PERSONA: ${args.notas?.trim() || '(ninguna)'}
ESQUELETO APROBADO:
${JSON.stringify(args.esqueleto)}
ARCHIVOS SUBIDOS POR SLOT (usa estas rutas tal cual donde corresponda):
${JSON.stringify(args.archivosPorSlot)}

Escribe el contenido completo de la propuesta con base en el esqueleto aprobado. La decisión de participantes de cada fase se ve en la propuesta: llena «quienes» en cada detalle de fase y «detalle» en cada grupo de la muestra. Di el porqué una sola vez, en la bisagra de la muestra o en el detalle de la fase, y no lo repitas en las notas de la muestra, que quedan solo para los criterios de reclutamiento y la definición de cada perfil. Respeta las fases, el índice (solo las láminas con incluir: true, en ese orden), la muestra, el precio y los tiempos tal como vienen. Responde solo con JSON en el formato del archivo de contenido descrito en references/estructura.md (el mismo de assets/ejemplo_contenido.json), con estilo, portada, paleta, ilustraciones y rutas de archivos tomados de "diseno".` },
  ];
  return llamarJSON({ usuario, esquema: Contenido, maxTokens: 32000 });
}

// Llamada 3
export async function corregirContenido(contenido: any, problemas: Problema[]): Promise<any> {
  const lista = problemas.map(p => `[${p.ruta}] ${p.problema}`).join('\n');
  const usuario = `El revisor de Sapience marcó estos problemas en el contenido. Corrígelos sin inventar información y sin cambiar lo que no está marcado. Responde solo con el contenido completo corregido en JSON.
PROBLEMAS: ${lista}
CONTENIDO: ${JSON.stringify(contenido)}`;
  return llamarJSON({ usuario, esquema: Contenido, maxTokens: 32000 });
}

// Lo que el esqueleto ya decidió NO se le deja a Claude: estilo, portada,
// paleta, ilustraciones, fotos de portada y la lámina de tiempos se fijan aquí
// de forma determinista (el spec dice que se toman de "diseno" y que los
// tiempos se convierten con una función, no se reescriben).
const txtParte = (p: any): string => (typeof p === 'string' ? p : p?.texto ?? '');
export function separarPartes(partes: any[]): any[] {
  return partes.map((p, i) => {
    if (i === 0) return p;
    const antes = txtParte(partes[i - 1]), t = txtParte(p);
    if (!antes || !t || /\s$/.test(antes) || /^\s/.test(t)) return p;
    // palabra pegada con la siguiente: termina en letra, cifra o puntuación y la otra empieza con letra, cifra o ¿¡
    if (!/[\p{L}\p{N}.!?:;,)»”]$/u.test(antes) || !/^[\p{L}\p{N}¿¡«“(]/u.test(t)) return p;
    return typeof p === 'string' ? ' ' + p : { ...p, texto: ' ' + p.texto };
  });
}

export interface ArchivoSlot { tipo: string; slot?: string | null; path: string }

export function fijarDesdeEsqueleto(contenido: any, esq: EsqueletoT, rutasFotosPortada: string[], archivos: ArchivoSlot[] = []): { contenido: any; avisos: string[] } {
  const c = JSON.parse(JSON.stringify(contenido));
  const avisos: string[] = [];
  c.estilo = esq.diseno.estilo;
  // `grupos` de la muestra: el constructor espera `fase` como índice (0, 1…); si Claude escribe el nombre
  // de la fase («Exploring») se convierte aquí, porque si no el constructor truena.
  if (Array.isArray(c.fases)) {
    const nombres: string[] = c.fases.map((f: any) => String(f?.nombre ?? '').trim().toLowerCase());
    for (const l of c.laminas) if (l.tipo === 'muestra' && Array.isArray(l.grupos)) {
      l.grupos = l.grupos.map((g: any) => {
        if (typeof g?.fase === 'number') return g;
        const k = nombres.indexOf(String(g?.fase ?? '').trim().toLowerCase());
        return k >= 0 ? { ...g, fase: k } : (/^\d+$/.test(String(g?.fase)) ? { ...g, fase: Number(g.fase) } : g);
      });
    }
  }
  // Participantes por fase: lo decide el esqueleto; el revisor y la muestra lo usan.
  if (Array.isArray(c.fases)) c.fases = c.fases.map((f: any, i: number) => (esq.fases[i] ? { ...f, participantes: i === 0 ? 'nuevos' : esq.fases[i].participantes } : f));
  c.portada = esq.diseno.portada;
  if (esq.diseno.paleta) c.paleta = esq.diseno.paleta; else delete c.paleta;
  c.ilustraciones = !!esq.diseno.ilustraciones;
  c.fotos_portada = rutasFotosPortada;
  const incluyeTiempos = esq.indice.some(i => i.tipo === 'tiempos' && i.incluir);
  if (incluyeTiempos && esq.tiempos.actividades.length) {
    const idx = c.laminas.findIndex((l: any) => l.tipo === 'tiempos');
    const previa = idx >= 0 ? c.laminas[idx] : null;
    const nueva = tiemposALamina(esq.tiempos, previa?.titulo);
    if (previa?.bisagra) nueva.bisagra = previa.bisagra;
    if (previa?.nota) nueva.nota = previa.nota;
    if (idx >= 0) c.laminas[idx] = nueva;
    else {
      const k = c.laminas.findIndex((l: any) => l.tipo === 'inversion');
      c.laminas.splice(k >= 0 ? k : c.laminas.length, 0, nueva);
    }
  }
  // Archivos por slot (spec §6/§4): se colocan aquí de forma determinista en vez
  // de depender de que Claude copie bien las rutas.
  const lamina = (tipo: string) => c.laminas.find((l: any) => l.tipo === tipo);
  const idx = (slot?: string | null) => Number(slot?.match(/\.(\d+)$/)?.[1] ?? -1);
  for (const a of archivos) {
    const i = idx(a.slot);
    if (a.tipo === 'ilustracion' && a.slot) {
      if (a.slot.startsWith('contexto.') && lamina('contexto')?.columnas?.[i]) lamina('contexto').columnas[i].ilustracion = a.path;
      else if (a.slot.startsWith('objetivos.') && lamina('objetivos')?.especificos?.[i]) lamina('objetivos').especificos[i].ilustracion = a.path;
      else if (a.slot.startsWith('enfoque.') && lamina('enfoque') && i >= 0) {
        const l = lamina('enfoque'); l.ilustraciones = Array.from({ length: Math.max(esq.fases.length, i + 1) }, (_, k) => l.ilustraciones?.[k] ?? null); l.ilustraciones[i] = a.path;
      } else if (a.slot === 'punto_partida' && lamina('punto_partida')) lamina('punto_partida').ilustracion = a.path;
    } else if (a.tipo === 'entregable' && lamina('entregables')?.imagenes?.[i]) {
      lamina('entregables').imagenes[i].archivo = a.path;
    } else if (a.tipo === 'foto_fase') {
      const l = c.laminas.find((x: any) => x.tipo === 'detalle_fase' && x.fase === i);
      if (l) l.foto = a.path;
    }
  }
  // Skill (paso 3): «entregables fuera si no hay capturas». Claude a veces deja
  // la lámina con archivo vacío; el constructor no puede dibujar eso.
  // Texto corrido con partes en negritas («entrada», «cierre», «insight»): si Claude
  // pega dos partes sin espacio («recompra.Con esa mirada») se agrega el espacio.
  for (const l of c.laminas) for (const k of ['entrada', 'cierre', 'insight']) if (Array.isArray(l[k])) l[k] = separarPartes(l[k]);
  const antes = c.laminas.length;
  c.laminas = c.laminas.filter((l: any) => {
    if (l.tipo !== 'entregables') return true;
    l.imagenes = (l.imagenes ?? []).filter((im: any) => im?.archivo);
    return l.imagenes.length > 0;
  });
  if (c.laminas.length < antes) avisos.push('Se omitió la lámina de ejemplos de entregables porque no se subieron capturas.');
  return { contenido: c, avisos };
}

export interface ResultadoContenido { contenido: any; problemas: Problema[]; vueltas: number; avisos: string[] }

// Spec §5/§8: revisor → si marca problemas, Claude corrige; máximo 2 vueltas.
export async function escribirYRevisar(args: {
  brief: BriefInput; notas?: string | null; esqueleto: EsqueletoT; archivos: ArchivoSlot[];
  progreso?: (paso: string) => void;
}): Promise<ResultadoContenido> {
  args.progreso?.('Escribiendo la propuesta…');
  // fotos de portada en el orden de los huecos: slots FOTO_1, FOTO_2, …
  const rutasFotosPortada = args.archivos.filter(a => a.tipo === 'foto_portada')
    .sort((a, b) => Number(a.slot?.match(/\d+/)?.[0] ?? 0) - Number(b.slot?.match(/\d+/)?.[0] ?? 0)).map(a => a.path);
  const archivosPorSlot = Object.fromEntries(args.archivos.map(a => [`${a.tipo}:${a.slot}`, a.path]));
  let fijado = fijarDesdeEsqueleto(await escribirContenido({ ...args, archivosPorSlot }), args.esqueleto, rutasFotosPortada, args.archivos);
  let contenido = fijado.contenido;
  let problemas = revisarTodo(contenido);
  let vueltas = 0;
  while (problemas.length && vueltas < 2) {
    vueltas++;
    args.progreso?.(`Corrigiendo ${problemas.length} problema(s) del revisor (vuelta ${vueltas} de 2)…`);
    fijado = fijarDesdeEsqueleto(await corregirContenido(contenido, problemas), args.esqueleto, rutasFotosPortada, args.archivos);
    contenido = fijado.contenido;
    problemas = revisarTodo(contenido);
  }
  return { contenido, problemas, vueltas, avisos: fijado.avisos };
}

export { z };
