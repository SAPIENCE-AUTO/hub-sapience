import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { getPropuesta } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { EstadoPill } from './PasoUi';
import BriefStep from './BriefStep';
import EsqueletoStep from './EsqueletoStep';
import DisenoStep from './DisenoStep';
import RevisionStep from './RevisionStep';

const PASOS = ['Brief', 'Esqueleto', 'Diseño', 'Revisión y descarga'];

// Cada paso guarda en `propuestas` y cambia el estado, así que se puede retomar
// desde donde se quedó (spec §5): el paso inicial sale del estado.
function pasoInicial(p: any): number {
  if (['contenido', 'revisado', 'construida', 'error'].includes(p.estado) && p.contenido) return 4;
  if (p.estado === 'esqueleto_aprobado') return 3;
  if (p.estado === 'esqueleto') return 2;
  return 1;
}

export default function PropuestaWizard({ id, onSalir }: { id: string; onSalir: () => void }) {
  const [p, setP] = useState<any>(null);
  const [paso, setPaso] = useState(1);
  const [iniciarContenido, setIniciarContenido] = useState(false);
  // Al cambiar de paso, volver arriba: el contenedor del popup conserva el scroll del paso anterior.
  const arriba = useRef<HTMLDivElement>(null);
  useEffect(() => { arriba.current?.scrollIntoView({ block: 'start' }); }, [paso]);

  const cargar = useCallback(async () => {
    const d = await getPropuesta({ id });
    setP(d);
    return d;
  }, [id]);

  useEffect(() => {
    cargar().then(d => setPaso(pasoInicial(d))).catch(() => toast.error('No se pudo cargar la propuesta'));
  }, [cargar]);

  if (!p) return <div className="space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-64" /></div>;

  // Qué pasos están disponibles según lo que ya existe.
  const hayEsqueleto = !!p.esqueleto;
  const aprobado = ['esqueleto_aprobado', 'contenido', 'revisado', 'construida', 'error'].includes(p.estado) && hayEsqueleto;
  const habilitado = [true, hayEsqueleto, aprobado, !!p.contenido];

  return (
    <div className="space-y-5">
      <div ref={arriba} className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={onSalir}><ArrowLeft className="w-4 h-4" /> Propuestas</Button>
        <p className="text-sm font-semibold truncate">{p.titulo ?? 'Propuesta'}</p>
        <EstadoPill estado={p.estado} />
      </div>

      <ol className="grid grid-cols-4 gap-2">
        {PASOS.map((nombre, i) => {
          const n = i + 1, activo = paso === n, hecho = n < paso;
          return (
            <li key={nombre}>
              <button type="button" disabled={!habilitado[i]} onClick={() => setPaso(n)}
                className={`w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${activo ? 'border-primary bg-primary/5 font-semibold' : 'border-border'} ${habilitado[i] ? 'hover:bg-muted/40' : 'opacity-40 cursor-not-allowed'}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${activo ? 'bg-primary text-primary-foreground' : hecho ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'}`}>
                  {hecho ? <Check className="w-3 h-3" /> : n}
                </span>
                {nombre}
              </button>
            </li>
          );
        })}
      </ol>

      {/* key=paso+estado de datos: al cambiar de paso o recargar el esqueleto se reinicia el borrador local */}
      {paso === 1 && <BriefStep key={`b-${p.id}`} p={p} onChanged={cargar} onEsqueleto={() => setPaso(2)} />}
      {paso === 2 && hayEsqueleto && <EsqueletoStep key={`e-${p.id}-${p.esqueleto?.resumen_brief?.length}`} p={p} onChanged={cargar} onAprobado={() => setPaso(3)} />}
      {paso === 3 && aprobado && <DisenoStep key={`d-${p.id}`} p={p} onChanged={cargar} onEscribir={() => { setIniciarContenido(true); setPaso(4); }} />}
      {paso === 4 && <RevisionStep key={`r-${p.id}`} p={p} iniciar={iniciarContenido} onIniciado={() => setIniciarContenido(false)} onChanged={cargar} onVolverEsqueleto={() => setPaso(2)} />}
    </div>
  );
}
