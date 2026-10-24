import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ALERTA, EXITO, PELIGRO, TEAL } from '@/lib/toolColors';
import { evaluar, explicarResultado } from '@/lib/formularios/motor';
import type { Definicion, Resultado } from '@/lib/formularios/tipos';
import { Participante } from '../Participante';
import { marcoTelefono } from './MuestraCelular';

/**
 * Vista Celular: el formulario tal cual lo contesta un participante, con lo
 * que está en pantalla aunque no se haya guardado. No guarda nada: al
 * terminar, el resultado se calcula aquí mismo con el motor (el mismo que usa
 * el servidor) y se dice si calificaría y por qué.
 */
export function VistaCelular({ def, conProblemas }: { def: Definicion; conProblemas: boolean }) {
  const [vuelta, setVuelta] = useState(0);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const semilla = useMemo(() => `editor-${vuelta}-${Math.random()}`, [vuelta]);
  const nombreFrente = (id: string) => def.frentes?.find((f) => f.id === id)?.nombre ?? id;
  const reiniciar = () => { setResultado(null); setVuelta((v) => v + 1); };

  return (
    <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-start lg:justify-center">
      <div className={`h-[min(780px,calc(100vh-11rem))] min-h-[560px] w-[390px] max-w-full flex-shrink-0 ${marcoTelefono}`}>
        <Participante
          key={vuelta}
          def={def}
          prueba
          codigo=""
          semilla={semilla}
          modo="marco"
          onEnviar={async (respuestas) => setResultado(evaluar(def, respuestas))}
          onOtraVez={reiniciar}
        />
      </div>
      <aside className="w-full max-w-sm space-y-3 text-sm">
        <p className="font-semibold" style={{ color: TEAL }}>Prueba en celular</p>
        <p className="text-muted-foreground">Es el formulario tal cual lo verá un participante, con los cambios que llevas aunque no se hayan guardado. No se guarda ninguna respuesta y las fotos no se suben.</p>
        {conProblemas && <p style={{ color: ALERTA }}>Hay cosas por corregir en el filtro: puede que algo no se vea como esperas.</p>}
        {resultado && (
          <div className="rounded-lg border p-3">
            <p className="font-semibold" style={{ color: resultado.califica ? EXITO : PELIGRO }}>
              {resultado.califica ? 'Calificaría' : resultado.incompleto ? 'Quedó incompleta' : 'No calificaría'}
            </p>
            {resultado.frentes.length > 0 && <p className="mt-1">Perfiles: {resultado.frentes.map(nombreFrente).join(', ')}</p>}
            {!resultado.califica && explicarResultado(resultado) && <p className="mt-1 text-muted-foreground">{explicarResultado(resultado)}</p>}
            {resultado.nse && <p className="mt-1 text-muted-foreground">NSE {resultado.nse.nivel} ({resultado.nse.puntos} puntos)</p>}
            {resultado.alertas.map((a) => <p key={a} className="mt-1" style={{ color: ALERTA }}>⚠ {a}</p>)}
          </div>
        )}
        <Button size="sm" variant="outline" onClick={reiniciar}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Empezar de nuevo</Button>
      </aside>
    </div>
  );
}
