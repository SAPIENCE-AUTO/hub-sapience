import { PAISES } from './paises';
import { TIPOS, esDeOpciones, esMatriz, forma, type Condicion, type Definicion, type Pregunta } from './tipos';

/**
 * Revisa que un screener esté bien armado antes de usarlo: cada pregunta con
 * lo que su tipo necesita, una o varias respuestas dicho por el tipo (lo que
 * solo tiene sentido en varias no puede ir en una), y la lógica apuntando a
 * preguntas que existen. Devuelve los problemas en palabras; vacío = listo.
 * La usan las pruebas con cada plantilla y createFormulario; el editor de la
 * fase 2 la usará al guardar.
 */

const SEPARADORES = /[@#.]/; // separan las claves de respuesta y de columna

export function revisarDefinicion(def: Definicion): string[] {
  const problemas: string[] = [];
  const mal = (texto: string) => problemas.push(texto);
  const preguntas = new Map<string, Pregunta>();
  const repetidas = new Set<string>();

  if (def.version !== 2) mal(`La versión del screener es ${def.version}; se espera la 2.`);
  if (!PAISES[def.pais]) mal(`El país «${def.pais}» no está en la lista de países.`);

  for (const s of def.secciones) {
    if (s.preguntas.length === 0) mal(`La sección «${s.id}» no tiene preguntas.`);
    for (const p of s.preguntas) {
      if (preguntas.has(p.id)) mal(`El id «${p.id}» se usa en dos preguntas.`);
      preguntas.set(p.id, p);
      if (s.repetirPor) repetidas.add(p.id);
    }
  }

  for (const s of def.secciones) {
    if (s.repetirPor) {
      const origen = preguntas.get(s.repetirPor);
      if (!origen) mal(`La sección «${s.id}» se repite por «${s.repetirPor}», que no existe.`);
      else if (forma(origen.tipo) !== 'varias') mal(`La sección «${s.id}» se repite por «${s.repetirPor}», que no es de varias respuestas.`);
    }
    if (s.mostrarSi) revisarCondicion(s.mostrarSi, `la sección «${s.id}»`);

    for (const p of s.preguntas) {
      const donde = `«${p.id}»`;
      if (!TIPOS[p.tipo]) { mal(`${donde}: el tipo «${p.tipo}» no existe.`); continue; }
      const f = forma(p.tipo);
      if (SEPARADORES.test(p.id)) mal(`${donde}: el id no puede llevar @, # ni punto.`);
      if (!p.texto?.trim() && p.tipo !== 'contenido') mal(`${donde}: falta el texto de la pregunta.`);
      if (p.tipo === 'contenido' && !p.texto?.trim() && !p.imagen) mal(`${donde}: una pantalla de contenido lleva texto o imagen.`);

      const opciones = [...(p.opciones ?? []), ...(p.opcionesExtra ?? [])];
      const usaOpciones = esDeOpciones(p.tipo) || esMatriz(p.tipo) || f === 'orden';
      if (usaOpciones && !p.opciones?.length && !p.opcionesDe) mal(`${donde}: le faltan las opciones.`);
      if (!usaOpciones && (p.opciones?.length || p.opcionesDe)) mal(`${donde}: una pregunta de tipo «${TIPOS[p.tipo].nombre}» no lleva opciones.`);
      if (p.opcionesDe) {
        const origen = preguntas.get(p.opcionesDe);
        if (!origen) mal(`${donde}: sus opciones salen de «${p.opcionesDe}», que no existe.`);
        else if (!esDeOpciones(origen.tipo)) mal(`${donde}: sus opciones salen de «${p.opcionesDe}», que no es de opciones.`);
      }
      const ids = new Set<string>();
      for (const o of opciones) {
        if (ids.has(o.id)) mal(`${donde}: la opción «${o.id}» está dos veces.`);
        ids.add(o.id);
        if (SEPARADORES.test(o.id)) mal(`${donde}: el id de la opción «${o.id}» no puede llevar @, # ni punto.`);
        if (!o.label?.trim()) mal(`${donde}: la opción «${o.id}» no tiene texto.`);
        if (o.exclusiva && f !== 'varias') mal(`${donde}: «${o.label}» es exclusiva, pero en una pregunta de una sola respuesta no hace falta.`);
        if (o.descarta && !repetidas.has(p.id)) mal(`${donde}: «${o.label}» descarta un bloque, pero la pregunta no está en una sección que se repite.`);
        if ((o.termina || o.descarta || o.excluyeGrupos) && !esDeOpciones(p.tipo)) mal(`${donde}: solo las preguntas de opciones terminan o descartan por opción.`);
        if (o.otra && !esDeOpciones(p.tipo)) mal(`${donde}: «Otra, ¿cuál?» solo va en preguntas de opciones.`);
      }
      if (p.maxOpciones !== undefined && f !== 'varias' && f !== 'orden') mal(`${donde}: «máximo de opciones» solo va en preguntas de varias respuestas o en ordenar.`);
      if (esMatriz(p.tipo) && !p.filas?.length) mal(`${donde}: a la matriz le faltan las filas.`);
      if (!esMatriz(p.tipo) && (p.filas?.length || p.reglasMatriz?.length)) mal(`${donde}: solo una matriz lleva filas.`);
      for (const r of p.reglasMatriz ?? []) {
        if (!p.filas?.some((x) => x.id === r.fila)) mal(`${donde}: una regla usa la fila «${r.fila}», que no existe.`);
      }
      if (p.tipo === 'imagen_unica' || p.tipo === 'imagen_multiple') {
        if (!p.opcionesDe && !opciones.some((o) => o.imagen)) mal(`${donde}: es un selector con imágenes y ninguna opción tiene imagen.`);
      }
      if ((p.min !== undefined || p.max !== undefined) && f !== 'numero') mal(`${donde}: solo los números y las escalas llevan rango.`);
      if (p.min !== undefined && p.max !== undefined && p.min >= p.max) mal(`${donde}: el mínimo tiene que ser menor que el máximo.`);
      if (p.terminaFuera && f !== 'numero') mal(`${donde}: «termina si está fuera de rango» solo va en números y escalas.`);
      if (p.patron && f !== 'texto') mal(`${donde}: solo las preguntas de texto llevan patrón.`);
      if (p.patron) { try { new RegExp(p.patron); } catch { mal(`${donde}: el patrón no es válido.`); } }
      if (p.mostrarSi) revisarCondicion(p.mostrarSi, donde);
      if (p.terminaSi) revisarCondicion(p.terminaSi.si, donde);
    }
  }

  const frentes = new Set<string>();
  for (const fr of def.frentes ?? []) {
    if (frentes.has(fr.id)) mal(`El frente «${fr.id}» está dos veces.`);
    frentes.add(fr.id);
    revisarCondicion(fr.califica, `el frente «${fr.nombre}»`);
  }
  for (const a of def.alertas ?? []) {
    if (a.si) revisarCondicion(a.si, `la alerta «${a.texto}»`);
    if (a.contar && !preguntas.has(a.contar.pregunta)) mal(`La alerta «${a.texto}» cuenta «${a.contar.pregunta}», que no existe.`);
  }
  if (def.nse) {
    for (const [id, puntos] of Object.entries(def.nse.puntos)) {
      const p = preguntas.get(id);
      if (!p) { mal(`El NSE suma «${id}», que no existe.`); continue; }
      if (forma(p.tipo) !== 'una') mal(`El NSE suma «${id}», que no es de una sola respuesta.`);
      for (const o of p.opciones ?? []) if (puntos[o.id] === undefined) mal(`El NSE no tiene puntos para «${o.label}» en «${id}».`);
    }
  }
  for (const [rol, id] of Object.entries(def.claves ?? {})) {
    if (id && !preguntas.has(id)) mal(`La clave «${rol}» apunta a «${id}», que no existe.`);
  }
  return problemas;

  function revisarCondicion(c: Condicion, donde: string) {
    if ('todas' in c) return c.todas.forEach((x) => revisarCondicion(x, donde));
    if ('alguna' in c) return c.alguna.forEach((x) => revisarCondicion(x, donde));
    if ('no' in c) return revisarCondicion(c.no, donde);
    if ('instanciaEs' in c) return;
    if ('nse' in c) { if (!def.nse) mal(`En ${donde} se pide NSE, pero el screener no tiene regla de NSE.`); return; }
    if ('bloque' in c) {
      const s = def.secciones.find((x) => x.id === c.bloque);
      if (!s?.repetirPor) mal(`En ${donde} se usa el bloque «${c.bloque}», que no es una sección que se repite.`);
      return;
    }
    if ('numero' in c) {
      const p = preguntas.get(c.numero);
      if (!p) mal(`En ${donde} se usa «${c.numero}», que no existe.`);
      else if (forma(p.tipo) !== 'numero') mal(`En ${donde} se pide un rango a «${c.numero}», que no da un número.`);
      return;
    }
    if (!preguntas.has(c.pregunta)) mal(`En ${donde} se usa «${c.pregunta}», que no existe.`);
  }
}
