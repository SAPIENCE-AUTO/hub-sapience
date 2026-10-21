import type { Definicion } from '../tipos';
import { ALONG2 } from './along2';

/** Plantillas con las que se puede crear un formulario desde Tools. */
export const PLANTILLAS: Record<string, { nombre: string; definicion: Definicion }> = {
  along2: { nombre: 'Screener ALONG 2 · Consumer Closeness 2026', definicion: ALONG2 },
};
