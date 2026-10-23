import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { etiqueta, explicarResultado } from '../lib/formularios/motor';
import { leerDefinicion, type Respuestas, type Resultado } from '../lib/formularios/tipos';
import { respuestasYaPasadas, vinculoVigente, type Vinculo } from '../serverUtils/formularios/reclutamiento';

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
    tablero: z.object({ id: z.string(), nombre: z.string() }).optional(),
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
    })).optional(),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    const { rows: [f] } = await pool.query(`select id, codigo, titulo, estado, definicion, vinculo from formularios where id = $1`, [input.formularioId]);
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
      found: true, id: f.id, codigo: f.codigo, titulo: f.titulo, estado: f.estado, definicion: def,
      tablero: vinculo ? { id: vinculo.boardId, nombre: vinculo.boardName } : undefined,
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
        };
      }),
    };
  },
});
