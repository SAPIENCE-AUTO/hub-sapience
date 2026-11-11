// Una «respuesta» de Fillout es UNA vez que una persona llenó un formulario.
//
// Un mismo formulario puede estar vinculado a varios tableros a la vez (se reutiliza a propósito para reclutar en paralelo): cada respuesta
// nueva se copia entonces a todos esos tableros, una fila por tablero. Esas filas son copias de una sola vez que la persona llenó el filtro,
// no «otros formularios que llenó», y no deben contar como tales en el historial ni en los íconos de otros estudios.
//
// Las copias se reconocen porque comparten el id de la respuesta: lo que va después de la última barra de `source_form`
// («NombreDelFormulario|idDeLaRespuesta», lo escriben checkNewSubmissions, syncFilloutResponses, el webhook y los filtros del Hub).
// Una fila sin ese id (capturada a mano, importada de Excel) no se puede reconocer como copia: se trata como siempre.
//
// Una TRAÍDA (la persona que se trae de un filtro anterior al de ahora, `resultado.traida`) es otra fila de `formulario_respuestas` con id propio, y su fila del tablero lleva ese
// id nuevo, pero es la MISMA vez que la persona llenó el filtro: no es otra respuesta ni otro filtro llenado. Si no se juntaba con la original, cada traída contaba como una respuesta
// repetida más de su reclutador y sumaba un filtro llenado de más (2026-11-11: noviembre salía con 544 respuestas y 0 nuevas, todas traídas). `mapaDeTraidas`
// (serverUtils/formularios/traidasMapa.ts) da el mapa «id de la copia → id de la original»; con él, `respuestaDe` devuelve el id de la original y la copia se junta con ella.

// Con índice abierto (como IdentityRow): una fila de identidad entra sin conversión de tipos.
type FilaConOrigen = { sourceForm?: string | null; [clave: string]: any };
type FilaConTablero = FilaConOrigen & { projectCode?: string | null; boardName?: string | null };

/** Las traídas: id de la respuesta copiada → id de la respuesta original (ver `mapaDeTraidas`). */
export type MapaTraidas = ReadonlyMap<string, string>;

/**
 * El id de la respuesta de una fila, o null si la fila no viene de una respuesta. Con `traidas`, una fila que es la copia de una traída devuelve el id de su respuesta original
 * (es la misma vez que la persona llenó el filtro).
 */
export function respuestaDe(fila: FilaConOrigen, traidas?: MapaTraidas): string | null {
  const origen = typeof fila.sourceForm === 'string' ? fila.sourceForm : '';
  const i = origen.lastIndexOf('|');
  if (i < 0) return null;
  const id = origen.slice(i + 1).trim();
  if (!id) return null;
  return traidas?.get(id) ?? id;
}

/** ¿La fila es la copia de una traída (una respuesta que viene de un filtro anterior), y no la respuesta original? */
export function esFilaDeTraida(fila: FilaConOrigen, traidas?: MapaTraidas): boolean {
  if (!traidas || traidas.size === 0) return false;
  const bruto = respuestaDe(fila);
  return bruto !== null && traidas.has(bruto);
}

/** Los ids de respuesta que la persona ya tiene en un tablero (el que se está viendo). */
export function respuestasEnTablero(
  filas: Iterable<FilaConTablero>,
  projectCode: string | undefined,
  boardName: string | undefined,
  traidas?: MapaTraidas,
): Set<string> {
  const ids = new Set<string>();
  if (!projectCode || !boardName) return ids;
  for (const f of filas) {
    if (f.projectCode !== projectCode || f.boardName !== boardName) continue;
    const id = respuestaDe(f, traidas);
    if (id) ids.add(id);
  }
  return ids;
}
