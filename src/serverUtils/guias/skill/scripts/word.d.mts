// Tipos de word.mjs (el módulo de la skill es JavaScript puro para que sirva igual desde Claude Code).
export function armarCuerpo(guia: unknown): string;
export function construirWord(opciones: { guia: unknown; plantilla: Uint8Array | ArrayBuffer; JSZip: { loadAsync(datos: unknown): Promise<any> } }): Promise<Uint8Array>;
export function nombreWord(proyecto?: string): string;
