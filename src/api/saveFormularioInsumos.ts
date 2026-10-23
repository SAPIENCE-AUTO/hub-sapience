import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoFormularios } from '../serverUtils/formularios/acceso';
import { borrarArchivoInsumo, leerArchivoInsumo } from '../serverUtils/formularios/insumos';
import { generadorParaNavegador } from '../serverUtils/formularios/generar';
import { generadorNuevo, leerGenerador } from '../lib/formularios/generador';

/**
 * Insumos del generador con IA (fase 3 de Filtros): notas, reuniones de
 * Notetaker y archivos (uno por llamada: PDF, PowerPoint o Word en base64).
 * El PDF se guarda en la carpeta privada; del Word y del PowerPoint, su texto.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Guarda los insumos del generador de un filtro: notas, reuniones y archivos',
  inputSchema: z.object({
    formularioId: z.string(),
    notas: z.string().max(100_000).optional(),
    reuniones: z.array(z.object({ id: z.string(), titulo: z.string(), fecha: z.string().optional() })).optional(),
    archivo: z.object({ nombre: z.string(), mime: z.string(), base64: z.string() }).optional(),
    quitarArchivo: z.string().optional(),
  }),
  outputSchema: z.object({ generador: z.any() }),
  execute: async ({ input, context }) => {
    exigirAccesoFormularios(context);
    // El archivo se lee antes de abrir la transacción: subir un PDF tarda.
    const nuevo = input.archivo
      ? await leerArchivoInsumo(input.formularioId, randomUUID(), input.archivo.nombre, input.archivo.mime, Buffer.from(input.archivo.base64, 'base64'))
      : undefined;

    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows: [f] } = await client.query(`select generador from formularios where id = $1 for update`, [input.formularioId]);
      if (!f) throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró el filtro.' });
      const g = leerGenerador(f.generador) ?? generadorNuevo('filtro');
      const insumos = { ...g.insumos };
      if (input.notas !== undefined) insumos.notas = input.notas;
      if (input.reuniones) insumos.reuniones = input.reuniones;
      if (nuevo) insumos.archivos = [...insumos.archivos, nuevo];
      const quitado = input.quitarArchivo ? insumos.archivos.find((a) => a.id === input.quitarArchivo) : undefined;
      if (quitado) insumos.archivos = insumos.archivos.filter((a) => a.id !== quitado.id);
      const guardado = { ...g, insumos };
      await client.query(`update formularios set generador = $2, updated_at = now() where id = $1`, [input.formularioId, JSON.stringify(guardado)]);
      await client.query('commit');
      if (quitado) await borrarArchivoInsumo(quitado);
      return { generador: generadorParaNavegador(guardado) };
    } catch (err) {
      try { await client.query('rollback'); } catch { /* la conexión ya murió */ }
      throw err;
    } finally {
      client.release();
    }
  },
});
