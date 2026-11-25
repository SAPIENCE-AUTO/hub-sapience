import type { EstadoReparto, ResumenReparto } from '@/lib/pilares/reparto';
import type { Sugerencia } from '@/lib/pilares/sugerencias';

// Lo que mandan los endpoints de Pilares, tal como llega a la pantalla.

export interface PilarCat {
  id: string;
  nombre: string;
  color: string;
  orden: number;
  activo: boolean;
}

export interface ItemApi {
  pilarId: string;
  precio: number | null;
  costo: number | null;
}

export interface DealBasicoApi {
  id: string;
  nombre: string;
  cliente: string | null;
  fase: string | null;
  precio: number | null;
  moneda: string;
  tipoCambio: number | null;
  tipoProyecto: string | null;
  fecha: string | null;
}

export interface ReferenciasCosto {
  real: number | null;
  cotizado: number | null;
  otraMoneda: boolean;
}

export interface RepartoApi {
  deal: DealBasicoApi;
  pilares: PilarCat[];
  items: ItemApi[];
  resumen: ResumenReparto;
  sugerencia: Sugerencia | null;
  veCostos: boolean;
  referencias: ReferenciasCosto | null;
}

export interface DealClasificarApi extends DealBasicoApi {
  items: ItemApi[];
  estado: EstadoReparto;
  asignado: number;
  falta: number;
  sobra: number;
  sugerencia: Sugerencia | null;
}

/** El precio de un deal en pesos (lo que no es MXN se multiplica por su tipo de cambio, o por 20 si no lo tiene: igual que el tablero comercial). */
export function precioEnPesos(d: Pick<DealBasicoApi, 'precio' | 'moneda' | 'tipoCambio'>): number {
  const base = d.precio ?? 0;
  return d.moneda === 'MXN' ? base : base * (d.tipoCambio || 20);
}
