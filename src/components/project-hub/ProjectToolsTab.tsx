import { useState } from 'react';
import SwipeDashboardPage from '../../pages/SwipeDashboardPage';
import EjesDashboardPage from '../../pages/EjesDashboardPage';
import GuiasTab from '../guias/GuiasTab';
import type { ProyectoGuias } from '../guias/GuiasTab';
import { PreworkPanel } from './PreworkPanel';

type SubTab = 'swipe' | 'ejes' | 'prework' | 'guias';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'swipe', label: 'Swipe' },
  { id: 'ejes', label: 'Ejes' },
  { id: 'prework', label: 'Prework' },
  { id: 'guias', label: 'Guías' },
];

/**
 * Pestaña "Tools" del hub de proyecto — home para herramientas internas que
 * se vayan sumando. Empezó con solo Swipe (ver git blame); Prework y Ejes
 * son la segunda y tercera. El selector interno replica el mismo patrón
 * visual de tabs que ProjectHubPage.tsx usa un nivel arriba (bg-primary
 * activo, hover en inactivo) — no un componente nuevo, solo el mismo criterio.
 *
 * `soloSwipe`: quien tiene acceso únicamente a Swipe no ve el selector ni las
 * demás herramientas (ver SWIPE_ALLOWED_EMAILS en ProjectHubPage.tsx).
 * Filtros ya no vive aquí: tiene su propia pestaña junto a Reclutamiento
 * (ProjectHubPage.tsx, 2026-10-24).
 *
 * `conGuias` y `proyecto`: las guías de tópicos (2026-10-26, pedido de Sergio)
 * viven aquí como una pestañita más, para quien pasa `puedeVerGuias`
 * (src/lib/guias/acceso.ts: hoy, todo el equipo); necesitan los datos del
 * proyecto para prellenar el nombre de la guía. `sinSwipe`: quien no tiene
 * ni Swipe entra a Tools solo por las guías.
 */
export function ProjectToolsTab({ projectId, soloSwipe = false, sinSwipe = false, conGuias = false, proyecto }: { projectId?: string; soloSwipe?: boolean; sinSwipe?: boolean; conGuias?: boolean; proyecto?: ProyectoGuias }) {
  const [elegida, setElegida] = useState<SubTab>('swipe');
  const subTabs = SUB_TABS.filter(tab => (tab.id === 'guias' ? conGuias && !!proyecto : tab.id === 'swipe' ? !sinSwipe : !soloSwipe));
  // Si la pestañita elegida no está entre las que esta persona puede usar (entra solo a las guías, p. ej.), se muestra la primera que sí.
  const subTab: SubTab | undefined = subTabs.some(t => t.id === elegida) ? elegida : subTabs[0]?.id;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {subTabs.length > 1 && <div className="flex items-center gap-1 border-b px-4 py-2 flex-shrink-0">
        {subTabs.map(tab => {
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setElegida(tab.id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                active ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {subTab === 'swipe' && <SwipeDashboardPage proyectoId={projectId} />}
        {subTab === 'ejes' && <EjesDashboardPage proyectoId={projectId} />}
        {subTab === 'prework' && <PreworkPanel proyectoId={projectId} />}
        {subTab === 'guias' && proyecto && <GuiasTab project={proyecto} />}
      </div>
    </div>
  );
}
