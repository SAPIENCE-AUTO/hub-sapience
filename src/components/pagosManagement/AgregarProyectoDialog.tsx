import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { normalizarNombre } from '@/lib/pagosManagement/reparto';
import { fmtFecha } from './formato';

const MAX_VISIBLES = 40;

/** Lo que se necesita de un proyecto para listarlo (lo cumplen los disponibles y los proyectos con reparto). */
export interface OpcionProyecto { projectId: string; codigo: string; cliente?: string; nombre?: string; inicio?: string }

/**
 * Elegir un proyecto para repartirle un presupuesto. Por omisión, los que no tienen monto de management en su deal (ni reparto); al agregarlo a un
 * programa también se pueden elegir los que ya tienen reparto.
 */
export function AgregarProyectoDialog({ abierto, opciones, descripcion, onElegir, onCerrar }: {
  abierto: boolean;
  opciones: OpcionProyecto[];
  descripcion?: string;
  onElegir: (projectId: string) => void;
  onCerrar: () => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  useEffect(() => { if (abierto) setBusqueda(''); }, [abierto]);

  const coincidencias = useMemo(() => {
    const b = normalizarNombre(busqueda);
    return opciones.filter((p) => !b || normalizarNombre(`${p.codigo} ${p.cliente ?? ''} ${p.nombre ?? ''}`).includes(b));
  }, [opciones, busqueda]);

  return (
    <Dialog open={abierto} onOpenChange={(o) => { if (!o) onCerrar(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar proyecto</DialogTitle>
          <DialogDescription>{descripcion ?? 'Proyectos sin monto de management en su deal. Elige uno y ponle el presupuesto.'}</DialogDescription>
        </DialogHeader>
        <Input autoFocus aria-label="Buscar proyecto" placeholder="Buscar por proyecto o cliente" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        {coincidencias.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Ningún proyecto coincide.</p>
        ) : (
          <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
            {coincidencias.slice(0, MAX_VISIBLES).map((p) => (
              <li key={p.projectId}>
                <button type="button" onClick={() => onElegir(p.projectId)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{p.codigo}</span>
                    {p.cliente && <span className="ml-2 text-xs text-muted-foreground">{p.cliente}</span>}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{p.inicio ? fmtFecha(p.inicio) : 'Sin fecha'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {coincidencias.length > MAX_VISIBLES && <p className="text-xs text-muted-foreground">Se muestran {MAX_VISIBLES} de {coincidencias.length}: escribe para acotar.</p>}
      </DialogContent>
    </Dialog>
  );
}
