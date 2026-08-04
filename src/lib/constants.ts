export const COST_CENTERS = [
  'Reclutamiento e Incentivos',
  'Logística',
  'Moderaciones',
  'Management',
  'Otros',
] as const;

export const CATEGORIES = COST_CENTERS;

export const CAT_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  'Reclutamiento e Incentivos': { bg: 'bg-blue-100',    text: 'text-blue-700',    border: 'border-blue-200' },
  'Logística':                   { bg: 'bg-orange-100',  text: 'text-orange-700',  border: 'border-orange-200' },
  'Moderaciones':                { bg: 'bg-purple-100',  text: 'text-purple-700',  border: 'border-purple-200' },
  'Management':                  { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  'Otros':                       { bg: 'bg-gray-100',    text: 'text-gray-600',    border: 'border-gray-200' },
};
