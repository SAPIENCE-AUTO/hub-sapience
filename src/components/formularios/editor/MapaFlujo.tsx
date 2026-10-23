import { Fragment } from 'react';
import { PELIGRO, TEAL } from '@/lib/toolColors';
import { filasFlujo, type BloqueFlujo } from '@/lib/formularios/flujo';
import type { Definicion } from '@/lib/formularios/tipos';
import { SECCION_PERFILES } from './comun';
import { ConMarcador } from './TextoEditable';

const LINEA = 'bg-[#0F3D4D]/30';
const plural = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`;
/** Los motivos, cortos: los dos primeros y cuántos más (todos van en el título). */
const motivos = (lista: string[]) => `${lista.slice(0, 2).join(' · ')}${lista.length > 2 ? ` · y ${lista.length - 2} más` : ''}`;

/** Línea hacia abajo con su punta. */
function Flecha({ className = 'h-5' }: { className?: string }) {
  return (
    <div aria-hidden className="flex flex-col items-center">
      <span className={`w-px ${LINEA} ${className}`} />
      <span className="h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-[#0F3D4D]/40" />
    </div>
  );
}

/** Lo que dice una caja bajo su título: si se repite, cuándo aparece o qué es. */
function Detalle({ b }: { b: BloqueFlujo }) {
  const lineas: string[] = [];
  if (b.repiteDe) lineas.push(`↻ uno por cada opción de ${b.repiteDe}`);
  if (b.condicion) lineas.push(b.condicion);
  if (b.nse) lineas.push('NSE oficial: solo alerta');
  if (!lineas.length) lineas.push(b.soloContenido ? 'Pantalla de texto' : plural(b.preguntas, 'pregunta', 'preguntas'));
  return <>{lineas.map((l) => <span key={l} className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{l}</span>)}</>;
}

/** Un paso del filtro. `adentro`: lo que termina va en la caja (en las ramas y en celular). */
function Caja({ b, onIr, adentro }: { b: BloqueFlujo; onIr: (id: string) => void; adentro: 'siempre' | 'celular' }) {
  const rama = !!b.condicion || !!b.repite;
  const titulo = [b.termina.length ? `Termina si: ${b.termina.join(' · ')}` : '', b.descarta.length ? `No cuenta el bloque si: ${b.descarta.join(' · ')}` : ''].filter(Boolean).join('\n');
  return (
    <button
      type="button"
      onClick={() => onIr(b.id)}
      title={titulo || undefined}
      className={`w-full rounded-lg border bg-white px-3 py-2 text-center transition-colors hover:border-[#0F3D4D]/60 hover:bg-[#0F3D4D]/[0.03] ${rama ? 'border-dashed border-[#0F3D4D]/40' : 'border-[#0F3D4D]/25'}`}
    >
      <span className="block text-[13.5px] font-semibold leading-snug text-[#1F1F23]"><ConMarcador texto={b.titulo} /></span>
      <Detalle b={b} />
      {b.termina.length > 0 && (
        <span className={`mt-1 text-[11.5px] leading-snug ${adentro === 'celular' ? 'block sm:hidden' : 'block'}`} style={{ color: PELIGRO }}>
          <span className="line-clamp-1">Termina: {motivos(b.termina)}</span>
        </span>
      )}
      {b.descarta.length > 0 && (
        <span className="mt-0.5 block text-[11.5px] leading-snug text-[#8a4b00]">
          <span className="line-clamp-1">No cuenta el bloque: {motivos(b.descarta)}</span>
        </span>
      )}
    </button>
  );
}

/** Media línea horizontal arriba o abajo de una rama, para unirla con las de al lado. */
function Union({ j, total, abajo }: { j: number; total: number; abajo?: boolean }) {
  if (total < 2) return null;
  const lado = j === 0 ? 'left-1/2 right-0' : j === total - 1 ? 'left-0 right-1/2' : 'left-0 right-0';
  return <span aria-hidden className={`absolute h-px ${LINEA} ${lado} ${abajo ? 'bottom-0' : 'top-0'}`} />;
}

/**
 * El flujo como diagrama de proceso: los pasos de arriba abajo, las salidas
 * donde alguien termina a la derecha en rojo, las ramas que solo aparecen si
 * aplica lado a lado (punteadas) y los bloques que se repiten con ↻; al final,
 * los perfiles con su cuota. Un clic lleva a esa parte del documento.
 */
export function MapaFlujo({ def, onIr }: { def: Definicion; onIr: (seccionId: string) => void }) {
  const filas = filasFlujo(def);
  const perfiles = def.frentes ?? [];
  return (
    <div className="mx-auto max-w-3xl">
      {filas.map((f, i) => (
        <Fragment key={f.tipo === 'paso' ? f.bloque.id : f.ramas[0][0].id}>
          {i > 0 && <Flecha />}
          {f.tipo === 'paso' ? (
            <div className="grid grid-cols-1 items-center sm:grid-cols-[1fr_minmax(0,15rem)_1fr]">
              <span className="hidden sm:block" />
              <div className="mx-auto w-full max-w-[15rem]"><Caja b={f.bloque} onIr={onIr} adentro="celular" /></div>
              {f.bloque.termina.length > 0 && (
                <div className="hidden min-w-0 items-center sm:flex">
                  <span aria-hidden className="h-px w-6 flex-shrink-0" style={{ backgroundColor: `${PELIGRO}99` }} />
                  <span aria-hidden className="h-0 w-0 flex-shrink-0 border-y-[4px] border-l-[5px] border-y-transparent" style={{ borderLeftColor: `${PELIGRO}99` }} />
                  <span
                    title={f.bloque.termina.join(' · ')}
                    className="ml-1 min-w-0 rounded-md border px-2 py-1 text-[11.5px] leading-snug"
                    style={{ borderColor: `${PELIGRO}55`, backgroundColor: `${PELIGRO}0a`, color: PELIGRO }}
                  >
                    <span className="line-clamp-3">Termina: {motivos(f.bloque.termina)}</span>
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex justify-center">
              {f.ramas.map((r, j) => (
                <div key={r[0].id} className="relative flex w-full min-w-0 max-w-[15rem] flex-1 flex-col items-center px-1.5 sm:px-3">
                  <Union j={j} total={f.ramas.length} />
                  {f.ramas.length > 1 && <Flecha className="h-3" />}
                  {r.map((b, m) => (
                    <Fragment key={b.id}>
                      {m > 0 && <Flecha />}
                      <Caja b={b} onIr={onIr} adentro="siempre" />
                    </Fragment>
                  ))}
                  {f.ramas.length > 1 && <span aria-hidden className={`min-h-3 w-px flex-1 ${LINEA}`} />}
                  <Union j={j} total={f.ramas.length} abajo />
                </div>
              ))}
            </div>
          )}
        </Fragment>
      ))}

      <Flecha />
      <button
        type="button"
        onClick={() => onIr(SECCION_PERFILES)}
        className="mx-auto block w-full max-w-sm rounded-lg border px-3 py-2 text-center transition-colors hover:bg-[#0F3D4D]/[0.07]"
        style={{ borderColor: `${TEAL}55`, backgroundColor: `${TEAL}0d` }}
      >
        <span className="block text-[13.5px] font-semibold" style={{ color: TEAL }}>Perfiles y cuotas</span>
        <span className="mt-0.5 block text-[12px] text-[#45454D]">
          {perfiles.length ? perfiles.map((p) => `${p.nombre} ${p.meta}`).join(' · ') : 'Sin perfiles: nadie califica todavía'}
        </span>
      </button>

      <p className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border" style={{ borderColor: `${PELIGRO}88`, backgroundColor: `${PELIGRO}14` }} />Termina el filtro</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border border-dashed border-[#0F3D4D]/50" />Solo si aplica</span>
        <span>↻ Se repite</span>
        <span>Un clic lleva a esa parte del documento</span>
      </p>
    </div>
  );
}
