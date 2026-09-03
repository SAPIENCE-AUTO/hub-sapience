import { useState } from 'react';
import SwipeDashboardPage from '../../pages/SwipeDashboardPage';
import EjesDashboardPage from '../../pages/EjesDashboardPage';

type SubTab = 'swipe' | 'ejes';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'swipe', label: 'Swipe' },
  { id: 'ejes', label: 'Ejes' },
];

/**
 * Pestaña "Tools" del hub de proyecto — home para herramientas internas que
 * se vayan sumando. Empezó con solo Swipe (ver git blame); Ejes es la
 * segunda. El selector interno replica el mismo patrón visual de tabs que
 * ProjectHubPage.tsx usa un nivel arriba (bg-primary activo, hover en
 * inactivo) — no un componente nuevo, solo el mismo criterio.
 */
export function ProjectToolsTab({ projectId }: { projectId?: string }) {
  const [subTab, setSubTab] = useState<SubTab>('swipe');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-1 border-b px-4 py-2 flex-shrink-0">
        {SUB_TABS.map(tab => {
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
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {subTab === 'swipe' && <SwipeDashboardPage proyectoId={projectId} />}
        {subTab === 'ejes' && <EjesDashboardPage proyectoId={projectId} />}
      </div>
    </div>
  );
}
