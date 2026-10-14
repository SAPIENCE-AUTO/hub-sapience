import { useState } from 'react';
import SwipeDashboardPage from '../../pages/SwipeDashboardPage';
import EjesDashboardPage from '../../pages/EjesDashboardPage';
import { PreworkPanel } from './PreworkPanel';

type SubTab = 'swipe' | 'ejes' | 'prework';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'swipe', label: 'Swipe' },
  { id: 'ejes', label: 'Ejes' },
  { id: 'prework', label: 'Prework' },
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
 */
export function ProjectToolsTab({ projectId, soloSwipe = false }: { projectId?: string; soloSwipe?: boolean }) {
  const [subTab, setSubTab] = useState<SubTab>('swipe');
  const subTabs = soloSwipe ? SUB_TABS.filter(tab => tab.id === 'swipe') : SUB_TABS;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {subTabs.length > 1 && <div className="flex items-center gap-1 border-b px-4 py-2 flex-shrink-0">
        {subTabs.map(tab => {
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
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
        {!soloSwipe && subTab === 'ejes' && <EjesDashboardPage proyectoId={projectId} />}
        {!soloSwipe && subTab === 'prework' && <PreworkPanel proyectoId={projectId} />}
      </div>
    </div>
  );
}
