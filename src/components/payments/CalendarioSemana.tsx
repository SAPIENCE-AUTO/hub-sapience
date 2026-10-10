import type { GetPaymentsOutputType } from 'zite-endpoints-sdk';
import { estadoVisual, type DiaCalendario, type SemanaVista } from '../../lib/payments/calendario';
import { diaDelMes, nombreDiaCorto } from '../../lib/payments/fechas';
import { capitaliza, fmtMonto, lineasTotales, nombreProveedor, plural } from '../../lib/payments/formato';
import { TEAL } from '../../lib/toolColors';
import { COLOR_ESTADO } from './estilos';

type Payment = GetPaymentsOutputType['payments'][0];

// Cada pago es un chip: el punto dice cómo va (rojo vencido, naranja hoy, azul por venir, verde pagado, gris cancelado) y
// en los vencidos y los de hoy todo el chip se tiñe. El nombre del proveedor y el proyecto salen al pasar el mouse.
const TINTE: Record<string, string> = {
  vencido: 'border-[color:var(--pc-peligro-30)] bg-[color:var(--pc-peligro-bg)]',
  hoy: 'border-[color:var(--pc-alerta-35)] bg-[color:var(--pc-alerta-bg)]',
};

function Chip({ p, dia, hoy, onSelect }: { p: Payment; dia: string; hoy: string; onSelect: (p: Payment) => void }) {
  const estado = estadoVisual(p, dia, hoy);
  const nombre = nombreProveedor(p.supplierName);
  const monto = fmtMonto(p.amount, p.currency);
  return (
    <button
      type="button"
      onClick={() => onSelect(p)}
      title={`${nombre} · ${p.projectCode ?? 'sin proyecto'}`}
      aria-label={`${p.poNumber ?? 'Sin ODC'}, ${nombre}, ${monto}`}
      className={`inline-flex items-center gap-[7px] whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs transition-shadow hover:ring-2 hover:ring-inset hover:ring-[color:var(--pc-teal-35)] ${TINTE[estado] ?? 'bg-card'}`}
    >
      <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: COLOR_ESTADO[estado] }} />
      <span className="font-mono text-[11.5px] font-medium">{p.poNumber ?? 'Sin ODC'}</span>
      <span className="font-mono text-[11.5px] font-semibold">{monto}</span>
    </button>
  );
}

function FilaDia({ dia, hoy, onSelect }: { dia: DiaCalendario<Payment>; hoy: string; onSelect: (p: Payment) => void }) {
  const lineas = lineasTotales(dia.totales);
  return (
    <div
      className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3 rounded-xl bg-muted px-3 py-2.5 sm:grid-cols-[132px_minmax(0,1fr)]"
      style={dia.esHoy ? { boxShadow: `inset 0 0 0 2px ${TEAL}` } : undefined}
    >
      <div>
        <p className="flex items-center gap-1.5 font-bold">
          {capitaliza(nombreDiaCorto(dia.fecha))}
          <span
            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-[3px] text-[13px] font-semibold ${dia.esHoy ? 'text-white' : ''}`}
            style={dia.esHoy ? { backgroundColor: TEAL } : undefined}
          >
            {diaDelMes(dia.fecha)}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          {dia.pagos.length ? plural(dia.pagos.length, 'pago') : 'sin pagos'}
        </p>
        {lineas.map(l => <p key={l} className="font-mono text-[11.5px] text-muted-foreground">{l}</p>)}
      </div>
      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
        {dia.pagos.map(p => <Chip key={p.id} p={p} dia={dia.fecha} hoy={hoy} onSelect={onSelect} />)}
      </div>
    </div>
  );
}

/** La semana a lo ancho: una fila por día, con todos sus pagos como chips de ODC y monto. */
export function CalendarioSemana({ semana, hoy, onSelect }: { semana: SemanaVista<Payment>; hoy: string; onSelect: (p: Payment) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {semana.dias.map(d => <FilaDia key={d.fecha} dia={d} hoy={hoy} onSelect={onSelect} />)}
    </div>
  );
}
