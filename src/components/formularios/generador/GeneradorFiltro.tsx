import { TEAL } from '@/lib/toolColors';
import type { Estructura } from '@/lib/formularios/generador';
import type { GeneradorUI } from './useGenerador';
import { Insumos } from './Insumos';
import { EstructuraPanel } from './Estructura';
import { UsoIA } from './comun';

const PASOS = [{ id: 'insumos', nombre: 'Insumos' }, { id: 'estructura', nombre: 'Estructura' }, { id: 'preguntas', nombre: 'Preguntas' }] as const;

/**
 * El generador antes de que haya preguntas: insumos y estructura, con los
 * tres pasos arriba. Las preguntas se escriben ya en el documento.
 */
export function GeneradorFiltro({ gen, formularioId, actual, regla, onCerrar }: {
  gen: GeneradorUI;
  formularioId: string;
  /** Se abrió desde el documento para cambiar la estructura de lo ya escrito. */
  actual?: Estructura;
  /** La regla de NSE del filtro ya escrito. */
  regla?: string;
  onCerrar?: () => void;
}) {
  const g = gen.g;
  if (!g && !actual) return null;
  const paso = actual && g?.etapa !== 'estructura' ? 'estructura' : g?.etapa === 'insumos' ? 'insumos' : 'estructura';
  const i = PASOS.findIndex((p) => p.id === paso);
  return (
    <div className="mx-auto max-w-[860px] space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ol className="flex items-center gap-1 text-xs">
          {PASOS.map((p, j) => (
            <li key={p.id} className="flex items-center gap-1">
              {j > 0 && <span className="text-muted-foreground">›</span>}
              <span
                className={`rounded-full px-2.5 py-0.5 font-medium ${j === i ? 'text-white' : j < i ? 'text-[#0F3D4D]' : 'text-muted-foreground'}`}
                style={j === i ? { backgroundColor: TEAL } : j < i ? { backgroundColor: 'rgba(15,61,77,0.08)' } : undefined}
              >
                {p.nombre}
              </span>
            </li>
          ))}
        </ol>
        <span className="ml-auto"><UsoIA uso={gen.uso} /></span>
      </div>
      {paso === 'insumos'
        ? <Insumos gen={gen} formularioId={formularioId} />
        : <EstructuraPanel gen={gen} actual={actual} regla={regla} onCerrar={onCerrar} />}
    </div>
  );
}
