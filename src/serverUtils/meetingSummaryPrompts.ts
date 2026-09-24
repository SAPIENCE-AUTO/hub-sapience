// Minutas / notetaker (sep 2026): un prompt distinto por tipo de junta — a
// petición explícita, porque un kick off con cliente no se resume igual que
// un follow up de proyecto. Los 5 comparten el MISMO esquema de salida
// (resumen en prosa + acuerdos con checkbox) para que la UI de Minutas no
// tenga que renderizar cada tipo distinto — lo que cambia entre tipos es en
// qué se le pide al modelo que se enfoque, no la forma del resultado.
export type MeetingType =
  | 'Kick off con cliente'
  | 'Kick off interno'
  | 'Brief'
  | 'Alineación interna de análisis'
  | 'Follow up de proyecto';

export const MEETING_TYPES: MeetingType[] = [
  'Kick off con cliente',
  'Kick off interno',
  'Brief',
  'Alineación interna de análisis',
  'Follow up de proyecto',
];

const SHARED_OUTPUT_FORMAT = `
Responde ÚNICAMENTE con un objeto JSON (sin texto antes ni después) con esta forma exacta:
{
  "resumen": "resumen en prosa, en español, de 2 a 4 párrafos",
  "acuerdos": [
    { "texto": "descripción concreta y accionable del acuerdo o pendiente", "responsable": "nombre si se mencionó, o null", "hecho": false }
  ]
}
Reporta fielmente lo que se dijo en la transcripción — no inventes acuerdos ni asignes responsables que no se mencionaron. Si no hubo acuerdos o pendientes claros, regresa "acuerdos": [].`;

const PROMPTS: Record<MeetingType, string> = {
  'Kick off con cliente': `Eres un analista de Sapience (agencia de investigación de mercados) resumiendo el kick off de un proyecto con un cliente.
Enfócate en: los objetivos de negocio e investigación que el cliente compartió, el alcance y expectativas acordadas, el público objetivo o categoría relevante, fechas o timeline mencionados, y cualquier duda, riesgo o restricción (presupuesto, tiempos) que haya surgido.
Los acuerdos deben capturar compromisos concretos de cualquiera de las dos partes (Sapience o el cliente) — quién se comprometió a qué.${SHARED_OUTPUT_FORMAT}`,

  'Kick off interno': `Eres un analista de Sapience resumiendo el kick off interno de un proyecto (sin cliente presente).
Enfócate en: el plan de trabajo y metodología definida, roles y responsables del equipo, entregables esperados y sus fechas, y riesgos u obstáculos que el equipo haya identificado.
Los acuerdos deben capturar quién queda a cargo de qué, con fecha si se mencionó.${SHARED_OUTPUT_FORMAT}`,

  'Brief': `Eres un analista de Sapience resumiendo una sesión de brief (el cliente explicando lo que necesita investigar).
Enfócate en: el objetivo de investigación tal como lo planteó el cliente, el público o segmento a estudiar, la metodología que el cliente sugirió o que se discutió, los entregables que espera, y cualquier restricción de tiempo, presupuesto o alcance mencionada.
Los acuerdos deben capturar información pendiente de confirmar o pasos siguientes para convertir el brief en propuesta.${SHARED_OUTPUT_FORMAT}`,

  'Alineación interna de análisis': `Eres un analista de Sapience resumiendo una sesión interna de alineación sobre el análisis de un estudio.
Enfócate en: los hallazgos principales discutidos, interpretaciones o hipótesis que el equipo propuso, puntos donde hubo desacuerdo o falta de claridad, y decisiones tomadas sobre cómo estructurar o presentar el análisis final.
Los acuerdos deben capturar qué queda pendiente de resolver o verificar antes del reporte final, y quién lo hará.${SHARED_OUTPUT_FORMAT}`,

  'Follow up de proyecto': `Eres un analista de Sapience resumiendo una junta de seguimiento (follow up) de un proyecto ya en curso.
Enfócate en: el avance reportado contra el plan original, bloqueos o riesgos que hayan surgido, y decisiones tomadas para resolverlos.
Los acuerdos deben ser accionables y concretos — qué se hará, quién lo hará, y para cuándo si se mencionó.${SHARED_OUTPUT_FORMAT}`,
};

export function getMeetingSummaryPrompt(type: MeetingType): string {
  return PROMPTS[type];
}
