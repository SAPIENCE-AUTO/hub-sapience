import { z } from 'zod';
import { pool } from '../../../server/compat';
import { describir, explicarResultado } from '../../lib/formularios/motor';
import { frenteEnPalabras } from '../../lib/formularios/palabras';
import { leerDefinicion, type ClasificacionIA, type Definicion, type Respuestas, type Resultado } from '../../lib/formularios/tipos';
import { llamarConImagen, MODELOS } from './claude';
import { anotarGasto, cerrarUso, registrarUsoAutomatico } from './uso';

// Clasificación de candidatos (pedido de Sergio, 2026-10-24): al recibir una
// respuesta, sin que el participante espere, la IA dice qué tan buen candidato
// es para cada perfil, con una razón corta, y lo que se ve raro (respuestas que
// se contradicen, abiertas vagas o copiadas, marcar todo). Ayuda al analista a
// ordenar la lista; nunca decide ni cambia si califica.

const Encaje = z.enum(['alto', 'medio', 'bajo']);
export const ClasificacionZ = z.object({
  perfiles: z.array(z.object({ id: z.string(), encaje: Encaje, razon: z.string() })).default([]),
  resumen: z.string().default(''),
  alertas: z.array(z.string()).default([]),
});

const SISTEMA = `Ayudas a un equipo de reclutamiento de una agencia de investigación de mercados a revisar a quienes contestaron un cuestionario filtro (screener). No decides quién entra: das una opinión breve para ordenar la revisión. Escribes en español de México, sin tecnicismos, en frases cortas. Respondes solo con un objeto JSON, sin texto antes ni después.`;

const INSTRUCCIONES = `Con el filtro de arriba y las respuestas de abajo, responde solo con este JSON:
{"perfiles": [{"id": "id del perfil", "encaje": "alto" | "medio" | "bajo", "razon": "una frase de por qué"}], "resumen": "una frase sobre la persona como candidata", "alertas": ["lo raro, si hay: respuestas que se contradicen, abiertas vagas o que no contestan lo que se pregunta, marcar casi todas las marcas o categorías, tiempos o cantidades poco creíbles"]}
- Un elemento en "perfiles" por cada perfil del filtro.
- "alto": cumple de sobra y sus respuestas abiertas son concretas; "medio": cumple justo o con dudas; "bajo": no cumple o sus respuestas no son creíbles.
- Máximo 3 alertas; ninguna si no hay nada raro. No repitas los motivos de «no califica» que ya calculó el sistema.`;

/** El filtro en palabras (perfiles y para qué es), igual para todos: va en caché. */
function contextoDe(def: Definicion, titulo: string): string {
  const perfiles = (def.frentes ?? []).map((f) => `- ${f.id} · ${f.nombre} (cuota ${f.meta}): ${frenteEnPalabras(def, f)}`);
  return [`FILTRO: ${titulo} (${def.pais})`, 'PERFILES:', ...(perfiles.length ? perfiles : ['- (sin perfiles)'])].join('\n');
}

function respuestasEnTexto(def: Definicion, resp: Respuestas, resultado: Resultado): string {
  const lineas = describir(def, resp).flatMap((s) => [`## ${s.titulo}`, ...s.lineas.map((l) => `- ${l.texto}: ${l.fotos ? `(${l.fotos.length} foto)` : l.valor}`)]);
  const sistema = [
    `Califica según las reglas: ${resultado.califica ? `sí, en ${resultado.frentes.join(', ')}` : `no (${explicarResultado(resultado) ?? 'sin perfil'})`}`,
    resultado.nse ? `NSE estimado: ${resultado.nse.nivel}` : '',
    resultado.alertas.length ? `Alertas del sistema: ${resultado.alertas.join('; ')}` : '',
  ].filter(Boolean);
  return [...sistema, '', 'RESPUESTAS:', ...lineas].join('\n');
}

const ORDEN = { alto: 3, medio: 2, bajo: 1 } as const;

/** Clasifica una respuesta y lo guarda en `resultado.ia`. Sin IA disponible no hace nada. */
export async function clasificarCandidato(respuestaId: string): Promise<ClasificacionIA | undefined> {
  if (!process.env.ANTHROPIC_API_KEY) return undefined;
  const { rows: [r] } = await pool.query(
    `select r.id, r.formulario_id, r.respuestas, r.resultado, f.titulo, f.definicion
     from formulario_respuestas r join formularios f on f.id = r.formulario_id where r.id = $1`,
    [respuestaId],
  );
  if (!r) return undefined;
  const def = leerDefinicion(r.definicion);
  const resultado = r.resultado as Resultado;
  // Quien se cortó al principio (no aceptó el aviso o no dio su identificación) no tiene qué revisar.
  if (resultado.terminado && !resultado.frentes.length && Object.keys(r.respuestas ?? {}).length < 5) return undefined;

  const usoId = await registrarUsoAutomatico(r.formulario_id, 'clasificacion');
  try {
    const leido = await llamarConImagen({
      sistema: SISTEMA,
      contexto: contextoDe(def, r.titulo),
      texto: `${respuestasEnTexto(def, r.respuestas as Respuestas, resultado)}\n\n${INSTRUCCIONES}`,
      esquema: ClasificacionZ,
      modelo: MODELOS.cambios,
      esfuerzo: 'low',
      onGasto: (g) => void anotarGasto(usoId, g),
    });
    const perfiles = leido.perfiles.filter((p) => def.frentes?.some((f) => f.id === p.id));
    const encaje = perfiles.reduce<ClasificacionIA['encaje']>((mejor, p) => (ORDEN[p.encaje] > ORDEN[mejor] ? p.encaje : mejor), 'bajo');
    const ia: ClasificacionIA = { encaje, perfiles, resumen: leido.resumen, alertas: leido.alertas.slice(0, 3) };
    await pool.query(`update formulario_respuestas set resultado = resultado || jsonb_build_object('ia', $2::jsonb) where id = $1`, [respuestaId, JSON.stringify(ia)]);
    await cerrarUso(usoId, true);
    return ia;
  } catch (err) {
    await cerrarUso(usoId, false);
    throw err;
  }
}
