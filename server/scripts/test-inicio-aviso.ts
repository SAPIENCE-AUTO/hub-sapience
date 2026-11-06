// Pruebas del texto de la hoja del aviso de privacidad («Antes de empezar»): lo que dice un filtro nuevo y que todos los filtros ya guardados, también los que están en vivo, lo lean
// con el texto vigente del Hub sin tocar lo guardado. Contra una base en memoria (PGlite) con la tabla de filtros mínima. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-inicio-aviso.ts
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import { AYUDA_AVISO, ID_AVISO, conTextosDelInicio, seccionInicio } from '../../src/lib/formularios/inicio';
import { leerDefinicion, type Definicion, type Seccion } from '../../src/lib/formularios/tipos';
import getFormularioPublico from '../../src/api/getFormularioPublico';

let n = 0;
let fallas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>) {
  n++;
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${process.env.VERBOSO ? (e as Error).message : (e as Error).message.split('\n')[0]}`);
  }
}

const pg = await PGlite.create({ parsers: { [DATE_OID]: parseDate, [TIMESTAMPTZ_OID]: parseTimestamptz, [NUMERIC_OID]: parseNumeric } });
const q = async (sql: string, params?: unknown[]) => {
  const r = await pg.query(sql, params as any);
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
};
(pool as any).query = q;
(pool as any).connect = async () => ({ query: q, release: () => {} });
await pg.exec(`create table formularios (id uuid primary key default gen_random_uuid(), codigo text, estado text, definicion jsonb);`);

const ANTES = 'Te invitamos a revisar nuestro aviso de privacidad, donde encontrarás cómo cuidamos tus datos personales.';
const NUEVO = 'Te invitamos a revisar nuestro aviso de privacidad, donde encontrarás cómo cuidamos tus datos personales y las condiciones de participación.';

const preguntaAviso = (secciones: Seccion[]) => secciones.flatMap((s) => s.preguntas).find((p) => p.id === ID_AVISO);
/** Un filtro como se guardó antes del cambio: con el texto de antes en la hoja del aviso. */
const guardado = (): Definicion => {
  const inicio = seccionInicio();
  return {
    version: 2, pais: 'MX', tituloPublico: 'Prueba', bienvenida: 'Hola', despedida: 'Gracias', noCalifica: 'Gracias por tu tiempo',
    secciones: [
      { ...inicio, preguntas: inicio.preguntas.map((p) => (p.id === ID_AVISO ? { ...p, ayuda: ANTES } : p)) },
      { id: 's1', titulo: 'Tu casa', preguntas: [{ id: 'p1', tipo: 'texto', texto: '¿Cómo te llamas?', ayuda: ANTES }] },
    ],
  };
};

await prueba('un filtro nuevo trae la hoja del aviso con «y las condiciones de participación»', () => {
  assert.equal(preguntaAviso([seccionInicio()])?.ayuda, NUEVO);
  assert.equal(AYUDA_AVISO, NUEVO);
});

await prueba('un filtro guardado con el texto de antes se lee con el texto nuevo', () => {
  assert.equal(preguntaAviso(guardado().secciones)?.ayuda, ANTES);
  assert.equal(preguntaAviso(leerDefinicion(guardado()).secciones)?.ayuda, NUEVO);
});

await prueba('lo demás queda igual: las opciones, el enlace al aviso, las otras preguntas y las otras secciones', () => {
  const esperado = guardado();
  esperado.secciones = esperado.secciones.map((s) => ({ ...s, preguntas: s.preguntas.map((p) => (p.id === ID_AVISO ? { ...p, ayuda: NUEVO } : p)) }));
  assert.deepEqual(leerDefinicion(guardado()), esperado);
});

await prueba('una pregunta que no es la del aviso conserva su texto aunque diga lo mismo', () => {
  const p1 = leerDefinicion(guardado()).secciones[1].preguntas[0];
  assert.equal(p1.ayuda, ANTES);
});

await prueba('lo guardado en versión 1 también se lee con el texto nuevo', () => {
  const v1 = { ...guardado(), version: 1, pais: undefined } as unknown;
  const leido = leerDefinicion(v1);
  assert.deepEqual([leido.version, leido.pais], [2, 'MX']);
  assert.equal(preguntaAviso(leido.secciones)?.ayuda, NUEVO);
});

await prueba('si el texto ya es el vigente, o el filtro no trae la pregunta del aviso, devuelve la misma definición', () => {
  const vigente = leerDefinicion(guardado());
  assert.equal(conTextosDelInicio(vigente), vigente);
  const sinAviso: Definicion = { ...guardado(), secciones: [guardado().secciones[1]] };
  assert.equal(conTextosDelInicio(sinAviso), sinAviso);
});

await prueba('no cambia lo guardado: el filtro original sigue con su texto (se arma uno nuevo)', () => {
  const original = guardado();
  const leido = leerDefinicion(original);
  assert.notEqual(leido, original);
  assert.equal(preguntaAviso(original.secciones)?.ayuda, ANTES);
});

await prueba('la página pública entrega el texto nuevo de un filtro en vivo guardado con el de antes, sin escribir nada en la base', async () => {
  await pg.query(`insert into formularios (codigo, estado, definicion) values ('envivo1', 'en_vivo', $1::jsonb)`, [JSON.stringify(guardado())]);
  const r: any = await getFormularioPublico.run({ codigo: 'envivo1' }, { user: null } as any);
  assert.equal(r.found, true);
  assert.equal(preguntaAviso((r.definicion as Definicion).secciones)?.ayuda, NUEVO);
  const { rows: [f] } = await pg.query<{ definicion: Definicion }>(`select definicion from formularios where codigo = 'envivo1'`);
  assert.equal(preguntaAviso(f.definicion.secciones)?.ayuda, ANTES);
});

await prueba('un borrador sigue sin entregarse a los participantes', async () => {
  await pg.query(`insert into formularios (codigo, estado, definicion) values ('borr1', 'borrador', $1::jsonb)`, [JSON.stringify(guardado())]);
  const r: any = await getFormularioPublico.run({ codigo: 'borr1' }, { user: null } as any);
  assert.equal(r.found, false);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
