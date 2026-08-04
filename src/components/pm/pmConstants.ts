export const TASK_COLS  = [
  { key: 'taskName', label: 'Tarea',  type: 'text'   as const },
  { key: 'status',   label: 'Estado', type: 'select' as const },
];

export const EVENT_COLS = [
  { key: 'eventName', label: 'Evento', type: 'text' as const },
];

export const BOARD_GANTT_STATUS_COLORS: Record<string, string> = {
  'Finalizado': '#22c55e', 'En curso': '#60a5fa', 'Pendiente': '#f59e0b',
  'Por hacer': '#94a3b8', 'Cancelado': '#ef4444', 'Stand by': '#94a3b8',
};
