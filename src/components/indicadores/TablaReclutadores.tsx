import { Fragment, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, Pencil, Trash2, X } from 'lucide-react';
import { resumenDe, type Conteo, type Escritura, type Periodo } from '../../lib/indicadores/reclutadores';
import { BarraNuevasRepetidas, CifraConPct } from './BarraNuevasRepetidas';
import { fmtNum } from './formato';

export interface FilaReclutador { id: string; nombre: string; conteo: Conteo; claves: string[] }

type Columna = 'nombre' | 'total' | 'nuevas' | 'repetidas';

/** Los reclutadores ya juntados, cada uno con lo que suman sus formas de escribir el nombre. Se abre cada fila para ver (y separar) esas formas. */
export function TablaReclutadores({ filas, escrituras, periodo, seleccion, expandidos, onSeleccionar, onExpandir, onRenombrar, onEliminar, onSeparar, deshabilitado }: {
  filas: FilaReclutador[];
  escrituras: ReadonlyMap<string, Escritura>;
  periodo: Periodo;
  seleccion: ReadonlySet<string>;
  expandidos: ReadonlySet<string>;
  onSeleccionar: (clave: string, marcada: boolean) => void;
  onExpandir: (id: string) => void;
  onRenombrar: (id: string, nombre: string) => Promise<boolean>;
  onEliminar: (id: string) => Promise<void>;
  onSeparar: (claves: string[]) => void;
  deshabilitado: boolean;
}) {
  const [orden, setOrden] = useState<{ col: Columna; asc: boolean }>({ col: 'total', asc: false });
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const ordenadas = useMemo(() => {
    const valor = (f: FilaReclutador): string | number => {
      const r = resumenDe(f.conteo);
      return orden.col === 'nombre' ? f.nombre.toLowerCase() : orden.col === 'total' ? r.total : orden.col === 'nuevas' ? r.pctNuevas ?? -1 : r.pctRepetidas ?? -1;
    };
    return [...filas].sort((a, b) => {
      const x = valor(a), y = valor(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string, 'es') : (x as number) - (y as number);
      return (orden.asc ? c : -c) || a.nombre.localeCompare(b.nombre, 'es');
    });
  }, [filas, orden]);

  const encabezado = (col: Columna, texto: string, derecha = true) => (
    <th scope="col" className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${derecha ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => setOrden((o) => ({ col, asc: o.col === col ? !o.asc : col === 'nombre' }))} className="inline-flex items-center gap-1 hover:text-foreground">
        {texto}
        {orden.col === col && (orden.asc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  );

  const guardarNombre = async () => {
    if (!editando) return;
    if (await onRenombrar(editando.id, editando.texto)) setEditando(null);
  };

  if (filas.length === 0) {
    return <p className="rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">Todavía no hay reclutadores. Junta formas del nombre abajo, o usa «Sugerir reclutadores» para empezar.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[820px] border-collapse text-[13px]">
        <thead className="border-b bg-muted/30">
          <tr>
            {encabezado('nombre', 'Reclutador', false)}
            {encabezado('total', 'Respuestas')}
            {encabezado('nuevas', 'Nuevas')}
            {encabezado('repetidas', 'Repetidas')}
            <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cómo se reparten</th>
            <th scope="col" className="w-20 px-3 py-2"><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((f) => {
            const r = resumenDe(f.conteo);
            const abierto = expandidos.has(f.id);
            const formas = [...f.claves].sort((a, b) => (escrituras.get(b)?.c[periodo][0] ?? 0) - (escrituras.get(a)?.c[periodo][0] ?? 0));
            return (
              <Fragment key={f.id}>
                <tr className="border-b hover:bg-muted/40" data-reclutador={f.id}>
                  <td className="px-3 py-2">
                    {editando?.id === f.id ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          autoFocus
                          aria-label={`Nuevo nombre para ${f.nombre}`}
                          value={editando.texto}
                          maxLength={60}
                          onChange={(e) => setEditando({ id: f.id, texto: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') void guardarNombre(); if (e.key === 'Escape') setEditando(null); }}
                          className="w-52 rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:ring-2 focus:ring-[#0F3D4D]/40"
                        />
                        <button type="button" aria-label="Guardar el nombre" onClick={() => void guardarNombre()} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><Check className="h-3.5 w-3.5" /></button>
                        <button type="button" aria-label="Cancelar" onClick={() => setEditando(null)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => onExpandir(f.id)} aria-expanded={abierto} className="inline-flex items-center gap-1.5 text-left font-semibold">
                        {abierto ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                        {f.nombre}
                        <span className="text-xs font-normal text-muted-foreground">{f.claves.length} {f.claves.length === 1 ? 'forma' : 'formas'} de escribirlo</span>
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.total)}</td>
                  <td className="px-3 py-2 text-right"><CifraConPct n={r.nuevas} pct={r.pctNuevas} /></td>
                  <td className="px-3 py-2 text-right">
                    <CifraConPct n={r.repetidas} pct={r.pctRepetidas} />
                    {r.compartido > 0 && <span className="ml-1.5 text-[11px] text-muted-foreground" title="Respuestas de un correo o teléfono compartido: no cuentan como nuevas ni repetidas">+{fmtNum(r.compartido)} compartido</span>}
                  </td>
                  <td className="px-3 py-2"><BarraNuevasRepetidas conteo={f.conteo} /></td>
                  <td className="px-3 py-2 text-right">
                    {confirmando === f.id ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs">
                        ¿Borrar?
                        <button type="button" onClick={async () => { setConfirmando(null); await onEliminar(f.id); }} className="rounded px-1.5 py-0.5 font-semibold text-destructive hover:bg-destructive/10">Sí</button>
                        <button type="button" onClick={() => setConfirmando(null)} className="rounded px-1.5 py-0.5 hover:bg-muted">No</button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5">
                        <button type="button" disabled={deshabilitado} aria-label={`Cambiar el nombre de ${f.nombre}`} title="Cambiar el nombre" onClick={() => setEditando({ id: f.id, texto: f.nombre })} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" disabled={deshabilitado} aria-label={`Borrar a ${f.nombre}`} title="Borrar al reclutador (sus formas quedan sin asignar)" onClick={() => setConfirmando(f.id)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
                      </span>
                    )}
                  </td>
                </tr>
                {abierto && (
                  <tr className="border-b bg-muted/20">
                    <td colSpan={6} className="px-3 py-2">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            <th className="w-8 py-1" />
                            <th className="py-1 text-left font-semibold">Como lo escribieron</th>
                            <th className="py-1 text-right font-semibold">Respuestas</th>
                            <th className="py-1 text-right font-semibold">Nuevas</th>
                            <th className="py-1 text-right font-semibold">Repetidas</th>
                            <th className="w-24 py-1" />
                          </tr>
                        </thead>
                        <tbody>
                          {formas.map((clave) => {
                            const e = escrituras.get(clave);
                            if (!e) return null;
                            const x = resumenDe(e.c[periodo]);
                            return (
                              <tr key={clave} className="border-t border-border/60">
                                <td className="py-1.5"><input type="checkbox" aria-label={`Seleccionar «${e.nombre}»`} checked={seleccion.has(clave)} onChange={(ev) => onSeleccionar(clave, ev.target.checked)} className="h-3.5 w-3.5 accent-[#0F3D4D]" /></td>
                                <td className="py-1.5" title={e.formas.map(([t, n]) => `${t} (${n})`).join('\n')}>{e.nombre}</td>
                                <td className="py-1.5 text-right tabular-nums">{fmtNum(x.total)}</td>
                                <td className="py-1.5 text-right"><CifraConPct n={x.nuevas} pct={x.pctNuevas} /></td>
                                <td className="py-1.5 text-right"><CifraConPct n={x.repetidas} pct={x.pctRepetidas} /></td>
                                <td className="py-1.5 text-right"><button type="button" disabled={deshabilitado} onClick={() => onSeparar([clave])} className="rounded px-2 py-0.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">Separar</button></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
