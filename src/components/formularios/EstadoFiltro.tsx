import { useState, type ReactNode } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ALERTA } from '@/lib/toolColors';
import type { Chequeo } from '@/lib/formularios/listo';
import { botonTeal } from './generador/comun';
import type { PasoFiltro } from './Recorrido';

export type EstadoEditable = 'borrador' | 'prueba' | 'en_vivo' | 'cerrado';

export const NOMBRE_ESTADO: Record<string, string> = { borrador: 'Borrador', prueba: 'Prueba', en_vivo: 'En vivo', cerrado: 'Cerrado' };

/** Qué toca hacer en cada paso, en una línea. */
function queToca(paso: PasoFiltro, estado: string, escribiendo: boolean): string {
  if (estado === 'cerrado') return 'Ya no recibe respuestas; lo que entró se queda.';
  switch (paso) {
    case 'insumos': return 'Agrega las notas, la propuesta o el kick-off y pide la estructura.';
    case 'estructura': return 'Revisa la estructura: comenta lo que quieras cambiar y apruébala para escribir las preguntas.';
    case 'preguntas': return escribiendo
      ? 'La IA está escribiendo las preguntas; ya puedes revisar las que llegaron.'
      : 'Revisa el filtro. Cuando esté listo, pásalo a prueba y contéstalo desde el enlace.';
    case 'probar': return 'Contéstalo desde el enlace y vincula el tablero en Reclutar. Lo que entra queda como prueba.';
    case 'reclutar': return 'Lo contestan participantes reales.';
  }
}

/**
 * Bajo el camino de pasos: qué toca hacer y el único botón del paso (pasar a
 * prueba, abrir en vivo, reabrir). En insumos y estructura el botón está en
 * su pantalla, junto a lo que se llena. `derecha`: «Por revisar».
 */
export function AccionPaso({ paso, estado, escribiendo, hayReales, chequeos, onEstado, extra, derecha }: {
  paso: PasoFiltro;
  estado: string;
  escribiendo: boolean;
  /** Con respuestas reales, al reabrir vuelve en vivo (no en prueba). */
  hayReales: boolean;
  chequeos: Chequeo[];
  onEstado: (e: EstadoEditable) => void;
  /** Lo que se agrega a la línea (un aviso del NSE). */
  extra?: ReactNode;
  derecha?: ReactNode;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const boton = `${botonTeal} !px-3 !py-1.5 !text-xs whitespace-nowrap`;
  const faltan = chequeos.filter((c) => !c.ok);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[#EDEDF0] pt-2.5 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 basis-full sm:basis-0">{queToca(paso, estado, escribiendo)}{extra && <> · {extra}</>}</span>
      {derecha}
      {paso === 'preguntas' && estado === 'borrador' && (
        <button type="button" className={boton} disabled={escribiendo} onClick={() => onEstado('prueba')}>Pasar a prueba</button>
      )}
      {estado === 'prueba' && <button type="button" className={boton} onClick={() => setConfirmar(true)}>Abrir en vivo</button>}
      {estado === 'cerrado' && (
        <button type="button" className={boton} onClick={() => onEstado(hayReales ? 'en_vivo' : 'prueba')}>{hayReales ? 'Reabrir en vivo' : 'Reabrir en prueba'}</button>
      )}

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Abrirlo a participantes reales?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <ul className="list-disc space-y-1 pl-5">
                  <li>El formulario ya no dice «Prueba» y lo que entre cuenta como real.</li>
                  <li>«Borrar pruebas» nunca toca las respuestas reales.</li>
                  <li>Si después cambias algo, se guarda aparte y los participantes lo ven hasta que lo publiques.</li>
                  <li>Las que califican se pasan al tablero desde Reclutar.</li>
                </ul>
                {faltan.length > 0 && (
                  <p style={{ color: ALERTA }}>De «Por revisar» falta{faltan.length === 1 ? '' : 'n'}: {faltan.map((c) => c.texto.toLowerCase()).join(', ')}.</p>
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
