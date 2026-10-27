import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { createGuia, deleteGuia, getGuias } from 'zite-endpoints-sdk';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TEAL } from '@/lib/toolColors';
import { proyectoPrellenado } from '@/lib/guias/texto';
import GuiaEditor from './GuiaEditor';

interface ResumenGuia {
  id: string;
  titulo: string;
  tipo: string;
  duracion: number;
  bloques: number;
  escritos: number;
  autor?: string;
  updatedAt: string;
  puedeBorrar: boolean;
}

export interface ProyectoGuias {
  id: string;
  projectCode: string;
  fullName?: string | null;
  client?: string | null;
}

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

/** Pestaña «Guías» de un proyecto: las guías de tópicos que tiene y, al abrir una, su editor. */
export default function GuiasTab({ project }: { project: ProyectoGuias }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [guias, setGuias] = useState<ResumenGuia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [aBorrar, setABorrar] = useState<ResumenGuia | null>(null);
  const [borrando, setBorrando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await getGuias({ projectId: project.id });
      setGuias(r.guias ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'No se pudieron cargar las guías.');
    }
  }, [project.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function crear() {
    setCreando(true);
    try {
      const nombre = proyectoPrellenado(project);
      const r = await createGuia({ projectId: project.id, ...(nombre ? { proyecto: nombre } : {}) });
      setAbierta(r.id);
    } catch (e) {
      toast.error((e as Error).message || 'No se pudo crear la guía.');
    } finally {
      setCreando(false);
    }
  }

  async function borrar() {
    if (!aBorrar) return;
    setBorrando(true);
    try {
      await deleteGuia({ id: aBorrar.id });
      setABorrar(null);
      await cargar();
    } catch (e) {
      toast.error((e as Error).message || 'No se pudo borrar la guía.');
    } finally {
      setBorrando(false);
    }
  }

  if (abierta) {
    return (
      <div className="h-full overflow-y-auto">
        <GuiaEditor key={abierta} id={abierta} onSalir={() => { setAbierta(null); setGuias(null); void cargar(); }} />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold" style={{ color: TEAL }}>Guías de tópicos</h3>
          <Button onClick={() => void crear()} disabled={creando} className="gap-1.5">
            {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Nueva guía
          </Button>
        </div>

        {error && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <span>{error}</span>
            <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void cargar()}>Reintentar</Button>
          </div>
        )}

        {guias === null && !error && <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>}

        {guias !== null && guias.length === 0 && !error && (
          <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">Todavía no hay guías en este proyecto.</p>
        )}

        {guias !== null && guias.length > 0 && (
          <ul className="space-y-2">
            {guias.map((g) => (
              <li key={g.id} className="flex items-stretch gap-2 rounded-xl border bg-card transition-colors hover:bg-muted/40">
                <button type="button" className="min-w-0 flex-1 px-4 py-3 text-left" onClick={() => setAbierta(g.id)}>
                  <span className="block truncate text-sm font-semibold">{g.titulo}</span>
                  <span className="block text-xs text-muted-foreground">
                    {g.tipo} · {g.duracion} min · {g.bloques > 0 ? `${g.escritos} de ${g.bloques} bloques escritos` : 'sin bloques todavía'}
                  </span>
                  <span className="block text-xs text-muted-foreground">{g.autor ? `${g.autor} · ` : ''}editada {fecha(g.updatedAt)}</span>
                </button>
                {g.puedeBorrar && (
                  <Button variant="ghost" size="sm" className="my-auto mr-2 text-muted-foreground hover:text-destructive" aria-label={`Borrar ${g.titulo}`} onClick={() => setABorrar(g)}>Borrar</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog open={aBorrar !== null} onOpenChange={(abierto) => { if (!abierto && !borrando) setABorrar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar esta guía?</AlertDialogTitle>
            <AlertDialogDescription>Se borra «{aBorrar?.titulo}» con todo lo que ya se escribió. No se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={borrando}>No, dejarla</AlertDialogCancel>
            <Button variant="destructive" disabled={borrando} onClick={() => void borrar()}>
              {borrando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Sí, borrarla
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
