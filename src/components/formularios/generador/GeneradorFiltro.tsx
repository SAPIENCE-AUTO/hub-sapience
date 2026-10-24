import type { Estructura } from '@/lib/formularios/generador';
import type { GeneradorUI } from './useGenerador';
import { Insumos } from './Insumos';
import { EstructuraPanel } from './Estructura';

/**
 * El generador antes de que haya preguntas: insumos y estructura. Los pasos
 * van en el camino del filtro, arriba (Recorrido); las preguntas se escriben
 * ya en el documento. El uso de la IA de la hora está en el menú «⋯».
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
  return (
    <div className="mx-auto max-w-[860px] space-y-5">
      {paso === 'insumos'
        ? <Insumos gen={gen} formularioId={formularioId} />
        : <EstructuraPanel gen={gen} actual={actual} regla={regla} onCerrar={onCerrar} />}
    </div>
  );
}
