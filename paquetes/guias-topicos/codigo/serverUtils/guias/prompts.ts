// Mensajes de usuario para cada llamada. Las reglas viven en la skill (system prompt); aquí van los
// datos del proyecto, el paso que se pide y el formato que se espera.
import type { BloqueGuia, EstadoGuia } from './types';

const FORMATO_ROADMAP = `Responde solo con el JSON del roadmap: {"proyecto", "tipo", "duracion", "muestra": [..], "bloques": [{"nombre", "minutos", "objetivos": [..]}], "supuestos": [..]}.`;
const FORMATO_BLOQUE = `Responde solo con el JSON del bloque: {"moderador", "secciones": [{"subtema", "intro"?, "preguntas": ["…" | {"texto", "sub": [..]}], "notas": [..]}]}. Usa el objeto con "sub" solo cuando la pregunta lleve una lista de opciones o atributos; **negritas** solo para instrucciones de ejercicio.`;

const limpio = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);

function datos(st: EstadoGuia) {
  return `Proyecto: ${st.proyecto || '(no indicado)'}
Tipo de sesión: ${st.tipo}
Duración: ${st.duracion} min.
Muestra: ${st.muestraText.trim() || '(no indicada)'}
Estímulos: ${st.estimulos.trim() || '(no indicados)'}
Notas del equipo: ${st.notas.trim() || '(ninguna)'}${st.tema.trim() ? `\nTema: ${st.tema.trim()}` : ''}`;
}

const REGLAS_ROADMAP = (dur: number) => `Sigue las reglas del roadmap de references/estructura.md: Warm up de 5 minutos al inicio, tiempos en múltiplos de 5 que sumen exactamente ${dur} minutos, entre 5 y 7 bloques con el central como el más largo, de 2 a 6 objetivos por bloque redactados como la agencia, y en "supuestos" las decisiones metodológicas que tomaste sin que el texto las resolviera.`;

export function promptLeerRoadmap(st: EstadoGuia, fuente: string) {
  return `Una persona pegó o subió el roadmap de una guía. Conviértelo a la estructura indicada sin inventar bloques ni cambiar su orden. Si un bloque no trae minutos, pon 0. Si los objetivos vienen en un párrafo, sepáralos en frases cortas. Si el texto incluye la muestra, pásala a "muestra"; si no, deja la que dio la persona. Anota en "supuestos" cualquier cosa que hayas tenido que interpretar.

${datos(st)}

Texto del roadmap:
"""
${fuente.slice(0, 60000)}
"""

${FORMATO_ROADMAP}`;
}

export function promptRoadmapDesdeBrief(st: EstadoGuia, fuente: string) {
  return `Propón el roadmap de la guía a partir de este brief. ${REGLAS_ROADMAP(st.duracion)} Si el brief describe la muestra, propónla; si la persona ya la escribió, respétala.

${datos(st)}

Brief:
"""
${fuente.slice(0, 60000)}
"""

${FORMATO_ROADMAP}`;
}

export function promptRoadmapDesdeTema(st: EstadoGuia) {
  return `Propón el roadmap de la guía a partir del tema y de los datos del proyecto (no hay brief). ${REGLAS_ROADMAP(st.duracion)}

${datos(st)}

${FORMATO_ROADMAP}`;
}

export function promptAjustarRoadmap(st: EstadoGuia, pedido: string) {
  return `Este es el roadmap actual de una guía, en JSON:
${JSON.stringify({ muestra: st.roadmap!.muestra, bloques: st.roadmap!.bloques })}

${datos(st)}
${st.briefText ? `\nExtracto del brief:\n${st.briefText.slice(0, 15000)}` : ''}

Se pide este ajuste:
"${pedido}"

Aplica el ajuste y conserva todo lo demás. Mantén tiempos en múltiplos de 5 que sumen ${st.duracion} minutos, salvo que se pida otra duración.
${FORMATO_ROADMAP}`;
}

/**
 * Cuánto escribir, con el número concreto de este bloque (los modelos lo siguen mucho mejor que la
 * regla general). Calibrado con las 8 guías reales: ≈ 2,000 palabras y 85–150 «¿» para 120 min, es
 * decir, una pregunta principal cada 2 minutos y ≈ 16 palabras por minuto. Con «una por minuto»
 * salían del doble (≈ 4,100 palabras, 14 páginas).
 */
export function volumen(minutos: number) {
  const n = Math.max(2, Math.round(minutos / 2));
  const palabras = Math.max(60, Math.round((minutos * 16) / 10) * 10);
  return `Este bloque dura ${minutos} minutos: escribe alrededor de ${n} preguntas principales (una cada 2 minutos, más o menos), cada una con uno o dos seguimientos encadenados en la misma línea como mucho, y que el bloque completo ronde las ${palabras} palabras. Cubre todos los objetivos del bloque con lo esencial, sin sesgar (ver «Para no sesgar la conversación» en redaccion.md): el moderador profundiza en vivo, la guía no tiene que anticipar cada repregunta.`;
}

export function promptBloque(st: EstadoGuia, i: number, previo?: BloqueGuia | null, comentario?: string) {
  const rm = st.roadmap!;
  const b = rm.bloques[i];
  const ant = rm.bloques[i - 1];
  const sig = rm.bloques[i + 1];
  return `${datos(st)}
Muestra (carátula):
${limpio(rm.muestra).map((m) => `- ${m}`).join('\n') || '(no indicada)'}
${st.briefText ? `\nExtracto del brief:\n${st.briefText.slice(0, 20000)}\n` : ''}
Roadmap completo:
${rm.bloques.map((x, k) => `${k + 1}. ${x.nombre} (${x.minutos} min.) — objetivos: ${limpio(x.objetivos).join('; ')}`).join('\n')}

Escribe ahora solo el bloque ${i + 1}: "${b.nombre}" (${b.minutos} min.).
Objetivos de este bloque:
${limpio(b.objetivos).map((o) => `- ${o}`).join('\n')}
${volumen(b.minutos)}
${ant ? `Viene después de "${ant.nombre}", así que la frase del moderador debe hacer la transición desde ahí.` : 'Es el primer bloque de la sesión.'}
${sig ? `Después sigue "${sig.nombre}"; no adelantes temas de ese bloque.` : 'Es el último bloque antes del cierre; incluye consejos o recomendaciones finales a la marca si encaja.'}
No repitas lo que cubren otros bloques del roadmap.
${previo ? `\nEsta es la versión anterior del bloque:\n${JSON.stringify(previo)}\n\nSe pidió este cambio: "${comentario ?? ''}". Rehaz el bloque atendiendo el cambio y conserva lo que no se pidió cambiar.` : ''}

${FORMATO_BLOQUE}`;
}
