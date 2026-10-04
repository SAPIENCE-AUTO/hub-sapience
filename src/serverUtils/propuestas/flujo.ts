// Las 4 llamadas a Claude del spec §8 + el bucle de corrección con el revisor.
// Los textos de instrucción son los del spec, sin reescribir.
import { z } from 'zod';
import { llamarJSON, type Contenido as ContenidoMsg } from './claude';
import { Esqueleto, PaletasPropuestas, Contenido, type EsqueletoT } from './esquemas';
import { revisarContenido, type Problema } from './revisar';
import { tiemposALamina } from './tiempos';

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

Lee el brief y propone el esqueleto de la propuesta. Responde solo con JSON con este esquema:
{
  "resumen_brief": "2 a 4 oraciones con lo que pide el cliente, solo con lo que dice el brief",
  "preguntas": ["lo que falta y cambia la propuesta; vacío si no falta nada"],
  "metodo": "cualitativo | cuantitativo | mixto",
  "fases": [{"nombre": "", "etapa": null, "icono": "nombre de Feather Icon, ej. FiUsers", "goal": "", "tecnica": "", "muestra": ""}],
  "indice": [{"tipo": "contexto | punto_partida | objetivos | enfoque | detalle_fase | muestra | entregables | tiempos | inversion | seccion | cierre", "titulo": "", "resumen": "una línea de lo que dirá", "incluir": true, "razon": "por qué se incluye o se deja fuera"}],
  "precio": {"modo": "unico | por_fase", "partidas": [{"fase": 0, "descripcion": "", "precio": "MXN $000,000.00"}], "total": "MXN $000,000.00 + IVA", "letra": ""},
  "tiempos": {"fecha_inicio": "AAAA-MM-DD o null si está por confirmar", "actividades": [{"nombre": "Reclutamiento", "fase": null, "inicio_semana": 0, "duracion_semanas": 1}]},
  "diseno": {"estilo": "A-G", "portada": "id de portadas.json", "razon": "una frase", "ilustraciones": false}
}` },
  ];
  return llamarJSON({ usuario, esquema: Esqueleto, maxTokens: 16000 });
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

Escribe el contenido completo de la propuesta con base en el esqueleto aprobado. Respeta las fases, el índice (solo las láminas con incluir: true, en ese orden), la muestra, el precio y los tiempos tal como vienen. Responde solo con JSON en el formato del archivo de contenido descrito en references/estructura.md (el mismo de assets/ejemplo_contenido.json), con estilo, portada, paleta, ilustraciones y rutas de archivos tomados de "diseno".` },
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
export function fijarDesdeEsqueleto(contenido: any, esq: EsqueletoT, rutasFotosPortada: string[]): { contenido: any; avisos: string[] } {
  const c = JSON.parse(JSON.stringify(contenido));
  const avisos: string[] = [];
  c.estilo = esq.diseno.estilo;
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
  // Skill (paso 3): «entregables fuera si no hay capturas». Claude a veces deja
  // la lámina con archivo vacío; el constructor no puede dibujar eso.
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
  brief: BriefInput; notas?: string | null; esqueleto: EsqueletoT; archivosPorSlot: Record<string, string>;
  rutasFotosPortada: string[]; progreso?: (paso: string) => void;
}): Promise<ResultadoContenido> {
  args.progreso?.('Escribiendo la propuesta…');
  let fijado = fijarDesdeEsqueleto(await escribirContenido(args), args.esqueleto, args.rutasFotosPortada);
  let contenido = fijado.contenido;
  let problemas = revisarContenido(contenido);
  let vueltas = 0;
  while (problemas.length && vueltas < 2) {
    vueltas++;
    args.progreso?.(`Corrigiendo ${problemas.length} problema(s) del revisor (vuelta ${vueltas} de 2)…`);
    fijado = fijarDesdeEsqueleto(await corregirContenido(contenido, problemas), args.esqueleto, args.rutasFotosPortada);
    contenido = fijado.contenido;
    problemas = revisarContenido(contenido);
  }
  return { contenido, problemas, vueltas, avisos: fijado.avisos };
}

export { z };
