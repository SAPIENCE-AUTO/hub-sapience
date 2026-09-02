import SwipeDashboardPage from '../../pages/SwipeDashboardPage';

/**
 * Pestaña "Tools" del hub de proyecto — home para herramientas internas que
 * se vayan sumando (hoy solo Swipe). Cada sesión de Swipe creada aquí queda
 * ligada a este proyecto (`proyecto_id`), y el dashboard solo lista las
 * sesiones de este proyecto.
 */
export function ProjectToolsTab({ projectId }: { projectId?: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <SwipeDashboardPage proyectoId={projectId} />
    </div>
  );
}
