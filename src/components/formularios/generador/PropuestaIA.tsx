import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, X } from 'lucide-react';
import { generateFormularioCambio } from 'zite-endpoints-sdk';
import { useLlamadaLarga } from '@/components/propuestas/useLlamadaLarga';
import { ALERTA, PELIGRO, TEAL } from '@/lib/toolColors';
import { aplicarParche, type Parche } from '@/lib/formularios/ia';
import { logicaDeOpcion, logicaDePregunta, ubicar } from '@/lib/formularios/palabras';
import { opcionesDe } from '@/lib/formularios/tabla';
import { TIPOS, type Definicion } from '@/lib/formularios/tipos';
import { COLOR_LOGICA, useDoc } from '../editor/comun';
import { AvanceIA, MarcaIA, botonSecundario, botonTeal } from './comun';

export type AlcanceIA = { pregunta: string } | { seccion: string } | { frentes: true };

interface Propuesta { parche: Parche; explicacion: string; cambios: string[]; avisos: string[]; problemas: string[] }

/** La pregunta como quedaría, con su lógica en palabras. */
function PreguntaPropuesta({ def, id }: { def: Definicion; id: string }) {
  const p = ubicar(def, id)?.pregunta;
  if (!p) return null;
  const lineas = logicaDePregunta(def, p);
  return (
    <div className="rounded-md border bg-white px-3 py-2">
      <p className="text-[14px] font-semibold leading-snug text-[#1F1F23]">{p.texto}</p>
      {p.ayuda && <p className="text-[12.5px] text-muted-foreground">{p.ayuda}</p>}
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{TIPOS[p.tipo]?.nombre ?? p.tipo}</p>
      {p.filas?.length ? <p className="mt-1 text-[12.5px] text-[#45454D]">Filas: {p.filas.map((f) => f.label).join(' · ')}</p> : null}
      {opcionesDe(def, p).length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {opcionesDe(def, p).map((o) => (
            <li key={o.id} className="text-[13px] text-[#45454D]">
              <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full border border-[#71717A] align-middle" />{o.label}
              {logicaDeOpcion(def, p, o).map((l, i) => <span key={i} className="ml-2 text-[12px]" style={{ color: COLOR_LOGICA[l.tipo] }}>↳ {l.texto}</span>)}
            </li>
          ))}
        </ul>
      )}
      {lineas.map((l, i) => <p key={i} className="mt-0.5 text-[12px]" style={{ color: COLOR_LOGICA[l.tipo] }}>↳ {l.texto}</p>)}
    </div>
  );
}

/**
 * Pedirle un cambio a la IA con tus palabras: en una pregunta (botón IA) o en
 * la lógica de una sección o de los frentes (Comentar). Primero se ve la
 * propuesta: qué agrega, qué quita y si rompe lógica de otra parte. «Aplicar»
 * la deja como un cambio más del editor (se deshace con ⌘Z).
 */
export function PropuestaIA({ alcance, onCerrar }: { alcance: AlcanceIA; onCerrar: () => void }) {
  const { def, aplicar, ia } = useDoc();
  const [pedido, setPedido] = useState('');
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null);
  const llamada = useLlamadaLarga();
  const pedidoRef = useRef<HTMLTextAreaElement>(null);
  const esPregunta = 'pregunta' in alcance;
  const despues = useMemo(() => (propuesta ? aplicarParche(def, propuesta.parche) : null), [propuesta, def]);

  if (!ia) return null;

  const proponer = async () => {
    if (!pedido.trim()) return;
    try {
      const r = await llamada.correr<Propuesta>(generateFormularioCambio({ formularioId: ia.formularioId, definicion: def, alcance, pedido: pedido.trim() }));
      ia.contarUso();
      setPropuesta(r);
    } catch (err) {
      toast.error((err as Error).message || 'La IA no pudo proponer el cambio.');
    }
  };

  const aplicarPropuesta = () => {
    if (!propuesta) return;
    aplicar((d) => aplicarParche(d, propuesta.parche));
    toast.success('Cambio aplicado. ⌘Z lo deshace.');
    onCerrar();
  };

  const titulo = esPregunta ? 'Pedir un cambio a la IA' : 'frentes' in alcance ? 'Comentar los frentes y cuotas' : 'Comentar la lógica de esta sección';
  const ayuda = esPregunta
    ? 'Por ejemplo: «agrega Costco y quita Farmacia», «que termine si contesta Nunca», «hazla de opción única».'
    : 'El orden, qué aparece según qué, los descartes, las cuotas o quién entra a cada frente. Por ejemplo: «los de 18 a 24 no deben ver la sección de hijos».';

  return (
    <div className="mt-2 rounded-lg border border-[#0F3D4D]/25 bg-[#0F3D4D]/[0.03] p-3 text-sm" onClick={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center gap-2">
        <MarcaIA />
        <span className="text-xs font-semibold" style={{ color: TEAL }}>{titulo}</span>
        <button type="button" aria-label="Cerrar" onClick={onCerrar} className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
      </div>

      {!propuesta && (
        <>
          <textarea
            ref={pedidoRef}
            autoFocus
            rows={2}
            value={pedido}
            disabled={llamada.corriendo}
            onChange={(e) => setPedido(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void proponer(); }
              if (e.key === 'Escape') onCerrar();
            }}
            placeholder={ayuda}
            className="w-full resize-y rounded-md border bg-white px-2.5 py-1.5 text-[13px] leading-snug outline-none focus:border-[#0F3D4D]/50"
          />
          {llamada.corriendo
            ? <div className="mt-2"><AvanceIA pasos={llamada.pasos} segundos={llamada.segundos} /></div>
            : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className={botonTeal} disabled={!pedido.trim()} onClick={proponer}>Ver la propuesta</button>
                <span className="text-[11px] text-muted-foreground">⌘Enter · no cambia nada hasta que la apliques</span>
              </div>
            )}
        </>
      )}

      {propuesta && despues && (
        <div className="space-y-2">
          {propuesta.explicacion && <p className="text-[13px] text-[#1F1F23]">{propuesta.explicacion}</p>}
          {propuesta.cambios.length > 0
            ? <ul className="space-y-0.5">{propuesta.cambios.map((c, i) => <li key={i} className="text-[12.5px] text-[#45454D]">· {c}</li>)}</ul>
            : <p className="text-[12.5px] text-muted-foreground">La propuesta no cambia nada.</p>}
          {propuesta.avisos.length > 0 && (
            <div className="rounded-md border px-2.5 py-1.5" style={{ borderColor: `${ALERTA}66`, backgroundColor: `${ALERTA}0d` }}>
              <p className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#8a4b00' }}><AlertTriangle className="h-3.5 w-3.5" />Toca la lógica de otra parte</p>
              {propuesta.avisos.map((a, i) => <p key={i} className="text-[12.5px] text-[#45454D]">{a}</p>)}
            </div>
          )}
          {propuesta.problemas.length > 0 && (
            <div className="rounded-md border px-2.5 py-1.5" style={{ borderColor: `${PELIGRO}55`, backgroundColor: `${PELIGRO}0a` }}>
              <p className="text-xs font-semibold" style={{ color: PELIGRO }}>Quedaría mal armado (si la aplicas, no se guarda hasta corregirlo):</p>
              {propuesta.problemas.map((a, i) => <p key={i} className="text-[12.5px] text-[#45454D]">{a}</p>)}
            </div>
          )}
          {esPregunta && <PreguntaPropuesta def={despues} id={alcance.pregunta} />}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" className={botonTeal} disabled={!propuesta.cambios.length} onClick={aplicarPropuesta}>Aplicar</button>
            <button type="button" className={botonSecundario} onClick={() => { setPropuesta(null); requestAnimationFrame(() => pedidoRef.current?.focus()); }}>Pedir otra cosa</button>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={onCerrar}>Descartar</button>
          </div>
        </div>
      )}
    </div>
  );
}
