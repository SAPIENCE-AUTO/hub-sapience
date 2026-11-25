import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getPilares, savePilar } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { PALETA_PILARES } from '@/lib/pilares/catalogo';
import type { PilarCat } from './tipos';

// Administrar el catálogo de pilares (solo Owner o Socio; el candado real está en el servidor): crear uno nuevo, cambiarle el nombre o el color y desactivarlo.
// Un pilar nunca se borra: desactivado deja de ofrecerse en deals nuevos, pero los deals que ya lo tienen lo conservan.

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  /** Se avisa cada vez que cambia el catálogo, para que la pantalla de donde se abrió lo vuelva a leer. */
  onCambio: () => void;
}

function Colores({ valor, onElegir }: { valor: string; onElegir: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {PALETA_PILARES.map(c => (
        <button
          key={c}
          type="button"
          aria-label={`Color ${c}`}
          aria-pressed={valor.toLowerCase() === c.toLowerCase()}
          onClick={() => onElegir(c)}
          className={`h-5 w-5 rounded-full border-2 ${valor.toLowerCase() === c.toLowerCase() ? 'border-foreground' : 'border-transparent'}`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

function FilaPilar({ pilar, onGuardar }: { pilar: PilarCat; onGuardar: (cambios: { id: string; nombre?: string; color?: string; activo?: boolean }) => Promise<boolean> }) {
  const [nombre, setNombre] = useState(pilar.nombre);
  useEffect(() => setNombre(pilar.nombre), [pilar.nombre]);
  const confirmarNombre = async () => {
    const limpio = nombre.trim();
    if (limpio === pilar.nombre) return;
    if (!(await onGuardar({ id: pilar.id, nombre: limpio }))) setNombre(pilar.nombre);
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
      <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: pilar.color }} aria-hidden />
      <Input
        aria-label={`Nombre del pilar ${pilar.nombre}`}
        className="h-8 w-48"
        value={nombre}
        onChange={e => setNombre(e.target.value)}
        onBlur={confirmarNombre}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      <Colores valor={pilar.color} onElegir={c => onGuardar({ id: pilar.id, color: c })} />
      <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        {pilar.activo ? 'Activo' : 'Desactivado'}
        <Switch checked={pilar.activo} onCheckedChange={v => onGuardar({ id: pilar.id, activo: v })} aria-label={`Activar o desactivar ${pilar.nombre}`} />
      </label>
    </div>
  );
}

export default function PilaresAdminDialog({ abierto, onCerrar, onCambio }: Props) {
  const [pilares, setPilares] = useState<PilarCat[] | null>(null);
  const [nuevo, setNuevo] = useState('');
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setPilares(((await getPilares({})) as { pilares: PilarCat[] }).pilares);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo leer el catálogo de pilares');
    }
  }, []);
  useEffect(() => { if (abierto) void cargar(); }, [abierto, cargar]);

  const guardar = async (cambios: { id: string; nombre?: string; color?: string; activo?: boolean }): Promise<boolean> => {
    try {
      await savePilar(cambios);
      await cargar();
      onCambio();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar el pilar');
      return false;
    }
  };

  const crear = async () => {
    const nombre = nuevo.trim();
    if (!nombre) return;
    setCreando(true);
    try {
      await savePilar({ nombre });
      setNuevo('');
      await cargar();
      onCambio();
      toast.success(`Pilar «${nombre}» creado`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo crear el pilar');
    } finally {
      setCreando(false);
    }
  };

  return (
    <Dialog open={abierto} onOpenChange={o => !o && onCerrar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pilares</DialogTitle>
          <DialogDescription>
            Las unidades de negocio con las que se reparte cada deal. Cambiar un nombre actualiza el «Tipo de proyecto» de los deals que lo usan. Un pilar no se borra: si ya no se usa, se desactiva y deja de ofrecerse, pero los deals que lo tienen lo conservan.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {pilares === null ? [1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />) : pilares.map(p => <FilaPilar key={p.id} pilar={p} onGuardar={guardar} />)}
        </div>
        <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); void crear(); }}>
          <Input aria-label="Nombre del pilar nuevo" className="h-9" placeholder="Nombre del pilar nuevo (por ejemplo, Talks)" value={nuevo} onChange={e => setNuevo(e.target.value)} maxLength={40} />
          <Button type="submit" size="sm" disabled={creando || !nuevo.trim()}>{creando ? 'Creando' : 'Crear pilar'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
