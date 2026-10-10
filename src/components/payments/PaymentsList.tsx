import { Fragment, type CSSProperties } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight } from 'lucide-react';
import type { GetPaymentsOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { fmtFechaCorta, soloFecha } from '../../lib/payments/fechas';
import { fmtMonto, fmtTotales, nombreProveedor, plural } from '../../lib/payments/formato';
import type { ClaveOrden, Orden } from '../../lib/payments/lista';
import type { Pestana } from '../../lib/payments/types';
import { textoRelativo, type ClaveGrupo, type Grupo } from '../../lib/payments/urgencia';
import { PELIGRO } from '../../lib/toolColors';
import { AccionPago } from './AccionPago';
import { CopiarOdc } from './CopiarOdc';
import { FONDO_ALERTA, FONDO_PELIGRO, TEXTO_ALERTA } from './estilos';
import { PillPago } from './PillPago';

type Payment = GetPaymentsOutputType['payments'][0];

const ETIQUETA_FECHA: Record<Pestana, string> = {
  porPagar: 'Vence',
  pagados: 'Pagado el',
  cancelados: 'Fecha comprometida',
  todos: 'Fecha comprometida',
};

// Cada grupo con su tono: lo vencido y lo que no tiene fecha en rojo, hoy en naranja, el resto neutro.
const TONO_ROJO: CSSProperties = { backgroundColor: FONDO_PELIGRO, color: PELIGRO };
const TONO_GRUPO: Record<ClaveGrupo, { clase: string; estilo?: CSSProperties }> = {
  vencidos: { clase: 'hover:brightness-95', estilo: TONO_ROJO },
  hoy: { clase: 'hover:brightness-95', estilo: { backgroundColor: FONDO_ALERTA, color: TEXTO_ALERTA } },
  proximos: { clase: 'bg-muted/60 text-foreground hover:bg-muted' },
  adelante: { clase: 'bg-muted/60 text-foreground hover:bg-muted' },
  sinFecha: { clase: 'hover:brightness-95', estilo: TONO_ROJO },
};

function Encabezado({ clave, orden, onOrden, className, children }: {
  clave: ClaveOrden;
  orden: Orden;
  onOrden: (c: ClaveOrden) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const activo = orden.clave === clave;
  const Icono = !activo ? ArrowUpDown : orden.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className={`px-3 py-2.5 text-xs font-semibold text-left whitespace-nowrap ${className ?? ''}`}
      aria-sort={activo ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onOrden(clave)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${activo ? 'text-foreground' : 'text-muted-foreground'}`}
      >
        {children}
        <Icono className={`w-3 h-3 ${activo ? '' : 'opacity-40'}`} />
      </button>
    </th>
  );
}

function CeldaFecha({ p, pestana, hoy, grupo }: { p: Payment; pestana: Pestana; hoy: string; grupo?: ClaveGrupo }) {
  if (pestana === 'pagados') {
    const comprometido = soloFecha(p.dueDate);
    return (
      <>
        <p>{fmtFechaCorta(p.paymentDate, hoy)}</p>
        {comprometido && comprometido !== soloFecha(p.paymentDate) && <p className="text-[11px] text-muted-foreground">comprometido {fmtFechaCorta(comprometido, hoy)}</p>}
      </>
    );
  }
  const relativo = p.status === 'Programado' ? textoRelativo(p.dueDate, hoy) : null;
  // dentro del grupo «Hoy» decir «hoy» en cada renglón es puro ruido
  const verRelativo = relativo && grupo !== 'hoy';
  return (
    <>
      <p className={relativo?.tono === 'vencido' ? 'font-medium' : ''} style={relativo?.tono === 'vencido' ? { color: PELIGRO } : undefined}>{fmtFechaCorta(p.dueDate, hoy)}</p>
      {verRelativo && <p className={`text-[11px] ${relativo.tono === 'vencido' ? '' : 'text-muted-foreground'}`} style={relativo.tono === 'vencido' ? { color: PELIGRO } : undefined}>{relativo.texto}</p>}
    </>
  );
}

function Fila({ p, pestana, hoy, grupo, seleccionado, onToggle, onAbrir }: {
  p: Payment;
  pestana: Pestana;
  hoy: string;
  grupo?: ClaveGrupo;
  seleccionado: boolean;
  onToggle: (id: string) => void;
  onAbrir: (p: Payment) => void;
}) {
  return (
    <tr className={`hover:bg-muted/30 transition-colors cursor-pointer ${seleccionado ? 'bg-primary/5' : ''}`} onClick={() => onAbrir(p)}>
      <td className="px-3 py-2.5" onClick={e => { e.stopPropagation(); onToggle(p.id); }}>
        <Checkbox checked={seleccionado} onCheckedChange={() => onToggle(p.id)} aria-label="Seleccionar fila" />
      </td>
      <td className="px-3 py-2.5 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          {p.poNumber ? (
            <>
              <span className="font-mono text-[13px] font-semibold whitespace-nowrap">{p.poNumber}</span>
              <CopiarOdc numero={p.poNumber} />
            </>
          ) : (
            <span className="text-xs text-muted-foreground whitespace-nowrap">Sin ODC</span>
          )}
          <span className="truncate text-sm ml-1" title={p.supplierName ?? undefined}>{nombreProveedor(p.supplierName)}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate">{p.projectCode ?? '—'}</p>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap font-semibold">{fmtMonto(p.amount, p.currency)}</td>
      <td className="px-3 py-2.5 text-sm whitespace-nowrap">
        <CeldaFecha p={p} pestana={pestana} hoy={hoy} grupo={grupo} />
      </td>
      {pestana === 'todos' && (
        <td className="px-3 py-2.5">
          <PillPago status={p.status} />
        </td>
      )}
      <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
        <AccionPago p={p} onAbrir={onAbrir} />
      </td>
    </tr>
  );
}

export interface PaymentsListProps {
  pestana: Pestana;
  hoy: string;
  /** Con grupos (pestaña «Por pagar») la lista se parte por urgencia; sin grupos es una lista plana. */
  grupos: Grupo<Payment>[] | null;
  pagos: Payment[];
  orden: Orden;
  onOrden: (c: ClaveOrden) => void;
  colapsados: ReadonlySet<ClaveGrupo>;
  onToggleGrupo: (g: ClaveGrupo) => void;
  seleccion: ReadonlySet<string>;
  onToggleSeleccion: (id: string) => void;
  todosSeleccionados: boolean;
  onToggleTodos: () => void;
  onAbrir: (p: Payment) => void;
  /** Cuántos pagos de la lista plana quedaron sin mostrar. */
  sinMostrar: number;
  onMostrarMas: () => void;
}

export function PaymentsList(props: PaymentsListProps) {
  const { pestana, hoy, grupos, pagos, orden, onOrden, colapsados, onToggleGrupo, seleccion, onToggleSeleccion, todosSeleccionados, onToggleTodos, onAbrir, sinMostrar, onMostrarMas } = props;
  const columnas = pestana === 'todos' ? 6 : 5;
  const fila = (p: Payment, grupo?: ClaveGrupo) => (
    <Fila key={p.id} p={p} pestana={pestana} hoy={hoy} grupo={grupo} seleccionado={seleccion.has(p.id)} onToggle={onToggleSeleccion} onAbrir={onAbrir} />
  );

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-380px)]">
        <table className="w-full text-sm table-fixed min-w-[720px]">
          <colgroup>
            <col className="w-11" />
            <col />
            <col className="w-[130px]" />
            <col className="w-[150px]" />
            {pestana === 'todos' && <col className="w-[110px]" />}
            <col className="w-[170px]" />
          </colgroup>
          <thead className="bg-muted sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2.5">
                <Checkbox checked={todosSeleccionados} onCheckedChange={onToggleTodos} aria-label="Seleccionar todos los que se ven" />
              </th>
              <Encabezado clave="odc" orden={orden} onOrden={onOrden}>ODC y proveedor</Encabezado>
              <Encabezado clave="monto" orden={orden} onOrden={onOrden}>Monto</Encabezado>
              <Encabezado clave="fecha" orden={orden} onOrden={onOrden}>{ETIQUETA_FECHA[pestana]}</Encabezado>
              {pestana === 'todos' && <th className="px-3 py-2.5 text-xs font-semibold text-left text-muted-foreground">Estado</th>}
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {grupos
              ? grupos.map(g => {
                  const cerrado = colapsados.has(g.clave);
                  return (
                    <Fragment key={g.clave}>
                      <tr>
                        <td colSpan={columnas} className="p-0">
                          <button
                            type="button"
                            aria-expanded={!cerrado}
                            onClick={() => onToggleGrupo(g.clave)}
                            className={`w-full flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-left transition-colors ${TONO_GRUPO[g.clave].clase}`}
                            style={TONO_GRUPO[g.clave].estilo}
                          >
                            {cerrado ? <ChevronRight className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                            {g.titulo} · {plural(g.pagos.length, 'pago')} · {fmtTotales(g.totales)}
                          </button>
                        </td>
                      </tr>
                      {!cerrado && g.pagos.map(p => fila(p, g.clave))}
                    </Fragment>
                  );
                })
              : pagos.map(p => fila(p))}
          </tbody>
        </table>
      </div>
      {sinMostrar > 0 && (
        <div className="border-t px-4 py-3 text-center">
          <Button variant="ghost" size="sm" className="text-xs" onClick={onMostrarMas}>
            Mostrar más ({sinMostrar} sin mostrar)
          </Button>
        </div>
      )}
    </div>
  );
}
