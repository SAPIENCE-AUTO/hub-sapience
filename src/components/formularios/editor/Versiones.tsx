import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { createFormularioVersion, getFormularioVersion, getFormularioVersiones } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TEAL } from '@/lib/toolColors';
import { diferencias } from '@/lib/formularios/editar';
import type { Definicion } from '@/lib/formularios/tipos';

interface Version { id: string; revision: number; nota?: string; autor?: string; createdAt: string }

const fecha = (iso: string) => new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Versiones guardadas del filtro: las automáticas (cómo estaba antes de una
 * tanda de cambios) y las que se guardan a mano con un nombre. Restaurar una
 * la carga en el editor como un cambio más: se guarda sola y se puede deshacer.
 */
export function Versiones({ formularioId, actual, sinGuardar, onRestaurar, onClose }: {
  formularioId: string;
  actual: Definicion;
  sinGuardar: boolean;
  onRestaurar: (def: Definicion) => void;
  onClose: () => void;
}) {
  const [versiones, setVersiones] = useState<Version[] | null>(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [abierta, setAbierta] = useState<{ id: string; def: Definicion } | null>(null);
  const [cargando, setCargando] = useState<string | null>(null);

  const cargar = () => getFormularioVersiones({ formularioId }).then((r) => setVersiones(r.versiones ?? [])).catch((e) => toast.error((e as Error).message));
  useEffect(() => { cargar(); }, [formularioId]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async () => {
    setGuardando(true);
    try {
      await createFormularioVersion({ formularioId, nota: nota.trim() });
      setNota('');
      toast.success('Versión guardada');
      await cargar();
    } catch (err) {
      toast.error((err as Error).message);
    }
    setGuardando(false);
  };

  const abrir = async (id: string) => {
    if (abierta?.id === id) return setAbierta(null);
    setCargando(id);
    try {
      const r = await getFormularioVersion({ versionId: id });
      if (r.found) setAbierta({ id, def: r.definicion });
    } catch (err) {
      toast.error((err as Error).message);
    }
    setCargando(null);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Versiones guardadas</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Guardar cómo está ahora, con un nombre</label>
          <div className="flex gap-2">
            <Input value={nota} maxLength={120} placeholder="Antes de mandarlo al cliente" onChange={(e) => setNota(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && nota.trim() && !sinGuardar && guardar()} />
            <Button onClick={guardar} disabled={guardando || !nota.trim() || sinGuardar}>{guardando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Guardar</Button>
          </div>
          {sinGuardar && <p className="text-xs text-muted-foreground">Espera a que se guarden los cambios que llevas.</p>}
        </div>

        <div className="mt-2">
          <p className="mb-2 text-xs text-muted-foreground">Antes de cada tanda de cambios se guarda sola una versión con cómo estaba.</p>
          {versiones === null && <Loader2 className="mx-auto h-5 w-5 animate-spin" />}
          {versiones?.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay versiones: la primera se guarda con el primer cambio.</p>}
          <ul className="divide-y rounded-lg border">
            {versiones?.map((v) => {
              const dif = abierta?.id === v.id ? diferencias(actual, abierta.def) : null;
              return (
                <li key={v.id} className="px-3 py-2.5">
                  <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => abrir(v.id)}>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium" style={{ color: v.nota ? TEAL : undefined }}>{v.nota ?? 'Automática'}</span>
                      <span className="block text-xs text-muted-foreground">
                        {fecha(v.createdAt)}{v.autor && ` · ${v.nota ? v.autor : `antes de los cambios de ${v.autor}`}`}
                      </span>
                    </span>
                    {cargando === v.id ? <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" /> : <span className="flex-shrink-0 text-xs text-[#0F3D4D]">{abierta?.id === v.id ? 'Cerrar' : 'Ver'}</span>}
                  </button>
                  {dif && (
                    <div className="mt-2 rounded-md bg-muted/40 p-2.5 text-xs">
                      <p className="font-medium">Comparada con lo de ahora:</p>
                      {dif.length ? <ul className="mt-1 list-disc space-y-0.5 pl-4">{dif.map((d) => <li key={d}>{d}</li>)}</ul> : <p className="mt-1">Es igual.</p>}
                      {dif.length > 0 && (
                        <Button size="sm" className="mt-2" onClick={() => { onRestaurar(abierta!.def); onClose(); toast.success('Versión restaurada. Si no era, usa Deshacer.'); }}>
                          Restaurar esta versión
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
