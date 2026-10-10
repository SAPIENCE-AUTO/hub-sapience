import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import type { GetPaymentsOutputType } from 'zite-endpoints-sdk';
import {
  construyeMes, construyeSemana, diaCercano, diaDelPanel, indexaPorDia, mesInicial, sentidoDe, textoResumen, tituloSemana,
  vencidosPrevios,
} from '../../lib/payments/calendario';
import { fmtFechaLarga, lunesDe, mesDe, nombreMes, sumaDias, sumaMeses } from '../../lib/payments/fechas';
import { fmtTotales, capitaliza } from '../../lib/payments/formato';
import type { Pestana } from '../../lib/payments/types';
import type { ClaveGrupo } from '../../lib/payments/urgencia';
import { PELIGRO } from '../../lib/toolColors';
import { CalendarioDia } from './CalendarioDia';
import { AvisoSinFecha, CalendarioMes } from './CalendarioMes';
import { CalendarioSemana } from './CalendarioSemana';
import { COLOR_RAMPA, FONDO_PELIGRO, VARIABLES_PAGOS } from './estilos';
import { Segmentado } from './Segmentado';

type Payment = GetPaymentsOutputType['payments'][0];
type Vista = 'mes' | 'semana';

const VISTAS = [
  { valor: 'mes', etiqueta: 'Mes' },
  { valor: 'semana', etiqueta: 'Semana' },
] as const;

function BotonRedondo({ etiqueta, onClick, children }: { etiqueta: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      onClick={onClick}
      className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border bg-card transition-colors hover:bg-muted"
    >
      {children}
    </button>
  );
}

export interface PaymentsCalendarProps {
  /** Los pagos ya filtrados por pestaña, búsqueda, proveedor y proyecto. */
  payments: Payment[];
  pestana: Pestana;
  hoy: string;
  onSelect: (p: Payment) => void;
  /** Lleva a la tabla con ese grupo abierto (los vencidos que no caben en el calendario, los que no tienen fecha). */
  onVerEnTabla: (grupo: ClaveGrupo) => void;
}

export function PaymentsCalendar({ payments, pestana, hoy, onSelect, onVerEnTabla }: PaymentsCalendarProps) {
  const ctx = useMemo(() => ({ pestana, hoy }), [pestana, hoy]);
  const indice = useMemo(() => indexaPorDia(payments, pestana), [payments, pestana]);

  // En un teléfono la cuadrícula del mes se desplaza de lado; ahí es más cómoda la semana, un día por renglón.
  const [vista, setVista] = useState<Vista>(() => (typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? 'semana' : 'mes'));
  const [mes, setMes] = useState(() => mesInicial(indice, hoy));
  const [semana, setSemana] = useState(() => lunesDe(hoy));
  const [elegido, setElegido] = useState<string | null>(null);
  const [expandido, setExpandido] = useState(false);

  const datosMes = useMemo(() => construyeMes(indice, mes, ctx), [indice, mes, ctx]);
  const datosSemana = useMemo(() => construyeSemana(indice, semana, ctx), [indice, semana, ctx]);
  const sentido = sentidoDe(pestana);
  const diaPanel = useMemo(() => diaDelPanel(datosMes, elegido, hoy, sentido), [datosMes, elegido, hoy, sentido]);

  const esMes = vista === 'mes';
  const desde = esMes ? `${mes}-01` : semana;
  const previos = useMemo(() => vencidosPrevios(payments, desde, ctx), [payments, desde, ctx]);
  // Si no hay pagos ese día, se ofrece el día con pagos más cercano (sin día a la vista, el más cercano al mes).
  const cercano = useMemo(() => {
    if (diaPanel && diaPanel.pagos.length > 0) return null;
    const desde = diaPanel?.fecha ?? (sentido === 'adelante' ? sumaDias(`${mes}-01`, -1) : `${mes}-01`);
    return diaCercano(indice, desde, sentido);
  }, [indice, diaPanel, mes, sentido]);

  const elegirDia = (fecha: string) => { setElegido(fecha); setExpandido(false); };
  const irADia = (fecha: string) => { setVista('mes'); setMes(mesDe(fecha)); elegirDia(fecha); };
  const verSemana = (lunes: string) => { setSemana(lunes); setVista('semana'); };
  const cambiarVista = (v: Vista) => {
    if (v === 'semana' && esMes) setSemana(lunesDe(diaPanel?.fecha ?? `${mes}-01`));
    // una semana pertenece al mes de su jueves (como en el calendario ISO)
    if (v === 'mes' && !esMes) setMes(mesDe(sumaDias(semana, 3)));
    setVista(v);
  };
  const anterior = () => (esMes ? setMes(sumaMeses(mes, -1)) : setSemana(sumaDias(semana, -7)));
  const siguientePeriodo = () => (esMes ? setMes(sumaMeses(mes, 1)) : setSemana(sumaDias(semana, 7)));
  const irAHoy = () => {
    if (esMes) { setMes(mesDe(hoy)); elegirDia(hoy); } else setSemana(lunesDe(hoy));
  };

  const titulo = esMes ? capitaliza(nombreMes(`${mes}-01`)) : tituloSemana(datosSemana.dias);
  const anio = esMes ? mes.slice(0, 4) : null;
  const subtitulo = esMes
    ? textoResumen(datosMes.n, datosMes.totales, pestana, 'mes')
    : textoResumen(datosSemana.n, datosSemana.totales, pestana, 'semana');

  return (
    <div className="space-y-3" style={VARIABLES_PAGOS}>
      <section className="rounded-xl border bg-card p-4" aria-label={esMes ? 'Calendario del mes' : 'Calendario de la semana'}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold leading-tight tracking-tight">
              {titulo}
              {anio && <span className="ml-2 font-medium text-muted-foreground/70">{anio}</span>}
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitulo}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <BotonRedondo etiqueta={esMes ? 'Mes anterior' : 'Semana anterior'} onClick={anterior}><ChevronLeft className="h-4 w-4" /></BotonRedondo>
            <BotonRedondo etiqueta={esMes ? 'Mes siguiente' : 'Semana siguiente'} onClick={siguientePeriodo}><ChevronRight className="h-4 w-4" /></BotonRedondo>
            <button
              type="button"
              onClick={irAHoy}
              className="inline-flex h-[30px] items-center rounded-full border bg-card px-3.5 text-xs font-semibold transition-colors hover:bg-muted"
            >
              Hoy
            </button>
            <div className="ml-1.5">
              <Segmentado opciones={VISTAS} valor={vista} onCambio={cambiarVista} etiqueta="Vista del calendario" sobre="tarjeta" />
            </div>
          </div>
        </div>

        {previos.n > 0 && (
          <div
            className="my-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5"
            style={{ backgroundColor: FONDO_PELIGRO, borderColor: `${PELIGRO}47`, color: PELIGRO }}
          >
            <span className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full text-white" style={{ backgroundColor: PELIGRO }}>
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div className="min-w-[180px] flex-1">
              <p className="font-bold">
                {previos.n} vencido{previos.n === 1 ? '' : 's'} de {esMes ? 'meses' : 'semanas'} anteriores
              </p>
              <p className="text-xs opacity-90">
                {fmtTotales(previos.totales)} · el más viejo, {fmtFechaLarga(previos.masViejo, hoy)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onVerEnTabla('vencidos')}
              className="inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-bold hover:underline"
            >
              Verlos en la tabla <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {esMes ? (
          <div className={previos.n > 0 ? '' : 'mt-3.5'}>
            <CalendarioMes
              mes={datosMes}
              color={COLOR_RAMPA[pestana]}
              seleccionado={diaPanel?.fecha ?? null}
              onElegirDia={elegirDia}
              onVerSemana={verSemana}
              sinFecha={indice.sinFecha.length}
              onVerSinFecha={() => onVerEnTabla('sinFecha')}
            />
          </div>
        ) : (
          <div className={previos.n > 0 ? '' : 'mt-3.5'}>
            <CalendarioSemana semana={datosSemana} hoy={hoy} onSelect={onSelect} />
            {indice.sinFecha.length > 0 && (
              <div className="mt-3"><AvisoSinFecha n={indice.sinFecha.length} onVer={() => onVerEnTabla('sinFecha')} /></div>
            )}
          </div>
        )}
      </section>

      {esMes && (
        <CalendarioDia
          dia={diaPanel}
          mes={mes}
          pestana={pestana}
          cercano={cercano}
          sentido={sentido}
          onIrADia={irADia}
          expandido={expandido}
          onExpandir={setExpandido}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}
