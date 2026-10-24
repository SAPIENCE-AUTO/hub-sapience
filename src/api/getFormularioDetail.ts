import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { etiqueta, explicarResultado } from '../lib/formularios/motor';
import { leerDefinicion, type Respuestas, type Resultado } from '../lib/formularios/tipos';
import { respuestasYaPasadas, vinculoVigente, type Vinculo } from '../serverUtils/formularios/reclutamiento';
import { generadorParaNavegador } from '../serverUtils/formularios/generar';
import { LIMITE_POR_HORA, usoDeLaHora } from '../serverUtils/formularios/uso';
import { leerGenerador } from '../lib/formularios/generador';

/**
 * Detalle para el panel: la definición completa (es interna, aquí sí va todo)
 * y una fila por respuesta. Las cuotas las arma el panel con `frentes`, así
 * puede contarlas con o sin las respuestas de prueba.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Detalle de un formulario con sus respuestas resumidas',
  inputSchema: z.object({ formularioId: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    id: z.string().optional(),
    codigo: z.string().optional(),
    titulo: z.string().optional(),
    estado: z.string().optional(),
    definicion: z.any().optional(),
    /** En vivo: la copia de trabajo con los cambios sin publicar (si hay). */
    cambios: z.any().optional(),
    /** Sube con cada guardado del editor: con ella se evita pisar cambios de otra persona. */
    revision: z.number().optional(),
    tablero: z.object({ id: z.string(), nombre: z.string() }).optional(),
    /** Fase 3: insumos, estructura y supuestos si el filtro se hizo con la IA (sin el texto de los archivos). */
    generador: z.any().optional(),
    /** Llamadas a la IA de esta persona en la última hora, contra el tope. */
    usoIA: z.object({ usadas: z.number(), limite: z.number() }).optional(),
    respuestas: z.array(z.object({
      id: z.string(),
      createdAt: z.string(),
      esPrueba: z.boolean(),
      nombre: z.string().optional(),
      telefono: z.string().optional(),
      edad: z.string().optional(),
      genero: z.string().optional(),
      nse: z.string().optional(),
      /** Frentes donde entró aunque su NSE no es el que pide el frente. */
      nseFueraDe: z.array(z.string()),
      califica: z.boolean(),
      frentes: z.array(z.string()),
      motivo: z.string().optional(),
      alertas: z.array(z.string()),
      incompleto: z.boolean(),
      duplicado: z.boolean(),
      enReclutamiento: z.boolean(),
      duracionSeg: z.number().optional(),
      /** Fase 5: historial de duplicados, lo que dice la IA, si su perfil ya está lleno y si se trajo de otro filtro. */
      historial: z.object({ nivel: z.string().optional(), nota: z.string() }).optional(),
      ia: z.object({ encaje: z.string(), resumen: z.string(), alertas: z.array(z.string()) }).optional(),
      perfilLleno: z.boolean(),
      traida: z.object({ titulo: z.string(), proyecto: z.string().optional(), fecha: z.string() }).optional(),
    })).optional(),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows: [f] } = await pool.query(`select id, codigo, titulo, estado, definicion, cambios, revision, vinculo, generador from formularios where id = $1`, [input.formularioId]);
    if (!f) return { found: false };
    const def = leerDefinicion(f.definicion);

    const { rows } = await pool.query(
      `select id, created_at, es_prueba, respuestas, resultado, califica, nombre, telefono, duracion_seg
       from formulario_respuestas where formulario_id = $1 order by created_at desc`,
      [f.id],
    );
    // Si borraron el tablero vinculado, el panel vuelve a pedir uno.
    const vinculo = await vinculoVigente(f.vinculo as Vinculo | null);
    // «En reclutamiento» = está en el tablero vinculado ahora (si se cambió de tablero, el nuevo empieza vacío).
    const pasadas = vinculo ? await respuestasYaPasadas(rows.map((r) => r.id), vinculo.boardId) : new Set<string>();
    const porTelefono = new Map<string, number>();
    for (const r of rows) {
      const tel = String(r.telefono ?? '').replace(/\D/g, '');
      if (tel) porTelefono.set(tel, (porTelefono.get(tel) ?? 0) + 1);
    }

    return {
      found: true, id: f.id, codigo: f.codigo, titulo: f.titulo, estado: f.estado, definicion: def, revision: f.revision,
      cambios: f.cambios ? leerDefinicion(f.cambios) : undefined,
      tablero: vinculo ? { id: vinculo.boardId, nombre: vinculo.boardName } : undefined,
      generador: generadorParaNavegador(leerGenerador(f.generador)),
      usoIA: { usadas: await usoDeLaHora(context.user!.email), limite: LIMITE_POR_HORA },
      respuestas: rows.map((r) => {
        const resp = r.respuestas as Respuestas;
        const res = r.resultado as Resultado;
        return {
          id: r.id,
          createdAt: new Date(r.created_at).toISOString(),
          esPrueba: r.es_prueba,
          nombre: r.nombre ?? undefined,
          telefono: r.telefono ?? undefined,
          edad: etiqueta(def, def.claves?.edad, resp),
          genero: etiqueta(def, def.claves?.genero, resp),
          nse: res.nse?.nivel,
          nseFueraDe: res.nse?.fueraDe ?? [],
          califica: r.califica,
          frentes: res.frentes,
          motivo: explicarResultado(res),
          alertas: res.alertas,
          incompleto: res.incompleto,
          duplicado: (porTelefono.get(String(r.telefono ?? '').replace(/\D/g, '')) ?? 0) > 1,
          duracionSeg: r.duracion_seg ?? undefined,
          enReclutamiento: pasadas.has(r.id),
          historial: res.historial ? { nivel: res.historial.nivel, nota: res.historial.nota } : undefined,
          ia: res.ia ? { encaje: res.ia.encaje, resumen: res.ia.resumen, alertas: res.ia.alertas } : undefined,
          perfilLleno: !!res.perfilLleno,
          traida: res.traida ? { titulo: res.traida.titulo, proyecto: res.traida.proyecto, fecha: res.traida.fecha } : undefined,
        };
      }),
    };
  },
});
