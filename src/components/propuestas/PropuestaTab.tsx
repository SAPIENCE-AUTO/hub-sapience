import { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, Plus } from 'lucide-react';
import { createPropuesta, getPropuestas } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { EstadoPill } from './PasoUi';
import PropuestaWizard from './PropuestaWizard';

// Pestaña "Propuesta" dentro de cada Deal (solo Sergio — el gate real vive en
// los endpoints, ver serverUtils/propuestas/acceso.ts): lista las propuestas
// del deal y abre el generador de 4 pasos.
export default function PropuestaTab({ dealId }: { dealId: string }) {
  const [lista, setLista] = useState<any[] | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(() => {
    getPropuestas({ dealId }).then(d => setLista(d.propuestas)).catch(() => { setLista([]); toast.error('No se pudieron cargar las propuestas'); });
  }, [dealId]);
  useEffect(() => { cargar(); }, [cargar]);

  const nueva = async () => {
    setCreando(true);
    try { const { id } = await createPropuesta({ dealId }); setAbierta(id); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo crear la propuesta'); }
    finally { setCreando(false); }
  };

  if (abierta) return <PropuestaWizard id={abierta} onSalir={() => { setAbierta(null); cargar(); }} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Propuestas de este deal</p>
          <p className="text-xs text-muted-foreground">Sube el brief y Claude arma la propuesta en PowerPoint con la voz y el diseño de Sapience.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={nueva} disabled={creando}>
          {creando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Nueva propuesta
        </Button>
      </div>

      {lista === null ? (
        <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : lista.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">Todavía no hay propuestas para este deal.</div>
      ) : (
        <div className="space-y-2">
          {lista.map(x => (
            <button key={x.id} type="button" onClick={() => setAbierta(x.id)}
              className="w-full flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left hover:border-foreground/30 transition-colors">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{x.titulo ?? 'Propuesta'}</p>
                <p className="text-[11px] text-muted-foreground">{x.updatedAt ? new Date(x.updatedAt).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}{x.tienePptx ? ` · PowerPoint v${x.version}` : ''}</p>
              </div>
              <EstadoPill estado={x.estado} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
