/**
 * Valores exactos del moodboard de look & feel del Hub (no aproximados):
 * Teal #0F3D4D, Info #1795D3, Éxito #257E55. Info/Éxito no existen todavía
 * como tokens globales de Tailwind, así que viven aquí como literales en
 * vez de tocar tailwind.config.ts/index.css desde este módulo. Compartido
 * entre el dashboard de Swipe y el widget del landing de proyecto para no
 * duplicar la paleta ni el componente de pill.
 */
export const TEAL = '#0F3D4D';
export const INFO = '#1795D3';
export const EXITO = '#257E55';
export const GRIS = '#8b93a1';

// Cerrado usa Info (no gris): un capítulo/sesión cerrada tiene resultados
// listos para ver, no está "muerta" — bloqueado/borrador sí es el estado
// sin nada que hacer.
export const ESTADO_COLOR: Record<string, string> = {
  activa: EXITO, abierto: EXITO,
  cerrada: INFO, cerrado: INFO,
  borrador: GRIS, bloqueado: GRIS,
};

export function EstadoPill({ estado }: { estado: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
      style={{ backgroundColor: ESTADO_COLOR[estado] ?? GRIS }}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
      {estado}
    </span>
  );
}
