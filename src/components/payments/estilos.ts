// Colores de la pantalla de pagos. Salen del moodboard del Hub (lib/toolColors) y el color es lenguaje: el mismo color
// siempre quiere decir lo mismo — rojo vencido, naranja hoy, azul por pagar, verde pagado, gris cancelado, teal el acento.
import type { CSSProperties } from 'react';
import type { EstadoVisual } from '../../lib/payments/calendario';
import type { Pestana } from '../../lib/payments/types';
import { ALERTA, EXITO, INFO, NEUTRAL, PELIGRO, TEAL } from '../../lib/toolColors';

export const COLOR_ESTADO: Record<EstadoVisual, string> = {
  vencido: PELIGRO,
  hoy: ALERTA,
  porVenir: INFO,
  pagado: EXITO,
  cancelado: NEUTRAL,
};

/** El color del estado que guarda la base (Programado, Realizado, Cancelado). */
export const COLOR_STATUS: Record<string, string> = {
  Programado: INFO,
  Realizado: EXITO,
  Cancelado: NEUTRAL,
};

/** De qué color se pintan los días del calendario en cada pestaña (más pagos, más color). */
export const COLOR_RAMPA: Record<Pestana, string> = {
  porPagar: INFO,
  pagados: EXITO,
  cancelados: NEUTRAL,
  todos: NEUTRAL,
};

// Fondos suaves de los avisos: rojo para lo vencido, naranja para lo de hoy (y el naranja oscuro del texto sobre él).
export const FONDO_PELIGRO = 'hsl(0 72% 96%)';
export const FONDO_ALERTA = 'hsl(38 92% 94%)';
export const TEXTO_ALERTA = 'hsl(32 92% 28%)';

/** Botón secundario «profundidad suave»: blanco con un degradado mínimo, borde y sombra suave. Va con `inline-flex` incluido. */
export const CLASE_BOTON_SUAVE =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[10px] border bg-gradient-to-b from-white to-[hsl(220_20%_98%)] px-[11px] py-[5px] text-xs font-semibold text-foreground/80 shadow-sm transition-colors hover:to-muted disabled:opacity-60';

/** Botón principal «profundidad suave»: teal con un brillo interior y una sombra suave. */
export const ESTILO_BOTON_PRIMARIO: CSSProperties = {
  backgroundColor: TEAL,
  color: '#fff',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.12), 0 1px 2px rgba(20,60,70,.25), 0 4px 10px rgba(20,60,70,.18)',
};

/**
 * Los colores de la pantalla de pagos como variables, para poder usarlos en estados (hover, seleccionado) con clases de Tailwind
 * sin copiar el hexadecimal: `ring-[color:var(--pc-teal)]`. Los sufijos son la opacidad en porcentaje.
 */
export const VARIABLES_PAGOS = {
  '--pc-teal': TEAL,
  '--pc-teal-35': `${TEAL}59`,
  '--pc-teal-12': `${TEAL}1f`,
  '--pc-teal-09': `${TEAL}17`,
  '--pc-peligro': PELIGRO,
  '--pc-peligro-30': `${PELIGRO}4d`,
  '--pc-peligro-bg': FONDO_PELIGRO,
  '--pc-alerta': ALERTA,
  '--pc-alerta-35': `${ALERTA}59`,
  '--pc-alerta-bg': FONDO_ALERTA,
} as CSSProperties;
