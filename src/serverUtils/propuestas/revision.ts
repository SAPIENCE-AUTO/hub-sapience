import { revisarContenido, type Problema } from './revisar';
import { revisarEncaje } from './encaje';

// Todo lo que se le revisa al contenido antes de construir: las reglas de la
// skill (revisar.ts, port fiel de revisar.py, incluye encaje de títulos, voz y
// redacción) + lo que revisar.py no mide (encaje.ts: geometría de láminas).
// Ambos alimentan el mismo bucle de corrección.
export function revisarTodo(contenido: any): Problema[] {
  return [...revisarContenido(contenido), ...revisarEncaje(contenido)];
}
