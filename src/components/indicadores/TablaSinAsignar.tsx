import { Ban, UserPlus } from 'lucide-react';
import { resumenDe, type Conteo, type Escritura, type Periodo } from '../../lib/indicadores/reclutadores';
import { BarraNuevasRepetidas, CifraConPct } from './BarraNuevasRepetidas';
import { fmtNum } from './formato';

export interface FilaSinAsignar { e: Escritura; conteo: Conteo; parecido?: { id: string; nombre: string } }

/** Las formas de escribir el nombre que todavía no tienen reclutador: se marcan para juntarlas, o se resuelven una por una. */
export function TablaSinAsignar({ filas, periodo, seleccion, onSeleccionar, onSeleccionarTodas, onJuntarCon, onCrear, onIgnorar, deshabilitado }: {
  filas: FilaSinAsignar[];
  periodo: Periodo;
  seleccion: ReadonlySet<string>;
  onSeleccionar: (clave: string, marcada: boolean) => void;
  onSeleccionarTodas: (claves: string[], marcadas: boolean) => void;
  onJuntarCon: (clave: string, reclutadorId: string) => void;
  onCrear: (clave: string, nombre: string) => void;
  onIgnorar: (clave: string) => void;
  deshabilitado: boolean;
}) {
  const todasMarcadas = filas.length > 0 && filas.every((f) => seleccion.has(f.e.clave));
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[820px] border-collapse text-[13px]">
        <thead className="border-b bg-muted/30">
          <tr>
            <th scope="col" className="w-9 px-3 py-2">
              <input type="checkbox" aria-label="Seleccionar todas las que se ven" checked={todasMarcadas} onChange={(ev) => onSeleccionarTodas(filas.map((f) => f.e.clave), ev.target.checked)} className="h-3.5 w-3.5 accent-[#0F3D4D]" />
            </th>
            <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Como lo escribieron</th>
            <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Respuestas</th>
            <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Nuevas</th>
            <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Repetidas</th>
            <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cómo se reparten</th>
            <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Qué hacer</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(({ e, conteo, parecido }) => {
            const r = resumenDe(conteo);
            return (
              <tr key={e.clave} className={`border-b last:border-b-0 hover:bg-muted/40 ${seleccion.has(e.clave) ? 'bg-[#0F3D4D]/5' : ''}`} data-clave={e.clave}>
                <td className="px-3 py-2"><input type="checkbox" aria-label={`Seleccionar «${e.nombre}»`} checked={seleccion.has(e.clave)} onChange={(ev) => onSeleccionar(e.clave, ev.target.checked)} className="h-3.5 w-3.5 accent-[#0F3D4D]" /></td>
                <td className="px-3 py-2 font-medium" title={e.formas.map(([t, n]) => `${t} (${n})`).join('\n')}>{e.nombre}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.total)}</td>
                <td className="px-3 py-2 text-right"><CifraConPct n={r.nuevas} pct={r.pctNuevas} /></td>
                <td className="px-3 py-2 text-right"><CifraConPct n={r.repetidas} pct={r.pctRepetidas} /></td>
                <td className="px-3 py-2"><BarraNuevasRepetidas conteo={conteo} ancho="w-32" /></td>
                <td className="px-3 py-2">
                  <span className="inline-flex flex-wrap items-center gap-1">
                    {parecido && (
                      <button type="button" disabled={deshabilitado} onClick={() => onJuntarCon(e.clave, parecido.id)} title={`Juntarlo con ${parecido.nombre}`} className="rounded-full border border-[#0F3D4D]/30 bg-[#0F3D4D]/5 px-2 py-0.5 text-xs font-semibold text-[#0F3D4D] hover:bg-[#0F3D4D]/10 disabled:opacity-40">
                        ¿Es {parecido.nombre}? Juntar
                      </button>
                    )}
                    <button type="button" disabled={deshabilitado} onClick={() => onCrear(e.clave, e.nombre)} title="Crear un reclutador con este nombre" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><UserPlus className="h-3 w-3" />Es un reclutador</button>
                    <button type="button" disabled={deshabilitado} onClick={() => onIgnorar(e.clave)} title="No es un reclutador (por ejemplo «Instagram»)" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><Ban className="h-3 w-3" />No es reclutador</button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
