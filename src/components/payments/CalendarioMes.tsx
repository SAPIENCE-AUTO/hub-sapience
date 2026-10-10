import { AlertCircle } from 'lucide-react';
import type { GetPaymentsOutputType } from 'zite-endpoints-sdk';
import {
  mezclaConBlanco, PORCENTAJE_CALOR, type Calor, type DiaCalendario, type MesCalendario, type SemanaCalendario,
} from '../../lib/payments/calendario';
import { diaDelMes, nombreDia } from '../../lib/payments/fechas';
import { fmtTotales, fmtMonto, lineasTotales, plural } from '../../lib/payments/formato';
import { PELIGRO, TEAL } from '../../lib/toolColors';

type Payment = GetPaymentsOutputType['payments'][0];

const ETIQUETA_COLUMNA: Record<number, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 0: 'Dom' };
const NIVELES_CALOR: Calor[] = [0, 1, 2, 3, 4];

const TEXTO_DE_APOYO = 'font-mono text-[11.5px] font-medium whitespace-nowrap';

function Lineas({ totales, tinta }: { totales: DiaCalendario<Payment>['totales']; tinta: boolean }) {
  return (
    <>
      {lineasTotales(totales).map(l => (
        <span key={l} className={`block ${TEXTO_DE_APOYO} ${tinta ? 'text-foreground' : 'text-muted-foreground'}`}>{l}</span>
      ))}
    </>
  );
}

function Casilla({ dia, color, seleccionada, onElegir }: {
  dia: DiaCalendario<Payment>;
  color: string;
  seleccionada: boolean;
  onElegir: (fecha: string) => void;
}) {
  const fuera = !dia.enMes;
  const n = dia.pagos.length;
  const clicable = !fuera && n > 0;
  // Con más color de fondo el texto de apoyo pasa de gris a tinta: gris sobre azul medio casi no se lee.
  const tinta = dia.calor >= 3;
  const unico = n === 1 ? dia.pagos[0] : null;
  const etiqueta = fuera
    ? undefined
    : `${nombreDia(dia.fecha)} ${diaDelMes(dia.fecha)}${dia.esHoy ? ', hoy' : ''}: ${n === 0 ? 'sin pagos' : `${plural(n, 'pago')}, ${fmtTotales(dia.totales)}`}${dia.vencidos ? `, ${plural(dia.vencidos, 'vencido')}` : ''}`;

  const anillo = seleccionada
    ? 'ring-2 ring-inset ring-[color:var(--pc-teal)]'
    : fuera ? ''
      : n === 0 ? 'ring-1 ring-inset ring-border'
        : 'hover:ring-2 hover:ring-inset hover:ring-[color:var(--pc-teal-35)]';

  return (
    <button
      type="button"
      disabled={!clicable}
      aria-pressed={clicable ? seleccionada : undefined}
      aria-label={etiqueta}
      onClick={() => onElegir(dia.fecha)}
      className={`flex min-h-[82px] min-w-0 flex-col gap-0.5 rounded-[10px] px-[9px] py-2 text-left transition-shadow ${fuera ? 'text-muted-foreground/60' : n === 0 ? 'bg-card' : ''} ${anillo}`}
      style={clicable ? { backgroundColor: mezclaConBlanco(color, PORCENTAJE_CALOR[dia.calor]) } : undefined}
    >
      <span className="mb-0.5 flex min-h-5 items-center justify-between">
        <span
          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-[3px] text-[13px] font-semibold ${dia.esHoy ? 'text-white' : ''}`}
          style={dia.esHoy ? { backgroundColor: TEAL } : undefined}
        >
          {diaDelMes(dia.fecha)}
        </span>
        {!fuera && dia.vencidos > 0 && (
          <span
            title="Tiene pagos vencidos"
            className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-white"
            style={{ backgroundColor: PELIGRO }}
          >
            <AlertCircle className="h-3 w-3" strokeWidth={2.5} />
          </span>
        )}
      </span>
      {!fuera && unico && (
        <>
          <span className={`block ${unico.poNumber ? 'font-mono text-[11.5px] font-medium' : 'text-xs text-muted-foreground'}`}>{unico.poNumber ?? 'Sin ODC'}</span>
          <span className={`block ${TEXTO_DE_APOYO} ${tinta ? 'text-foreground' : 'text-muted-foreground'}`}>{fmtMonto(unico.amount, unico.currency)}</span>
        </>
      )}
      {!fuera && n > 1 && (
        <>
          <span className="block text-[13px] font-bold">{n} pagos</span>
          <Lineas totales={dia.totales} tinta={tinta} />
        </>
      )}
    </button>
  );
}

function CasillaSemana({ semana, onVer }: { semana: SemanaCalendario<Payment>; onVer: (lunes: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onVer(semana.lunes)}
      aria-label={`Ver la semana del ${semana.etiqueta}${semana.n ? `: ${plural(semana.n, 'pago')}, ${fmtTotales(semana.totales)}` : ', sin pagos'}`}
      className="flex min-h-[82px] min-w-0 flex-col gap-0.5 rounded-[10px] bg-muted px-2.5 py-2 text-left transition-shadow hover:ring-2 hover:ring-inset hover:ring-[color:var(--pc-teal-35)]"
    >
      <span className="mb-0.5 text-[11px] text-muted-foreground/80">{semana.etiqueta}</span>
      {semana.n ? (
        <>
          <span className="block text-[13px] font-bold">{plural(semana.n, 'pago')}</span>
          <Lineas totales={semana.totales} tinta={false} />
          <span className="mt-auto block h-1 overflow-hidden rounded-sm bg-border" aria-hidden>
            <span className="block h-full rounded-sm" style={{ width: `${Math.round(semana.carga * 100)}%`, backgroundColor: TEAL }} />
          </span>
        </>
      ) : (
        <span className={`${TEXTO_DE_APOYO} text-muted-foreground`}>sin pagos</span>
      )}
    </button>
  );
}

/** Los pagos que no tienen fecha no caben en un calendario: se avisa y se lleva a la tabla, donde sí salen. */
export function AvisoSinFecha({ n, onVer }: { n: number; onVer: () => void }) {
  return (
    <button type="button" onClick={onVer} className="text-[11px] font-semibold underline-offset-2 hover:underline" style={{ color: PELIGRO }}>
      {plural(n, 'pago')} sin fecha: no {n === 1 ? 'sale' : 'salen'} en el calendario, solo en la tabla
    </button>
  );
}

export interface CalendarioMesProps {
  mes: MesCalendario<Payment>;
  /** El color en que se pintan los días con pagos (cambia con la pestaña). */
  color: string;
  seleccionado: string | null;
  onElegirDia: (fecha: string) => void;
  onVerSemana: (lunes: string) => void;
  /** Cuántos pagos no tienen fecha y por eso no se pueden poner en el calendario. */
  sinFecha: number;
  onVerSinFecha: () => void;
}

export function CalendarioMes({ mes, color, seleccionado, onElegirDia, onVerSemana, sinFecha, onVerSinFecha }: CalendarioMesProps) {
  const hayVencidos = mes.semanas.some(s => s.dias.some(d => d.enMes && d.vencidos > 0));
  return (
    <>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] gap-[5px]" style={{ gridTemplateColumns: `repeat(${mes.columnas.length}, minmax(0, 1fr)) 118px` }}>
          {mes.columnas.map(c => (
            <span key={c} className="px-1 pb-0.5 text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground/70">{ETIQUETA_COLUMNA[c]}</span>
          ))}
          <span className="px-1 pb-0.5 text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground/70">Semana</span>
          {mes.semanas.map(s => (
            <SemanaFila key={s.lunes} semana={s} color={color} seleccionado={seleccionado} onElegirDia={onElegirDia} onVerSemana={onVerSemana} />
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] text-muted-foreground/80">
        <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
          {hayVencidos && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-[9px] w-[9px] rounded-full" style={{ backgroundColor: PELIGRO }} />
              Tiene pagos vencidos
            </span>
          )}
          {sinFecha > 0 && <AvisoSinFecha n={sinFecha} onVer={onVerSinFecha} />}
        </span>
        <span className="inline-flex items-center gap-1">
          Menos pagos
          {NIVELES_CALOR.map(nivel => (
            <span
              key={nivel}
              className={`inline-block h-3.5 w-3.5 rounded ${nivel === 0 ? 'bg-card ring-1 ring-inset ring-border' : ''}`}
              style={nivel === 0 ? undefined : { backgroundColor: mezclaConBlanco(color, PORCENTAJE_CALOR[nivel]) }}
            />
          ))}
          Más pagos
        </span>
      </div>
    </>
  );
}

function SemanaFila({ semana, color, seleccionado, onElegirDia, onVerSemana }: {
  semana: SemanaCalendario<Payment>;
  color: string;
  seleccionado: string | null;
  onElegirDia: (fecha: string) => void;
  onVerSemana: (lunes: string) => void;
}) {
  return (
    <>
      {semana.dias.map(d => (
        <Casilla key={d.fecha} dia={d} color={color} seleccionada={d.fecha === seleccionado} onElegir={onElegirDia} />
      ))}
      <CasillaSemana semana={semana} onVer={onVerSemana} />
    </>
  );
}
