/**
 * El motivo que mandó el servidor, si lo hay; si no, el texto de siempre. «Error interno» y «x falló (500)» no le dicen
 * nada a quien usa la pantalla, así que en esos casos se queda con el texto de siempre.
 */
export function motivoDelError(e: unknown, porDefecto: string): string {
  const m = e instanceof Error ? e.message.trim() : '';
  if (!m || m === 'Error interno' || /falló \(\d+\)$/.test(m)) return porDefecto;
  return m;
}
