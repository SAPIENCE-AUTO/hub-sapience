import { Fragment, type ReactNode } from 'react';
import { Check, ChevronRight, CircleDashed } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ALERTA, EXITO, GRIS, INFO, TEAL } from '@/lib/toolColors';
import type { Chequeo } from '@/lib/formularios/listo';
import { botonTeal } from './generador/comun';

export type EstadoEditable = 'borrador' | 'prueba' | 'cerrado';

const PASOS = [
  { id: 'borrador', nombre: 'Borrador' },
  { id: 'prueba', nombre: 'Prueba' },
  { id: 'en_vivo', nombre: 'En vivo' },
] as const;

/** Qué significa el estado, en una línea. */
export const EXPLICA_ESTADO: Record<string, string> = {
  borrador: 'Nadie lo puede contestar todavía.',
  prueba: 'El enlace ya funciona para probarlo: lo que entra queda marcado como prueba.',
  en_vivo: 'Lo contestan participantes reales.',
  cerrado: 'Ya no recibe respuestas; lo que entró se queda.',
};

/** Borrador › Prueba › En vivo: dónde va el filtro. */
export function PasosEstado({ estado }: { estado: string }) {
  const actual = PASOS.findIndex((p) => p.id === estado);
  return (
    <ol className="flex items-center gap-1 text-xs" aria-label="Estado del filtro">
      {PASOS.map((p, i) => {
        const hecho = actual > i || estado === 'cerrado';
        const aqui = actual === i;
        return (
          <Fragment key={p.id}>
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />}
            <li
              aria-current={aqui ? 'step' : undefined}
              title={p.id === 'en_vivo' ? 'Llega con la fase 5' : undefined}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${aqui ? 'text-white' : ''}`}
              style={aqui ? { backgroundColor: TEAL } : { color: hecho ? TEAL : GRIS }}
            >
              {hecho && <Check className="h-3 w-3" />}
              {p.nombre}
            </li>
          </Fragment>
        );
      })}
      {estado === 'cerrado' && (
        <li className="ml-1 rounded-full px-2 py-0.5 font-semibold text-white" style={{ backgroundColor: INFO }}>Cerrado</li>
      )}
    </ol>
  );
}

function EstaListo({ chequeos }: { chequeos: Chequeo[] }) {
  const faltan = chequeos.filter((c) => !c.ok).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex items-center gap-1 rounded font-medium underline-offset-2 hover:underline" style={{ color: TEAL }}>
          {faltan
            ? <><CircleDashed className="h-3.5 w-3.5" style={{ color: ALERTA }} />¿Está listo? Faltan {faltan}</>
            : <><Check className="h-3.5 w-3.5" style={{ color: EXITO }} />Listo para participantes</>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] text-sm">
        <p className="mb-2 font-semibold" style={{ color: TEAL }}>Antes de abrirlo a participantes</p>
        <ul className="space-y-1.5">
          {chequeos.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              {c.ok
                ? <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" style={{ color: EXITO }} />
                : <CircleDashed className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" style={{ color: ALERTA }} />}
              <span className="min-w-0">
                <span className={c.ok ? 'text-muted-foreground' : 'font-medium text-[#1F1F23]'}>{c.texto}</span>
                {!c.ok && c.falta && <span className="block text-xs text-muted-foreground">{c.falta}</span>}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">«En vivo» llega con la fase 5.</p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * La línea bajo el título: qué significa el estado, «¿Está listo?» y el paso
 * que sigue. Lo demás (volver a borrador, cerrar, el enlace) va en el menú «⋯».
 */
export function LineaEstado({ estado, chequeos, onEstado, extra }: {
  estado: string;
  chequeos: Chequeo[];
  onEstado: (e: EstadoEditable) => void;
  /** Lo que se agrega al final de la línea (el enlace en prueba, un aviso del NSE). */
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      <span>{EXPLICA_ESTADO[estado]}</span>
      {estado !== 'cerrado' && <EstaListo chequeos={chequeos} />}
      {estado === 'borrador' && <button type="button" className={`${botonTeal} !px-2.5 !py-1 !text-xs`} onClick={() => onEstado('prueba')}>Pasar a prueba</button>}
      {estado === 'cerrado' && <button type="button" className={`${botonTeal} !px-2.5 !py-1 !text-xs`} onClick={() => onEstado('prueba')}>Reabrir en prueba</button>}
      {extra}
    </div>
  );
}
