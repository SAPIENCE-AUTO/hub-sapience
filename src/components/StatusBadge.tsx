import { Badge } from '@/components/ui/badge';

const colors: Record<string, string> = {
  // Project / CRM
  'Prospecto': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'En curso': 'bg-blue-100 text-blue-800 border-blue-200',
  'Finalizado': 'bg-green-100 text-green-800 border-green-200',
  'Cancelado': 'bg-red-100 text-red-800 border-red-200',
  'Propuesta enviada': 'bg-purple-100 text-purple-800 border-purple-200',
  'Negociación': 'bg-orange-100 text-orange-800 border-orange-200',
  'Ganado': 'bg-green-100 text-green-800 border-green-200',
  'Perdido': 'bg-red-100 text-red-800 border-red-200',
  // Recruitment
  'Pendiente': 'bg-gray-100 text-gray-700 border-gray-200',
  'Contactado': 'bg-blue-100 text-blue-800 border-blue-200',
  'Confirmado': 'bg-green-100 text-green-800 border-green-200',
  'Asistió': 'bg-teal-100 text-teal-800 border-teal-200',
  'No show': 'bg-red-100 text-red-800 border-red-200',
  'Descartado': 'bg-orange-100 text-orange-800 border-orange-200',
  // Tasks
  'En progreso': 'bg-blue-100 text-blue-800 border-blue-200',
  'Completada': 'bg-green-100 text-green-800 border-green-200',
  'Bloqueada': 'bg-red-100 text-red-800 border-red-200',
  // PO
  'Borrador': 'bg-gray-100 text-gray-700 border-gray-200',
  'Enviada a aprobación': 'bg-blue-100 text-blue-800 border-blue-200',
  'Aprobada': 'bg-green-100 text-green-800 border-green-200',
  'Pagada': 'bg-teal-100 text-teal-800 border-teal-200',
};

export function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const cls = colors[status] ?? 'bg-gray-100 text-gray-700 border-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {status}
    </span>
  );
}
