// Una «respuesta» de Fillout es UNA vez que una persona llenó un formulario.
//
// Un mismo formulario puede estar vinculado a varios tableros a la vez (se reutiliza a propósito para reclutar en paralelo): cada respuesta
// nueva se copia entonces a todos esos tableros, una fila por tablero. Esas filas son copias de una sola vez que la persona llenó el filtro,
// no «otros formularios que llenó», y no deben contar como tales en el historial ni en los íconos de otros estudios.
//
// Las copias se reconocen porque comparten el id de la respuesta: lo que va después de la última barra de `source_form`
// («NombreDelFormulario|idDeLaRespuesta», lo escriben checkNewSubmissions, syncFilloutResponses, el webhook y los filtros del Hub).
// Una fila sin ese id (capturada a mano, importada de Excel) no se puede reconocer como copia: se trata como siempre.

// Con índice abierto (como IdentityRow): una fila de identidad entra sin conversión de tipos.
type FilaConOrigen = { sourceForm?: string | null; [clave: string]: any };
type FilaConTablero = FilaConOrigen & { projectCode?: string | null; boardName?: string | null };

/** El id de la respuesta de una fila, o null si la fila no viene de una respuesta. */
export function respuestaDe(fila: FilaConOrigen): string | null {
  const origen = typeof fila.sourceForm === 'string' ? fila.sourceForm : '';
  const i = origen.lastIndexOf('|');
  if (i < 0) return null;
  const id = origen.slice(i + 1).trim();
  return id || null;
}

/** Los ids de respuesta que la persona ya tiene en un tablero (el que se está viendo). */
export function respuestasEnTablero(
  filas: Iterable<FilaConTablero>,
  projectCode: string | undefined,
  boardName: string | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!projectCode || !boardName) return ids;
  for (const f of filas) {
    if (f.projectCode !== projectCode || f.boardName !== boardName) continue;
    const id = respuestaDe(f);
    if (id) ids.add(id);
  }
  return ids;
}
