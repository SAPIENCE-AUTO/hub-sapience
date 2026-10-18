import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { normalizarNombre, type ProyectoDisponible } from '@/lib/pagosManagement/reparto';
import { fmtFecha } from './formato';

const MAX_VISIBLES = 40;

/** Elegir un proyecto que no tiene monto de management en su deal (ni reparto) para repartirle un presupuesto puesto a mano. */
export function AgregarProyectoDialog({ abierto, disponibles, onElegir, onCerrar }: {
  abierto: boolean;
  disponibles: ProyectoDisponible[];
  onElegir: (p: ProyectoDisponible) => void;
  onCerrar: () => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  useEffect(() => { if (abierto) setBusqueda(''); }, [abierto]);

  const coincidencias = useMemo(() => {
    const b = normalizarNombre(busqueda);
    return disponibles.filter((p) => !b || normalizarNombre(`${p.codigo} ${p.cliente ?? ''} ${p.nombre ?? ''}`).includes(b));
  }, [disponibles, busqueda]);

  return (
    <Dialog open={abierto} onOpenChange={(o) => { if (!o) onCerrar(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar proyecto</DialogTitle>
          <DialogDescription>Proyectos sin monto de management en su deal. Elige uno y ponle el presupuesto.</DialogDescription>
        </DialogHeader>
        <Input autoFocus aria-label="Buscar proyecto" placeholder="Buscar por proyecto o cliente" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        {coincidencias.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Ningún proyecto coincide.</p>
        ) : (
          <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
            {coincidencias.slice(0, MAX_VISIBLES).map((p) => (
              <li key={p.projectId}>
                <button type="button" onClick={() => onElegir(p)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50">
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
