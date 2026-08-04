export type WidgetSize = 'half' | 'full';
export type LayoutItem = { id: string; size: WidgetSize };

export type WidgetConfig = {
  id: string;
  label: string;
  defaultSize: WidgetSize;
  allowedSizes: WidgetSize[];
  accentColor: string;
};

export const WIDGET_REGISTRY: WidgetConfig[] = [
  {
    id: 'my_projects',
    label: 'Mis proyectos',
    defaultSize: 'half',
    allowedSizes: ['half', 'full'],
    accentColor: 'bg-[hsl(var(--chart-4))]',
  },
  {
    id: 'my_tasks',
    label: 'Mis tareas',
    defaultSize: 'full',
    allowedSizes: ['half', 'full'],
    accentColor: 'bg-primary',
  },
  {
    id: 'upcoming_events',
    label: 'Próximos eventos',
    defaultSize: 'half',
    allowedSizes: ['half', 'full'],
    accentColor: 'bg-secondary',
  },
  {
    id: 'purchase_orders',
    label: 'Órdenes de compra',
    defaultSize: 'full',
    allowedSizes: ['half', 'full'],
    accentColor: 'bg-[hsl(var(--chart-3))]',
  },
  {
    id: 'recent_mentions',
    label: 'Menciones recientes',
    defaultSize: 'half',
    allowedSizes: ['half', 'full'],
    accentColor: 'bg-[hsl(var(--chart-1))]',
  },
  {
    id: 'received_invoices',
    label: 'Facturas recibidas',
    defaultSize: 'half',
    allowedSizes: ['half', 'full'],
    accentColor: 'bg-[hsl(var(--chart-5))]',
  },
];

export const WIDGET_LABEL_TO_ID: Record<string, string> = {
  'Mis proyectos': 'my_projects',
  'Mis tareas': 'my_tasks',
  'Próximos eventos': 'upcoming_events',
  'Órdenes de compra': 'purchase_orders',
  'Menciones recientes': 'recent_mentions',
  'Facturas recibidas': 'received_invoices',
};

export const WIDGET_ID_TO_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(WIDGET_LABEL_TO_ID).map(([k, v]) => [v, k])
);

/**
 * Builds the final ordered layout for a user.
 * - If enabledLabels is empty → show all widgets (showAll pattern)
 * - Respects saved order and sizes from savedLayoutJson
 * - Falls back to defaultSize for invalid/missing sizes
 * - Appends newly enabled widgets at the end in registry order
 */
export function buildLayout(enabledLabels: string[], savedLayoutJson?: string): LayoutItem[] {
  // Determine enabled widget IDs
  let enabledIds: Set<string>;
  if (enabledLabels.length === 0) {
    enabledIds = new Set(WIDGET_REGISTRY.map(w => w.id));
  } else {
    enabledIds = new Set(
      enabledLabels
        .map(l => WIDGET_LABEL_TO_ID[l])
        .filter((id): id is string => !!id)
    );
  }

  // Parse saved layout defensively
  let saved: LayoutItem[] = [];
  if (savedLayoutJson) {
    try {
      const parsed = JSON.parse(savedLayoutJson);
      if (Array.isArray(parsed)) {
        saved = parsed.filter(
          (item): item is LayoutItem =>
            !!item &&
            typeof item.id === 'string' &&
            (item.size === 'half' || item.size === 'full')
        );
      }
    } catch {
      // ignore invalid JSON — use default
    }
  }

  const result: LayoutItem[] = [];
  const seenIds = new Set<string>();

  // Start with saved items that are still enabled
  for (const item of saved) {
    if (!enabledIds.has(item.id) || seenIds.has(item.id)) continue;
    const config = WIDGET_REGISTRY.find(w => w.id === item.id);
    if (!config) continue;
    const size: WidgetSize = config.allowedSizes.includes(item.size)
      ? item.size
      : config.defaultSize;
    result.push({ id: item.id, size });
    seenIds.add(item.id);
  }

  // Append enabled widgets not present in saved layout (maintain registry order)
  for (const config of WIDGET_REGISTRY) {
    if (enabledIds.has(config.id) && !seenIds.has(config.id)) {
      result.push({ id: config.id, size: config.defaultSize });
    }
  }

  return result;
}
