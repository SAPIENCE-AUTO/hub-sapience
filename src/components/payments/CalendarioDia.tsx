import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import type { GetPaymentsOutputType } from 'zite-endpoints-sdk';
import {
  agrupaPorProveedor, type DiaCalendario, type DiaCercano, type GrupoProveedor, type Sentido,
} from '../../lib/payments/calendario';
import { diaDelMes, nombreDia, nombreMes } from '../../lib/payments/fechas';
import { capitaliza, fmtMonto, fmtTotales, plural } from '../../lib/payments/formato';
import type { Pestana } from '../../lib/payments/types';
import { totalesPorMoneda } from '../../lib/payments/urgencia';
import { GOLD, TEAL } from '../../lib/toolColors';
import { AccionPago } from './AccionPago';
import { CopiarOdc } from './CopiarOdc';
import { PillPago } from './PillPago';

type Payment = GetPaymentsOutputType['payments'][0];

/** Cuántos proveedores se ven de entrada; el resto está detrás de «N proveedores más». */
const PROVEEDORES_VISIBLES = 3;

function Renglon({ p, grupo, unico, pestana, primero, onSelect }: {
  p: Payment;
  grupo: GrupoProveedor<Payment>;
  unico: boolean;
  pestana: Pestana;
  primero: boolean;
  onSelect: (p: Payment) => void;
}) {
  return (
    <div
      className={`flex cursor-pointer items-center gap-2.5 px-3 transition-colors hover:bg-muted/40 ${unico ? 'py-2.5' : 'py-2'} ${primero ? '' : 'border-t'}`}
      onClick={() => onSelect(p)}
    >
      <div className="min-w-0 flex-1">
        {unico && <p className="truncate font-bold" title={grupo.clave || undefined}>{grupo.nombre}</p>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onSelect(p); }}
            className="font-mono text-[13px] font-medium hover:underline"
          >
            {p.poNumber ?? 'Sin ODC'}
          </button>
          {p.poNumber && <CopiarOdc numero={p.poNumber} />}
          {p.projectCode && (
            <span className="whitespace-nowrap rounded-md bg-muted px-2 py-px text-[11px] font-medium text-muted-foreground">{p.projectCode}</span>
          )}
          {pestana === 'todos' && <PillPago status={p.status} />}
        </div>
      </div>
      <p className="min-w-[88px] whitespace-nowrap text-right font-mono text-[12.5px] font-semibold">{fmtMonto(p.amount, p.currency)}</p>
      <div onClick={e => e.stopPropagation()}>
        <AccionPago p={p} onAbrir={onSelect} />
      </div>
    </div>
  );
}

// Un proveedor con varios pagos lleva su cabecera teal (nombre, cuántos y cuánto); con uno solo, el nombre va en el renglón.
function GrupoDelDia({ grupo, pestana, onSelect }: { grupo: GrupoProveedor<Payment>; pestana: Pestana; onSelect: (p: Payment) => void }) {
  const unico = grupo.pagos.length === 1;
  return (
    <div className="mb-2 overflow-hidden rounded-xl border bg-card">
      {!unico && (
        <div className="flex items-center gap-2.5 px-3 py-[9px] text-white" style={{ backgroundColor: TEAL }}>
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold" title={grupo.clave || undefined}>{grupo.nombre}</p>
            <p className="truncate text-xs text-white/70">{plural(grupo.pagos.length, 'pago')}</p>
          </div>
          <p className="whitespace-nowrap font-mono font-semibold">{fmtTotales(grupo.totales)}</p>
        </div>
      )}
      {grupo.pagos.map((p, i) => (
        <Renglon key={p.id} p={p} grupo={grupo} unico={unico} pestana={pestana} primero={i === 0} onSelect={onSelect} />
      ))}
    </div>
  );
}

export interface CalendarioDiaProps {
  /** El día que se ve; null si el mes no tiene pagos que mostrar. */
  dia: DiaCalendario<Payment> | null;
  /** Mes a la vista ('YYYY-MM'), para decir «sin pagos en octubre» cuando no hay día. */
  mes: string;
  pestana: Pestana;
  /** El día con pagos más cercano a este, para ofrecerlo cuando el de hoy está vacío. */
  cercano: DiaCercano | null;
  /** Hacia dónde se busca ese día: adelante en «Por pagar», atrás en «Pagados». */
  sentido: Sentido;
  onIrADia: (fecha: string) => void;
  /** Si ya se abrió «N proveedores más». */
  expandido: boolean;
  onExpandir: (abierto: boolean) => void;
  onSelect: (p: Payment) => void;
}

export function CalendarioDia({ dia, mes, pestana, cercano, sentido, onIrADia, expandido, onExpandir, onSelect }: CalendarioDiaProps) {
  const grupos = dia ? agrupaPorProveedor(dia.pagos) : [];
  const visibles = expandido ? grupos : grupos.slice(0, PROVEEDORES_VISIBLES);
  const resto = expandido ? [] : grupos.slice(PROVEEDORES_VISIBLES);
  const restoPagos = resto.flatMap(g => g.pagos);

  return (
    <section className="rounded-xl border bg-card p-4" aria-label="Pagos del día">
      <p className="mb-2 flex items-center gap-[7px] text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: GOLD }} />
        Pagos del día
      </p>

      {dia ? (
        <div className="mb-3.5">
          <h3 className="flex flex-wrap items-baseline gap-1.5 text-xl font-bold leading-tight tracking-tight">
            {capitaliza(nombreDia(dia.fecha))} {diaDelMes(dia.fecha)}
            <small className="text-sm font-medium text-muted-foreground">de {nombreMes(dia.fecha)}</small>
            {dia.esHoy && <span className="self-center rounded-md bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground">Hoy</span>}
          </h3>
          {dia.pagos.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
              <span className="rounded-md bg-muted px-2.5 py-[3px] font-medium text-muted-foreground">{plural(dia.pagos.length, 'pago')}</span>
              <span className="rounded-md bg-muted px-2.5 py-[3px] font-medium text-muted-foreground">{plural(grupos.length, 'proveedor', 'proveedores')}</span>
              <span className="rounded-md bg-[color:var(--pc-teal-09)] px-2.5 py-[3px] font-mono font-bold text-[color:var(--pc-teal)]">{fmtTotales(dia.totales)}</span>
            </div>
          )}
        </div>
      ) : (
        <h3 className="mb-3.5 text-xl font-bold leading-tight tracking-tight">Sin pagos en {nombreMes(`${mes}-01`)}</h3>
      )}

      {visibles.map(g => <GrupoDelDia key={g.clave} grupo={g} pestana={pestana} onSelect={onSelect} />)}

      {resto.length > 0 && (
        <button
          type="button"
          onClick={() => onExpandir(true)}
          className="flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-[hsl(220_15%_78%)] px-3 py-2.5 font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          <span className="inline-flex items-center gap-1.5">
            <ChevronDown className="h-4 w-4" />
            {plural(resto.length, 'proveedor', 'proveedores')} más · {plural(restoPagos.length, 'pago')}
          </span>
          <span className="font-mono">{fmtTotales(totalesPorMoneda(restoPagos))}</span>
        </button>
      )}
      {expandido && grupos.length > PROVEEDORES_VISIBLES && (
        <button
          type="button"
          onClick={() => onExpandir(false)}
          className="flex w-full items-center gap-1.5 rounded-xl border border-dashed border-[hsl(220_15%_78%)] px-3 py-2.5 font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          <ChevronUp className="h-4 w-4" /> Ver menos
        </button>
      )}

      {(dia ? dia.pagos.length === 0 : cercano) && (
        <div className="rounded-xl bg-muted px-4 py-5 text-center text-muted-foreground">
          {dia && <p>{dia.esHoy ? 'Hoy no hay pagos.' : 'Sin pagos este día.'}</p>}
          {cercano && (
            <button
              type="button"
              onClick={() => onIrADia(cercano.fecha)}
              className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold hover:underline"
              style={{ color: TEAL }}
            >
              {sentido === 'adelante' ? 'El siguiente día con pagos es el' : 'El último día con pagos fue el'} {nombreDia(cercano.fecha)} {diaDelMes(cercano.fecha)} de {nombreMes(cercano.fecha)} · {plural(cercano.n, 'pago')}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
