import { revisarContenido, type Problema } from './revisar';
import { revisarEncaje, revisarVoz } from './encaje';

// Todo lo que se le revisa al contenido antes de construir: las reglas de la
// skill (revisar.ts, port fiel de revisar.py) + el encaje y la voz del Hub
// (encaje.ts). Los tres alimentan el mismo bucle de corrección.
export function revisarTodo(contenido: any): Problema[] {
  return [...revisarContenido(contenido), ...revisarEncaje(contenido), ...revisarVoz(contenido)];
}
