import { Fragment, useState, type ReactNode } from 'react';
import { Check, ChevronRight, CircleDashed } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ALERTA, EXITO, GRIS, INFO, TEAL } from '@/lib/toolColors';
import type { Chequeo } from '@/lib/formularios/listo';
import { botonTeal } from './generador/comun';

export type EstadoEditable = 'borrador' | 'prueba' | 'en_vivo' | 'cerrado';

const PASOS = [
  { id: 'borrador', nombre: 'Borrador' },
  { id: 'prueba', nombre: 'Prueba' },
  { id: 'en_vivo', nombre: 'En vivo' },
] as const;

/** Qué significa el estado, en una línea. */
export const EXPLICA_ESTADO: Record<string, string> = {
  borrador: 'Nadie lo puede contestar todavía.',
  prueba: 'El enlace ya funciona para probarlo: lo que entra queda marcado como prueba.',
  en_vivo: 'Lo contestan participantes reales. Lo que cambies en el filtro lo ven al momento.',
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
        <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">Lo que falte no impide abrirlo en vivo.</p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * La línea bajo el título: qué significa el estado, «¿Está listo?» y el paso
 * que sigue. Lo demás (volver a borrador, cerrar, el enlace) va en el menú «⋯».
 */
export function LineaEstado({ estado, chequeos, hayReales, onEstado, extra }: {
  estado: string;
  chequeos: Chequeo[];
  /** Con respuestas reales, al reabrir vuelve en vivo (no en prueba). */
  hayReales: boolean;
  onEstado: (e: EstadoEditable) => void;
  /** Lo que se agrega al final de la línea (el enlace en prueba, un aviso del NSE). */
  extra?: ReactNode;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const boton = `${botonTeal} !px-2.5 !py-1 !text-xs`;
  const faltan = chequeos.filter((c) => !c.ok);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      <span>{EXPLICA_ESTADO[estado]}</span>
      {estado !== 'cerrado' && estado !== 'en_vivo' && <EstaListo chequeos={chequeos} />}
      {estado === 'borrador' && <button type="button" className={boton} onClick={() => onEstado('prueba')}>Pasar a prueba</button>}
      {estado === 'prueba' && <button type="button" className={boton} onClick={() => setConfirmar(true)}>Abrir en vivo</button>}
      {estado === 'cerrado' && <button type="button" className={boton} onClick={() => onEstado(hayReales ? 'en_vivo' : 'prueba')}>{hayReales ? 'Reabrir en vivo' : 'Reabrir en prueba'}</button>}
      {extra}

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Abrirlo a participantes reales?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <ul className="list-disc space-y-1 pl-5">
                  <li>El formulario ya no dice «Prueba» y lo que entre cuenta como real.</li>
                  <li>«Borrar pruebas» nunca toca las respuestas reales.</li>
                  <li>Lo que cambies en el filtro lo ven los participantes al momento.</li>
                  <li>Las que califican se pasan al tablero desde Respuestas, como ahora.</li>
                </ul>
                {faltan.length > 0 && (
                  <p style={{ color: ALERTA }}>Del «¿Está listo?» falta{faltan.length === 1 ? '' : 'n'}: {faltan.map((c) => c.texto.toLowerCase()).join(', ')}.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Todavía no</AlertDialogCancel>
            <AlertDialogAction onClick={() => onEstado('en_vivo')}>Abrir en vivo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
