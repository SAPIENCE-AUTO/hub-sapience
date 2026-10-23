import { useMemo } from 'react';
import { toast } from 'sonner';
import { generateFormularioNombres } from 'zite-endpoints-sdk';
import { useLlamadaLarga } from '@/components/propuestas/useLlamadaLarga';
import { ALERTA } from '@/lib/toolColors';
import { sinNombreCorto } from '@/lib/formularios/tabla';
import type { Definicion } from '@/lib/formularios/tipos';
import { AvanceIA, MarcaIA, botonSecundario } from './comun';

/**
 * Aviso de las preguntas sin nombre corto (su columna en el tablero llevaría
 * la pregunta completa) con el botón para que la IA se los ponga. Los pone el
 * editor como un cambio más: ⌘Z los quita.
 */
export function NombresCortos({ def, ia, onPoner }: {
  def: Definicion;
  ia: { formularioId: string; contarUso: () => void };
  onPoner: (nombres: Record<string, string>) => void;
}) {
  const faltan = useMemo(() => sinNombreCorto(def).length, [def]);
  const llamada = useLlamadaLarga();
  if (!faltan && !llamada.corriendo) return null;

  const poner = async () => {
    try {
      const r = await llamada.correr<{ nombres: Record<string, string> }>(generateFormularioNombres({ formularioId: ia.formularioId, definicion: def }));
      ia.contarUso();
      const n = Object.keys(r.nombres).length;
      if (!n) return;
      onPoner(r.nombres);
      toast.success(`${n === 1 ? 'Nombre corto puesto' : `${n} nombres cortos puestos`}. ⌘Z los quita.`);
    } catch (err) {
      toast.error((err as Error).message || 'La IA no pudo poner los nombres.');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: `${ALERTA}66`, backgroundColor: `${ALERTA}0f`, color: '#8a4b00' }}>
      <span className="min-w-0 flex-1">
        {faltan === 1 ? '1 pregunta sin nombre corto' : `${faltan} preguntas sin nombre corto`}: en el tablero, su columna llevaría la pregunta completa.
      </span>
      {llamada.corriendo
        ? <div className="w-full"><AvanceIA pasos={llamada.pasos} segundos={llamada.segundos} /></div>
        : <button type="button" className={botonSecundario} onClick={poner}><MarcaIA />Ponerlos con IA</button>}
    </div>
  );
}
